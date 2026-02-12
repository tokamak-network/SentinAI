# Proposal 17: Multi-Component Right-Sizing

## 1. Overview

### Problem Statement

SentinAI currently scales only **op-geth** (`sepolia-thanos-stack-op-geth`). However, the EKS cluster runs 4+ Optimism components, each with vastly different resource needs:

| Component | CPU Characteristic | Typical Allocation | Actual Need | Waste |
|-----------|-------------------|-------------------|-------------|-------|
| op-geth | Block execution, I/O heavy | 1-4 vCPU (auto-scaled) | 1-4 vCPU | **Already optimized** |
| op-node | Block derivation, periodic | 1 vCPU, 2 GiB | 0.25-0.5 vCPU | **75% idle** |
| op-batcher | L1 submission every 2-5 min | 1 vCPU, 2 GiB | 0.25 vCPU | **90% idle** |
| op-proposer | State proposal, very light | 0.5 vCPU, 1 GiB | 0.125 vCPU | **90% idle** |

These components run 24/7 at fixed resource allocations, wasting ~$50/month in over-provisioned compute.

### Solution Summary

Implement a **Component Resource Analyzer** that:
1. Collects CPU/Memory usage for all L2 components via `kubectl top pod`
2. Maintains per-component usage history (48-hour observation window)
3. Calculates right-sized resource recommendations with 20% safety margin
4. Auto-applies right-sizing via `kubectl patch statefulset`
5. Independent cooldown per component (no interference with op-geth scaling)

### Goals

- Right-size op-node, op-batcher, op-proposer resources based on actual usage
- Save ~$50/month from over-provisioned sidecar components
- Independent operation from existing op-geth scaling engine
- Safe minimum thresholds to prevent OOM or CPU throttling

### Non-Goals

- Scaling op-geth (already handled by `scaling-decision.ts` + `k8s-scaler.ts`)
- Horizontal scaling (replica count changes)
- Proxyd scaling (runs on minimal resources)
- Cross-component dependency analysis

### Monthly Savings Estimate

| Component | Current | Right-Sized | Monthly Savings |
|-----------|---------|-------------|-----------------|
| op-node | 1 vCPU, 2 GiB | 0.5 vCPU, 1 GiB | **$17** |
| op-batcher | 1 vCPU, 2 GiB | 0.25 vCPU, 0.5 GiB | **$25** |
| op-proposer | 0.5 vCPU, 1 GiB | 0.25 vCPU, 0.5 GiB | **$8** |
| **Total** | | | **~$50/mo** |

---

## 2. Architecture

### Data Flow

```
┌─ Agent Loop (30s cycle, existing) ─────────────────────────┐
│                                                             │
│  Phase 5 (NEW): collectComponentMetrics()                   │
│       ├─> kubectl top pod -l app=op-node -n {ns}            │
│       ├─> kubectl top pod -l app=op-batcher -n {ns}         │
│       └─> kubectl top pod -l app=op-proposer -n {ns}        │
│                      ▼                                      │
│  ComponentResourceAnalyzer                                  │
│       ├─> recordComponentUsage(component, cpu, mem)         │
│       └─> [every 6 hours] evaluateRightSizing()             │
│                      ▼                                      │
│  [currentAlloc > recommended × 1.2]                         │
│       └─> kubectl patch statefulset {component} -n {ns}     │
└─────────────────────────────────────────────────────────────┘
```

### Integration Points

| Module | File | Usage |
|--------|------|-------|
| K8s Config | `src/lib/k8s-config.ts` | `runK8sCommand()` for kubectl top + patch |
| Agent Loop | `src/lib/agent-loop.ts` | Phase 5 integration |
| Daily Accumulator | `src/lib/daily-accumulator.ts` | Record right-sizing events |
| State Store | `src/lib/redis-store.ts` | Usage history persistence |

### State Management

Extends `IStateStore`:
- `getComponentUsageHistory(component: string): Promise<ComponentUsagePoint[]>`
- `pushComponentUsage(component: string, point: ComponentUsagePoint): Promise<void>`
- `getComponentRightSizingState(): Promise<ComponentRightSizingState | null>`
- `setComponentRightSizingState(state: ComponentRightSizingState): Promise<void>`

---

## 3. Detailed Design

### 3.1 New Types

**File: `src/types/component-rightsizing.ts`** (NEW)

```typescript
/**
 * Multi-Component Right-Sizing Types
 * Independent resource optimization for op-node, op-batcher, op-proposer.
 */

/** Supported L2 components (excluding op-geth which has its own scaler) */
export type L2Component = 'op-node' | 'op-batcher' | 'op-proposer';

export const L2_COMPONENTS: L2Component[] = ['op-node', 'op-batcher', 'op-proposer'];

/** Single usage data point */
export interface ComponentUsagePoint {
  timestamp: number;            // Unix timestamp (ms)
  cpuMillicores: number;        // Actual CPU usage in millicores
  memoryMiB: number;            // Actual memory usage in MiB
}

/** Resource allocation for a component */
export interface ComponentResources {
  cpuMillicores: number;        // Allocated CPU (requests = limits)
  memoryMiB: number;            // Allocated memory (requests = limits)
}

/** Right-sizing recommendation for a component */
export interface RightSizingRecommendation {
  component: L2Component;
  currentResources: ComponentResources;
  recommendedResources: ComponentResources;
  peakCpu: number;              // Peak CPU observed in window (millicores)
  peakMemory: number;           // Peak memory observed (MiB)
  avgCpu: number;               // Average CPU (millicores)
  avgMemory: number;            // Average memory (MiB)
  sampleCount: number;          // Data points in observation window
  savingsMonthly: number;       // Estimated USD savings
  confidence: number;           // 0-1 based on sample count and variance
}

/** Right-sizing execution result */
export interface RightSizingResult {
  component: L2Component;
  statefulSetName: string;
  previousResources: ComponentResources;
  newResources: ComponentResources;
  executed: boolean;
  skippedReason?: string;       // 'insufficient-data' | 'cooldown' | 'already-optimal' | 'simulation' | 'disabled'
  timestamp: string;
}

/** Per-component state tracking */
export interface ComponentState {
  component: L2Component;
  lastRightSizeTime: number | null;   // Unix timestamp of last resize
  lastEvaluationTime: number | null;  // Unix timestamp of last evaluation
  currentResources: ComponentResources | null;
}

/** Overall right-sizing state */
export interface ComponentRightSizingState {
  components: ComponentState[];
  lastCollectionTime: number;
}

/** Configuration */
export interface ComponentRightSizingConfig {
  enabled: boolean;
  observationWindowHours: number;      // Minimum observation before first resize (default: 48)
  evaluationIntervalHours: number;     // How often to evaluate (default: 6)
  cooldownHours: number;               // Per-component cooldown (default: 12)
  safetyMarginPct: number;             // Safety margin above peak (default: 20)
  minCpuMillicores: number;            // Absolute minimum CPU (default: 125 = 0.125 vCPU)
  minMemoryMiB: number;               // Absolute minimum memory (default: 256)
}

export const DEFAULT_COMPONENT_RIGHTSIZING_CONFIG: ComponentRightSizingConfig = {
  enabled: false,
  observationWindowHours: 48,
  evaluationIntervalHours: 6,
  cooldownHours: 12,
  safetyMarginPct: 20,
  minCpuMillicores: 125,
  minMemoryMiB: 256,
};

/** Fargate pricing for savings calculation */
export const FARGATE_PRICING = {
  vcpuPerHour: 0.04656,          // USD per vCPU-hour (Seoul)
  memGbPerHour: 0.00511,         // USD per GB-hour (Seoul)
  hoursPerMonth: 730,
};
```

### 3.2 Core Module

**File: `src/lib/component-rightsizer.ts`** (NEW, ~280 lines)

```typescript
/**
 * Component Right-Sizer
 * Collects resource usage for op-node, op-batcher, op-proposer
 * and applies right-sizing recommendations.
 */

import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
import { getStore } from '@/lib/redis-store';
import type {
  L2Component,
  L2_COMPONENTS,
  ComponentUsagePoint,
  ComponentResources,
  RightSizingRecommendation,
  RightSizingResult,
  ComponentRightSizingConfig,
  ComponentRightSizingState,
} from '@/types/component-rightsizing';

// ============================================================
// Constants
// ============================================================

const STATEFULSET_PREFIX = process.env.K8S_STATEFULSET_PREFIX || 'sepolia-thanos-stack';
const MAX_USAGE_POINTS = 5760;  // 48 hours at 30s intervals

// ============================================================
// Resource Collection
// ============================================================

/**
 * Get the StatefulSet name for a component.
 * Pattern: {prefix}-{component} (e.g., 'sepolia-thanos-stack-op-node')
 */
export function getStatefulSetName(component: L2Component): string {
  return `${STATEFULSET_PREFIX}-${component}`;
}

/**
 * Collect current CPU/Memory usage for a component via kubectl top pod.
 * Returns null if the command fails or pod is not found.
 *
 * kubectl top pod -l app={prefix}-{component} -n {namespace} --no-headers
 * Output format: "pod-name-0   125m   256Mi"
 */
export async function collectComponentUsage(
  component: L2Component
): Promise<ComponentUsagePoint | null>
```

**Logic for `collectComponentUsage()`:**
1. Build label: `app=${getAppPrefix()}-${component}` (e.g., `app=op-node`)
2. `runK8sCommand(`top pod -l app=${label} -n ${getNamespace()} --no-headers`)`
3. Parse output: extract CPU (e.g., `125m` → 125 millicores) and Memory (e.g., `256Mi` → 256 MiB)
4. Handle `cpu` ending in `m` (millicores) vs plain number (cores × 1000)
5. Handle `memory` ending in `Mi`, `Gi`, `Ki`
6. Return `ComponentUsagePoint` or null on failure

```typescript
/**
 * Collect usage for all components and store.
 * Called from agent loop every 30 seconds.
 */
export async function collectAllComponentMetrics(): Promise<void>
```

**Logic for `collectAllComponentMetrics()`:**
1. For each component in `L2_COMPONENTS`:
   - `collectComponentUsage(component)`
   - If result: `getStore().pushComponentUsage(component, point)`
2. All calls in parallel (`Promise.allSettled`)

```typescript
// ============================================================
// Right-Sizing Analysis
// ============================================================

/**
 * Get current resource allocation for a component from StatefulSet spec.
 *
 * kubectl get statefulset {name} -n {ns}
 *   -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu},{.spec.template.spec.containers[0].resources.requests.memory}'
 */
export async function getCurrentAllocation(
  component: L2Component
): Promise<ComponentResources | null>

/**
 * Calculate right-sizing recommendation for a component.
 */
export function calculateRecommendation(
  component: L2Component,
  history: ComponentUsagePoint[],
  currentResources: ComponentResources,
  config: ComponentRightSizingConfig
): RightSizingRecommendation | null
```

**Logic for `calculateRecommendation()`:**
1. If `history.length < 100` (< ~50 min), return null (insufficient data)
2. Calculate stats: `avgCpu`, `peakCpu`, `avgMemory`, `peakMemory`
3. Recommended CPU = `peakCpu × (1 + safetyMarginPct / 100)`
4. Recommended Memory = `peakMemory × (1 + safetyMarginPct / 100)`
5. Clamp to minimums: `max(recommended, minCpuMillicores)`, `max(recommended, minMemoryMiB)`
6. Round CPU to nearest 125m (Fargate granularity: 0.125 vCPU)
7. Round Memory to nearest 256 MiB
8. Calculate savings: `(currentCost - recommendedCost) * hoursPerMonth`
9. Confidence = `min(1.0, sampleCount / 5760)` (full confidence at 48h of data)

```typescript
/**
 * Evaluate and apply right-sizing for all components.
 * Called every 6 hours (evaluationIntervalHours).
 */
export async function evaluateAndApplyRightSizing(): Promise<RightSizingResult[]>
```

**Logic for `evaluateAndApplyRightSizing()`:**
1. Check `COMPONENT_RIGHTSIZING_ENABLED` env var
2. Load state from store
3. For each component:
   - Check cooldown (last right-size > cooldownHours ago?)
   - Check observation window (oldest data > observationWindowHours?)
   - Get history: `getStore().getComponentUsageHistory(component)`
   - Get current allocation: `getCurrentAllocation(component)`
   - Calculate recommendation
   - If `currentResources > recommendedResources` (over-provisioned):
     - Apply via `kubectl patch statefulset`
     - Record result
   - If `currentResources < recommendedResources` (under-provisioned):
     - Apply scale-up (safety first)
     - Record result
4. Save state to store
5. Return results

```typescript
/**
 * Apply resource changes to a StatefulSet.
 *
 * kubectl patch statefulset {name} -n {ns} --type=json -p '[
 *   {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/cpu","value":"{cpu}m"},
 *   {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/cpu","value":"{cpu}m"},
 *   {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"{mem}Mi"},
 *   {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"{mem}Mi"}
 * ]'
 */
async function applyResourcePatch(
  component: L2Component,
  resources: ComponentResources
): Promise<boolean>

/**
 * Get right-sizing status for all components (for API/dashboard).
 */
export async function getRightSizingStatus(): Promise<{
  enabled: boolean;
  components: Array<{
    component: L2Component;
    currentResources: ComponentResources | null;
    recommendation: RightSizingRecommendation | null;
    lastRightSizeTime: string | null;
    dataPoints: number;
  }>;
}>
```

### 3.3 Agent Loop Integration

**File: `src/lib/agent-loop.ts`** (MODIFY)

Add after Phase 3+4 (Decide & Act):

```typescript
// === IMPORT — add: ===
import { collectAllComponentMetrics, evaluateAndApplyRightSizing } from '@/lib/component-rightsizer';

// === INSIDE runAgentCycle(), after scaling evaluation: ===

// Phase 5: Component right-sizing (non-blocking)
try {
  await collectAllComponentMetrics();

  // Evaluate every 6 hours (check if enough time has passed)
  const rightSizingState = await getStore().getComponentRightSizingState();
  const lastEval = rightSizingState?.components[0]?.lastEvaluationTime ?? 0;
  const evalIntervalMs = 6 * 60 * 60 * 1000; // 6 hours
  if (Date.now() - lastEval >= evalIntervalMs) {
    const results = await evaluateAndApplyRightSizing();
    const applied = results.filter(r => r.executed);
    if (applied.length > 0) {
      console.log(`[AgentLoop] Right-sizing applied: ${applied.map(r => `${r.component} → ${r.newResources.cpuMillicores}m`).join(', ')}`);
    }
  }
} catch {
  // Non-blocking — continue cycle
}
```

### 3.4 API Endpoint

**File: `src/app/api/component-rightsizing/route.ts`** (NEW)

```typescript
import { NextResponse } from 'next/server';
import { getRightSizingStatus, evaluateAndApplyRightSizing } from '@/lib/component-rightsizer';

// GET — Current status and recommendations
export async function GET() {
  const status = await getRightSizingStatus();
  return NextResponse.json(status);
}

// POST — Force evaluation
export async function POST() {
  const results = await evaluateAndApplyRightSizing();
  return NextResponse.json({ results });
}
```

### 3.5 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPONENT_RIGHTSIZING_ENABLED` | `false` | Enable multi-component right-sizing |

Add to `.env.local.sample`:
```bash
# === Component Right-Sizing (Optional) ===
# COMPONENT_RIGHTSIZING_ENABLED=true  # Auto-optimize op-node, op-batcher, op-proposer resources
```

---

## 4. Implementation Guide

### File Changes

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `src/types/component-rightsizing.ts` | CREATE | Type definitions (~100 lines) |
| 2 | `src/lib/component-rightsizer.ts` | CREATE | Core module (~280 lines) |
| 3 | `src/lib/agent-loop.ts` | MODIFY | Phase 5 integration (+18 lines) |
| 4 | `src/types/redis.ts` | MODIFY | IStateStore extension (+4 lines) |
| 5 | `src/lib/state-store.ts` | MODIFY | InMemoryStateStore (+30 lines) |
| 6 | `src/lib/redis-state-store.ts` | MODIFY | RedisStateStore (+40 lines) |
| 7 | `src/app/api/component-rightsizing/route.ts` | CREATE | API endpoint (~20 lines) |
| 8 | `src/lib/__tests__/component-rightsizer.test.ts` | CREATE | Tests (~250 lines) |
| 9 | `.env.local.sample` | MODIFY | Add env var (+2 lines) |
| 10 | `CLAUDE.md` | MODIFY | Add env var + API route (+3 lines) |

### Reusable Functions

```typescript
// From k8s-config.ts
import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
// runK8sCommand(command, options?) → { stdout, stderr }
// getNamespace() → string (K8S_NAMESPACE || 'default')
// getAppPrefix() → string (K8S_APP_PREFIX || 'op')

// From redis-store.ts
import { getStore } from '@/lib/redis-store';
```

### IStateStore Extension

Add to `src/types/redis.ts`:
```typescript
// Component Right-Sizing
getComponentUsageHistory(component: string): Promise<ComponentUsagePoint[]>;
pushComponentUsage(component: string, point: ComponentUsagePoint): Promise<void>;
getComponentRightSizingState(): Promise<ComponentRightSizingState | null>;
setComponentRightSizingState(state: ComponentRightSizingState): Promise<void>;
```

InMemoryStateStore:
```typescript
private componentUsage: Map<string, ComponentUsagePoint[]> = new Map();
private componentRightSizingState: ComponentRightSizingState | null = null;

async getComponentUsageHistory(component: string): Promise<ComponentUsagePoint[]> {
  return this.componentUsage.get(component) || [];
}

async pushComponentUsage(component: string, point: ComponentUsagePoint): Promise<void> {
  const history = this.componentUsage.get(component) || [];
  history.push(point);
  if (history.length > 5760) history.shift(); // 48h at 30s intervals
  this.componentUsage.set(component, history);
}
```

RedisStateStore:
```typescript
// Key pattern: sentinai:component-usage:{component}
// Use Redis LIST with LPUSH + LTRIM(0, 5759)
```

### Implementation Order

1. Types → 2. IStateStore → 3. Store implementations → 4. Core module → 5. Agent loop → 6. API → 7. Tests → 8. Config

---

## 5. Test Specification

**File: `src/lib/__tests__/component-rightsizer.test.ts`** (NEW)

### Mock Strategy

```typescript
vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: vi.fn(),
  getNamespace: vi.fn().mockReturnValue('thanos-sepolia'),
  getAppPrefix: vi.fn().mockReturnValue('op'),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getComponentUsageHistory: vi.fn().mockResolvedValue([]),
    pushComponentUsage: vi.fn().mockResolvedValue(undefined),
    getComponentRightSizingState: vi.fn().mockResolvedValue(null),
    setComponentRightSizingState: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### Test Cases

```
describe('component-rightsizer')
  describe('getStatefulSetName')
    it('should return correct name with prefix')
    it('should use K8S_STATEFULSET_PREFIX env var')

  describe('collectComponentUsage')
    it('should parse kubectl top output correctly (125m, 256Mi)')
    it('should handle CPU in cores (e.g., "1" → 1000m)')
    it('should handle memory in Gi (e.g., "1Gi" → 1024Mi)')
    it('should return null when pod not found')
    it('should return null when kubectl fails')

  describe('collectAllComponentMetrics')
    it('should collect for all 3 components in parallel')
    it('should continue on individual failures')

  describe('getCurrentAllocation')
    it('should parse StatefulSet resource spec')
    it('should return null when StatefulSet not found')

  describe('calculateRecommendation')
    it('should return null with insufficient data (< 100 points)')
    it('should calculate peak × 1.2 safety margin')
    it('should clamp to minimum 125m CPU')
    it('should clamp to minimum 256Mi memory')
    it('should round CPU to nearest 125m')
    it('should round memory to nearest 256Mi')
    it('should calculate correct monthly savings')
    it('should calculate confidence based on sample count')

  describe('evaluateAndApplyRightSizing')
    it('should skip when disabled')
    it('should skip when in cooldown')
    it('should skip when insufficient observation window')
    it('should apply resource patch when over-provisioned')
    it('should apply resource patch when under-provisioned')
    it('should respect simulation mode')
    it('should handle kubectl patch failure gracefully')

  describe('applyResourcePatch')
    it('should construct correct JSON patch')
    it('should return false on kubectl error')
```

### Minimum Coverage Target

- Statement coverage: ≥ 85%
- Branch coverage: ≥ 80%

---

## 6. Verification

### Step 1: Build

```bash
npm run build
```

### Step 2: Unit Tests

```bash
npx vitest run src/lib/__tests__/component-rightsizer.test.ts
```

### Step 3: Integration Test (requires live cluster)

```bash
# Check current allocations
kubectl get statefulset -n thanos-sepolia -o custom-columns=NAME:.metadata.name,CPU:.spec.template.spec.containers[0].resources.requests.cpu,MEM:.spec.template.spec.containers[0].resources.requests.memory

# Enable component right-sizing
COMPONENT_RIGHTSIZING_ENABLED=true npm run dev

# Check status via API
curl http://localhost:3002/api/component-rightsizing | jq .

# Wait for data collection (48h) or force evaluation
curl -X POST http://localhost:3002/api/component-rightsizing | jq .
```

### Step 4: Full Test Suite

```bash
npm run test:run
```
