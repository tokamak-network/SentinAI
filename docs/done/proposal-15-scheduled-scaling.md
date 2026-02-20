# Proposal 15: Time-Based Scheduled Scaling

## 1. Overview

### Problem Statement

The current `cost-optimizer.ts` generates schedule-based recommendations (e.g., "scale to 1 vCPU at night, 2 vCPU during day") but **never executes them**. The reactive scaling engine (`scaling-decision.ts`) responds only to real-time metrics, which means:

- During low-traffic periods (nights, weekends), vCPU remains at the last reactive level
- No proactive scale-down occurs even when historical patterns clearly predict low load
- Users must manually act on cost-optimizer recommendations

### Solution Summary

Implement a **Scheduled Scaler** that:
1. Analyzes 7-day usage patterns from `usage-tracker.ts` (7×24 = 168 hour-day buckets)
2. Generates a scaling schedule profile (time → target vCPU mapping)
3. Executes the schedule via a new cron task in `scheduler.ts`
4. Always yields to reactive scaling when real-time metrics indicate higher load

### Goals

- Automatically scale down during predictable low-traffic periods
- Reduce compute costs by ~28% ($23/month based on typical L2 network patterns)
- Zero manual intervention after initial configuration
- Never cause performance degradation (reactive scaling always overrides)

### Non-Goals

- Holiday calendar integration (future enhancement)
- Per-minute granularity (hourly is sufficient)
- Scaling components other than op-geth (see Proposal 12)

### Monthly Savings Estimate

| Scenario | Before (fixed 2 vCPU) | After (scheduled) | Savings |
|----------|----------------------|-------------------|---------|
| Night hours (10h × 30d) | $27.9 | $14.0 (1 vCPU) | $14/mo |
| Weekend (48h × 4w) | $17.9 | $8.9 (1 vCPU) | $9/mo |
| **Total** | | | **~$23/mo (28%)** |

---

## 2. Architecture

### Data Flow

```
┌─ Usage Tracker (7×24 buckets, existing) ─────────────┐
│  analyzePatterns(7) → UsagePattern[]                  │
│  e.g., { dayOfWeek: 0, hourOfDay: 2, avgVcpu: 0.8 }  │
└──────────────┬────────────────────────────────────────┘
               ▼
   ┌─ Scheduled Scaler (NEW: src/lib/scheduled-scaler.ts) ─┐
   │  1. buildScheduleProfile(patterns) → ScheduleProfile  │
   │  2. getCurrentScheduledVcpu(profile) → TargetVcpu      │
   │  3. applyScheduledScaling() → ScaleResult | null       │
   └──────────────┬────────────────────────────────────────┘
                  ▼
   ┌─ Scheduler (existing: src/lib/scheduler.ts) ──────────┐
   │  New cron: '0 * * * *' (every hour, :00)               │
   │  → applyScheduledScaling()                              │
   └──────────────┬────────────────────────────────────────┘
                  ▼
   ┌─ K8s Scaler (existing: src/lib/k8s-scaler.ts) ────────┐
   │  scaleOpGeth(targetVcpu, targetMemoryGiB, config)       │
   │  + addScalingHistory({ triggeredBy: 'cron' })           │
   └─────────────────────────────────────────────────────────┘
```

### Integration Points

| Module | File | Usage |
|--------|------|-------|
| Usage Tracker | `src/lib/usage-tracker.ts` | `analyzePatterns(7)` → pattern data |
| Scheduler | `src/lib/scheduler.ts` | Register new cron task |
| K8s Scaler | `src/lib/k8s-scaler.ts` | `scaleOpGeth()`, `getCurrentVcpu()`, `checkCooldown()`, `isAutoScalingEnabled()` |
| Scaling Decision | `src/lib/scaling-decision.ts` | `makeScalingDecision()` for reactive override check |
| Daily Accumulator | `src/lib/daily-accumulator.ts` | `addScalingEvent()` for recording |
| State Store | `src/lib/redis-store.ts` | Profile persistence (IStateStore extension) |
| Agent Loop | `src/lib/agent-loop.ts` | Read-only: check if scheduled scaling is appropriate |

### State Management

Extends `IStateStore` with schedule profile storage:
- `getScheduleProfile(): Promise<ScheduleProfile | null>`
- `setScheduleProfile(profile: ScheduleProfile): Promise<void>`

---

## 3. Detailed Design

### 3.1 New Types

**File: `src/types/scheduled-scaling.ts`** (NEW)

```typescript
/**
 * Scheduled Scaling Types
 * Time-based automatic vCPU scaling based on learned usage patterns.
 */

import type { TargetVcpu } from './scaling';

/** A single hour slot in the schedule */
export interface ScheduleSlot {
  dayOfWeek: number;       // 0 (Sun) - 6 (Sat)
  hourOfDay: number;       // 0-23
  targetVcpu: TargetVcpu;  // 1 | 2 | 4
  avgUtilization: number;  // Historical average CPU% for this slot
  sampleCount: number;     // Number of data points backing this slot
}

/** Complete 7×24 schedule profile */
export interface ScheduleProfile {
  id: string;                         // "sched-{timestamp}"
  generatedAt: string;                // ISO 8601
  slots: ScheduleSlot[];              // 168 slots (7 days × 24 hours)
  metadata: {
    dataPointCount: number;           // Total data points used
    coveragePct: number;              // % of 168 slots with data (0-100)
    avgDailyVcpu: number;             // Average scheduled vCPU across all slots
    estimatedMonthlySavings: number;  // USD vs fixed baseline
  };
}

/** Schedule execution result */
export interface ScheduleExecutionResult {
  timestamp: string;
  slot: ScheduleSlot;
  previousVcpu: number;
  targetVcpu: TargetVcpu;
  executed: boolean;
  skippedReason?: string;  // 'reactive-override' | 'cooldown' | 'already-at-target' | 'auto-scaling-disabled' | 'insufficient-data'
}

/** Configuration for scheduled scaling */
export interface ScheduledScalingConfig {
  enabled: boolean;
  minDataDays: number;            // Minimum days of data before activation (default: 7)
  minCoveragePct: number;         // Minimum slot coverage % (default: 60)
  profileRefreshIntervalHours: number;  // How often to regenerate profile (default: 24)
  reactiveOverride: boolean;      // Allow reactive scaling to override (default: true, should never be false)
}

export const DEFAULT_SCHEDULED_SCALING_CONFIG: ScheduledScalingConfig = {
  enabled: false,
  minDataDays: 7,
  minCoveragePct: 60,
  profileRefreshIntervalHours: 24,
  reactiveOverride: true,
};
```

### 3.2 Core Module

**File: `src/lib/scheduled-scaler.ts`** (NEW, ~200 lines)

```typescript
/**
 * Scheduled Scaler
 * Generates and executes time-based scaling profiles from usage patterns.
 *
 * Priority: Reactive scaling (agent-loop) always overrides scheduled scaling.
 * The schedule sets a "baseline" vCPU, and reactive scaling scales UP from there.
 */

import { analyzePatterns } from '@/lib/usage-tracker';
import { getUsageSummary } from '@/lib/usage-tracker';
import {
  scaleOpGeth,
  getCurrentVcpu,
  checkCooldown,
  isAutoScalingEnabled,
  addScalingHistory,
} from '@/lib/k8s-scaler';
import { makeScalingDecision } from '@/lib/scaling-decision';
import { getRecentMetrics } from '@/lib/metrics-store';
import { addScalingEvent } from '@/lib/daily-accumulator';
import { getStore } from '@/lib/redis-store';
import { calculateMonthlyCost, getBaselineMonthlyCost } from '@/lib/cost-optimizer';
import { DEFAULT_SCALING_CONFIG, type TargetVcpu } from '@/types/scaling';
import type {
  ScheduleProfile,
  ScheduleSlot,
  ScheduleExecutionResult,
  ScheduledScalingConfig,
} from '@/types/scheduled-scaling';

// ============================================================
// Constants
// ============================================================

const VCPU_THRESHOLDS = {
  LOW: 30,    // avgUtilization < 30% → 1 vCPU
  HIGH: 70,   // avgUtilization >= 70% → 4 vCPU
  // 30-70% → 2 vCPU
};

const MIN_SAMPLES_PER_SLOT = 2;

// ============================================================
// Profile Generation
// ============================================================

/**
 * Build a 7×24 schedule profile from usage patterns.
 * Returns null if insufficient data.
 */
export async function buildScheduleProfile(): Promise<ScheduleProfile | null>
```

**Logic for `buildScheduleProfile()`:**
1. Call `analyzePatterns(7)` → `UsagePattern[]`
2. Call `getUsageSummary(7)` → check `dataPointCount` and `oldestDataAge`
3. If `oldestDataAge < minDataDays * 24` → return null (insufficient data)
4. For each pattern, determine `targetVcpu`:
   - `avgUtilization < 30` → 1 vCPU
   - `avgUtilization >= 70` → 4 vCPU
   - else → 2 vCPU
5. Create `ScheduleSlot` for each of 168 hour-day combinations
6. For slots with no data (`sampleCount === 0`), use the nearest neighbor's value or default 2 vCPU
7. Calculate `coveragePct` = (slots with sampleCount >= MIN_SAMPLES_PER_SLOT) / 168 × 100
8. Calculate `estimatedMonthlySavings` = `getBaselineMonthlyCost()` - `calculateMonthlyCost(avgDailyVcpu)`
9. Return `ScheduleProfile`

```typescript
/**
 * Get the target vCPU for the current time from the profile.
 */
export function getCurrentScheduledVcpu(profile: ScheduleProfile): ScheduleSlot | null
```

**Logic for `getCurrentScheduledVcpu()`:**
1. Get current time in Asia/Seoul timezone
2. Extract `dayOfWeek` (0=Sun) and `hourOfDay` (0-23)
3. Find matching slot in `profile.slots`
4. Return the slot (or null if not found)

```typescript
/**
 * Apply scheduled scaling for the current hour.
 * Called by the scheduler cron job every hour.
 *
 * Returns execution result, or null if scheduled scaling is disabled.
 */
export async function applyScheduledScaling(): Promise<ScheduleExecutionResult | null>
```

**Logic for `applyScheduledScaling()`:**
1. Check `SCHEDULED_SCALING_ENABLED` env var — skip if not `'true'`
2. Load profile from store: `getStore().getScheduleProfile()`
3. If no profile or profile is stale (> `profileRefreshIntervalHours`), regenerate:
   - Call `buildScheduleProfile()`
   - If null (insufficient data), return `{ skippedReason: 'insufficient-data' }`
   - Save to store: `getStore().setScheduleProfile(profile)`
4. Get current slot: `getCurrentScheduledVcpu(profile)`
5. Get current state: `getCurrentVcpu()`, `checkCooldown()`, `isAutoScalingEnabled()`
6. **Reactive override check**: Get latest metrics from `getRecentMetrics(1)`. If latest metric exists:
   - Call `makeScalingDecision(metrics)` to get reactive target
   - If `reactiveTarget > scheduledTarget`, use `reactiveTarget` → `skippedReason: 'reactive-override'`
7. If `!autoScalingEnabled` → skip
8. If `cooldown.inCooldown` → skip
9. If `scheduledTarget === currentVcpu` → skip (already at target)
10. Execute: `scaleOpGeth(scheduledTarget, scheduledTarget * 2, config)`
11. Record: `addScalingHistory({ triggeredBy: 'cron' })`, `addScalingEvent({ trigger: 'auto' })`
12. Return `ScheduleExecutionResult`

```typescript
/**
 * Get current schedule profile (for API/dashboard display).
 */
export async function getScheduleProfile(): Promise<ScheduleProfile | null>

/**
 * Force profile regeneration (for manual trigger via API).
 */
export async function regenerateProfile(): Promise<ScheduleProfile | null>
```

### 3.3 Scheduler Integration

**File: `src/lib/scheduler.ts`** (MODIFY)

Add new cron task inside `initializeScheduler()`:

```typescript
// === EXISTING IMPORTS — add: ===
import { applyScheduledScaling } from '@/lib/scheduled-scaler';

// === EXISTING MODULE STATE — add: ===
let scheduledScalingTask: ScheduledTask | null = null;
let scheduledScalingTaskRunning = false;

// === INSIDE initializeScheduler(), after daily report task: ===

// Scheduled Scaling — every hour at :00
scheduledScalingTask = cron.schedule('0 * * * *', async () => {
  if (scheduledScalingTaskRunning) return;
  scheduledScalingTaskRunning = true;
  try {
    const result = await applyScheduledScaling();
    if (result?.executed) {
      console.log(`[Scheduler] Scheduled scaling: ${result.previousVcpu} → ${result.targetVcpu} vCPU`);
    }
  } catch (error) {
    console.error('[Scheduler] Scheduled scaling failed:', error instanceof Error ? error.message : error);
  } finally {
    scheduledScalingTaskRunning = false;
  }
}, { timezone: 'Asia/Seoul' });

// === INSIDE stopScheduler(), add: ===
scheduledScalingTask?.stop();
scheduledScalingTask = null;

// === INSIDE getSchedulerStatus() return, add: ===
scheduledScalingTaskRunning,
```

### 3.4 API Endpoint

**File: `src/app/api/scheduled-scaling/route.ts`** (NEW)

```typescript
import { NextResponse } from 'next/server';
import { getScheduleProfile, regenerateProfile, applyScheduledScaling } from '@/lib/scheduled-scaler';

// GET /api/scheduled-scaling — Get current profile and status
export async function GET() {
  const profile = await getScheduleProfile();
  const enabled = process.env.SCHEDULED_SCALING_ENABLED === 'true';
  return NextResponse.json({
    enabled,
    profile,
    message: !enabled
      ? 'Scheduled scaling is disabled. Set SCHEDULED_SCALING_ENABLED=true'
      : !profile
        ? 'No schedule profile yet. Minimum 7 days of data required.'
        : 'Schedule profile active',
  });
}

// POST /api/scheduled-scaling — Force profile regeneration or manual execution
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = (body as Record<string, unknown>).action as string;

  if (action === 'regenerate') {
    const profile = await regenerateProfile();
    return NextResponse.json({ success: !!profile, profile });
  }

  if (action === 'execute') {
    const result = await applyScheduledScaling();
    return NextResponse.json({ success: result?.executed ?? false, result });
  }

  return NextResponse.json({ error: 'Invalid action. Use "regenerate" or "execute"' }, { status: 400 });
}
```

### 3.5 Dashboard UI

No dashboard changes required. The schedule can be viewed via the API endpoint. Future enhancement: add a 7×24 heatmap visualization.

### 3.6 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCHEDULED_SCALING_ENABLED` | `false` | Enable time-based scheduled scaling |

Add to `.env.local.sample`:
```bash
# === Scheduled Scaling (Optional) ===
# SCHEDULED_SCALING_ENABLED=true   # Time-based auto-scaling from learned usage patterns (requires 7+ days data)
```

Add to `CLAUDE.md` Optional env vars table:
```
| `SCHEDULED_SCALING_ENABLED` | `false` | Time-based auto-scaling from usage patterns |
```

---

## 4. Implementation Guide

### File Changes

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `src/types/scheduled-scaling.ts` | CREATE | New type definitions (~60 lines) |
| 2 | `src/lib/scheduled-scaler.ts` | CREATE | Core module (~200 lines) |
| 3 | `src/lib/scheduler.ts` | MODIFY | Add cron task (+20 lines) |
| 4 | `src/types/redis.ts` | MODIFY | Add `IStateStore` methods (+4 lines) |
| 5 | `src/lib/state-store.ts` | MODIFY | Add InMemoryStateStore methods (+15 lines) |
| 6 | `src/lib/redis-state-store.ts` | MODIFY | Add RedisStateStore methods (+20 lines) |
| 7 | `src/app/api/scheduled-scaling/route.ts` | CREATE | API endpoint (~40 lines) |
| 8 | `src/lib/__tests__/scheduled-scaler.test.ts` | CREATE | Tests (~200 lines) |
| 9 | `.env.local.sample` | MODIFY | Add env var (+2 lines) |
| 10 | `CLAUDE.md` | MODIFY | Add env var + API route (+3 lines) |

### Reusable Functions (exact imports)

```typescript
// From usage-tracker.ts
import { analyzePatterns, getUsageSummary } from '@/lib/usage-tracker';
// analyzePatterns(days: number = 7): Promise<UsagePattern[]>
// getUsageSummary(days: number = 7): Promise<{ avgVcpu, peakVcpu, avgUtilization, dataPointCount, oldestDataAge }>

// From k8s-scaler.ts
import {
  scaleOpGeth,        // (targetVcpu, targetMemoryGiB, config?, dryRun?) => Promise<ScaleResult>
  getCurrentVcpu,     // (config?) => Promise<number>
  checkCooldown,      // (config?) => Promise<{ inCooldown, remainingSeconds }>
  isAutoScalingEnabled, // () => Promise<boolean>
  addScalingHistory,  // (entry: ScalingHistoryEntry) => Promise<void>
} from '@/lib/k8s-scaler';

// From scaling-decision.ts
import { makeScalingDecision } from '@/lib/scaling-decision';
// makeScalingDecision(metrics: ScalingMetrics, config?) => ScalingDecision

// From metrics-store.ts
import { getRecentMetrics } from '@/lib/metrics-store';
// getRecentMetrics(count?: number) => Promise<MetricDataPoint[]>

// From cost-optimizer.ts
import { calculateMonthlyCost, getBaselineMonthlyCost } from '@/lib/cost-optimizer';
// calculateMonthlyCost(avgVcpu: number) => number
// getBaselineMonthlyCost() => number (fixed 4 vCPU baseline)

// From daily-accumulator.ts
import { addScalingEvent } from '@/lib/daily-accumulator';
// addScalingEvent(event: ScalingEvent) => Promise<void>

// From redis-store.ts
import { getStore } from '@/lib/redis-store';
// getStore() => IStateStore
```

### Implementation Order

1. `src/types/scheduled-scaling.ts` — Types first (no dependencies)
2. `src/types/redis.ts` — Add IStateStore methods
3. `src/lib/state-store.ts` — InMemoryStateStore implementation
4. `src/lib/redis-state-store.ts` — RedisStateStore implementation
5. `src/lib/scheduled-scaler.ts` — Core logic
6. `src/lib/scheduler.ts` — Cron integration
7. `src/app/api/scheduled-scaling/route.ts` — API endpoint
8. `src/lib/__tests__/scheduled-scaler.test.ts` — Tests
9. `.env.local.sample` + `CLAUDE.md` — Config

### IStateStore Extension

Add to `src/types/redis.ts` (`IStateStore` interface):

```typescript
// Scheduled Scaling Profile
getScheduleProfile(): Promise<ScheduleProfile | null>;
setScheduleProfile(profile: ScheduleProfile): Promise<void>;
```

Add to `src/lib/state-store.ts` (`InMemoryStateStore`):

```typescript
private scheduleProfile: ScheduleProfile | null = null;

async getScheduleProfile(): Promise<ScheduleProfile | null> {
  return this.scheduleProfile;
}

async setScheduleProfile(profile: ScheduleProfile): Promise<void> {
  this.scheduleProfile = profile;
}
```

Add to `src/lib/redis-state-store.ts` (`RedisStateStore`):

```typescript
async getScheduleProfile(): Promise<ScheduleProfile | null> {
  const data = await this.client.get('sentinai:schedule-profile');
  return data ? JSON.parse(data) : null;
}

async setScheduleProfile(profile: ScheduleProfile): Promise<void> {
  await this.client.set('sentinai:schedule-profile', JSON.stringify(profile));
}
```

---

## 5. Test Specification

**File: `src/lib/__tests__/scheduled-scaler.test.ts`** (NEW)

### Mock Strategy

```typescript
vi.mock('@/lib/usage-tracker', () => ({
  analyzePatterns: vi.fn(),
  getUsageSummary: vi.fn(),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  scaleOpGeth: vi.fn().mockResolvedValue({
    success: true, previousVcpu: 2, currentVcpu: 1,
    previousMemoryGiB: 4, currentMemoryGiB: 2,
    timestamp: new Date().toISOString(), message: 'OK',
  }),
  getCurrentVcpu: vi.fn().mockResolvedValue(2),
  checkCooldown: vi.fn().mockResolvedValue({ inCooldown: false, remainingSeconds: 0 }),
  isAutoScalingEnabled: vi.fn().mockResolvedValue(true),
  addScalingHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/scaling-decision', () => ({
  makeScalingDecision: vi.fn().mockReturnValue({
    targetVcpu: 1, score: 20, reason: 'idle',
    targetMemoryGiB: 2, confidence: 0.8,
    breakdown: { cpuScore: 20, gasScore: 10, txPoolScore: 10, aiScore: 0 },
  }),
}));

vi.mock('@/lib/metrics-store', () => ({
  getRecentMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/daily-accumulator', () => ({
  addScalingEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getScheduleProfile: vi.fn().mockResolvedValue(null),
    setScheduleProfile: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### Test Cases

```
describe('scheduled-scaler')
  describe('buildScheduleProfile')
    it('should return null when insufficient data (< 7 days)')
    it('should return null when data coverage < 60%')
    it('should build valid 168-slot profile from patterns')
    it('should map low utilization (< 30%) to 1 vCPU')
    it('should map medium utilization (30-70%) to 2 vCPU')
    it('should map high utilization (>= 70%) to 4 vCPU')
    it('should fill empty slots with nearest neighbor values')
    it('should calculate estimated monthly savings correctly')

  describe('getCurrentScheduledVcpu')
    it('should return correct slot for current time')
    it('should handle timezone conversion (Asia/Seoul)')
    it('should return null for empty profile')

  describe('applyScheduledScaling')
    it('should skip when SCHEDULED_SCALING_ENABLED is not true')
    it('should skip when auto-scaling is disabled')
    it('should skip when in cooldown')
    it('should skip when already at target vCPU')
    it('should execute scaling when target differs from current')
    it('should yield to reactive scaling when reactive target is higher')
    it('should not yield to reactive when scheduled target is higher')
    it('should regenerate profile when stale (> 24h)')
    it('should record scaling history with triggeredBy: cron')
    it('should record scaling event in daily accumulator')

  describe('getScheduleProfile')
    it('should return stored profile')
    it('should return null when no profile exists')

  describe('regenerateProfile')
    it('should force rebuild and save new profile')
```

### Minimum Coverage Target

- Statement coverage: ≥ 85%
- Branch coverage: ≥ 80%
- All edge cases (insufficient data, cooldown, reactive override) covered

---

## 6. Verification

### Step 1: Build

```bash
npm run build
```

Expected: No TypeScript errors.

### Step 2: Unit Tests

```bash
npx vitest run src/lib/__tests__/scheduled-scaler.test.ts
```

Expected: All tests pass.

### Step 3: Integration Smoke Test

```bash
# Start dev server
npm run dev

# Check API (should show disabled state)
curl http://localhost:3002/api/scheduled-scaling | jq .
# Expected: { "enabled": false, "profile": null, "message": "Scheduled scaling is disabled..." }

# Enable and trigger manually (for testing)
SCHEDULED_SCALING_ENABLED=true npm run dev
curl -X POST http://localhost:3002/api/scheduled-scaling \
  -H 'Content-Type: application/json' \
  -d '{"action": "regenerate"}' | jq .
# Expected: { "success": false, "profile": null } (insufficient data)
```

### Step 4: Full Test Suite

```bash
npm run test:run
```

Expected: All existing tests still pass + new tests pass.
