# Proposal 19: Compute Savings Plans Advisor

## 1. Overview

### Problem Statement

The current `cost-optimizer.ts` generates a `reserved` recommendation type suggesting "Consider Savings Plans", but it:
- Does **not calculate** the optimal commitment amount
- Does **not compare** different commitment levels
- Does **not show** exact dollar savings per commitment option
- Requires users to figure out the right commitment on their own

AWS Fargate Compute Savings Plans offer up to 50% discount with 1-year commitment, but choosing the right commitment level requires analyzing actual usage history to avoid over-committing (paying for unused capacity) or under-committing (leaving savings on the table).

### Solution Summary

Implement a **Savings Plans Advisor** that:
1. Analyzes 30+ days of vCPU usage data from Usage Tracker
2. Calculates percentile-based usage baselines (p10, p25, p50, p75, p90)
3. Simulates multiple commitment levels against actual usage history
4. Shows exact savings and risk for each option
5. Integrates into Daily Report and Cost Report

### Goals

- Provide actionable, data-driven Savings Plans recommendations
- Show exact dollar amounts for each commitment option
- Quantify the risk of over-commitment for each option
- Integrate into existing cost reporting workflow
- No AWS API calls needed (uses local usage data only)

### Non-Goals

- Automatic Savings Plans purchase (manual action, link provided)
- EC2 Reserved Instances (Fargate-only scope)
- Multi-region optimization
- Real-time AWS Pricing API integration (uses hardcoded Fargate Seoul pricing)

### Monthly Savings Estimate

| Commitment Level | Monthly Commitment | On-Demand Equivalent | Annual Savings |
|-----------------|-------------------|---------------------|----------------|
| Conservative (p10) | $24 | $34 (1 vCPU) | **$118/yr ($10/mo)** |
| Recommended (avg) | $44 | $68 (1.8 vCPU) | **$192/yr ($16/mo)** |
| Aggressive (p50) | $68 | $102 (2 vCPU) | **$224/yr ($19/mo)** |

---

## 2. Architecture

### Data Flow

```
┌─ Usage Tracker (existing, 30+ days data) ─────────────┐
│  getUsageData(30) → UsageDataPoint[]                   │
│  getUsageSummary(30) → { avgVcpu, peakVcpu, ... }      │
│  analyzePatterns(30) → UsagePattern[]                   │
└──────────────┬─────────────────────────────────────────┘
               ▼
┌─ Savings Plans Advisor (NEW: src/lib/savings-advisor.ts)─┐
│  1. calculateUsagePercentiles(data) → Percentiles        │
│  2. simulateCommitment(commitment, data) → SimResult     │
│  3. generateSavingsAdvice() → SavingsAdvice              │
│       ├─> Conservative option (p10 baseline)             │
│       ├─> Recommended option (avg baseline)              │
│       ├─> Aggressive option (p50 baseline)               │
│       └─> Custom option (user-specified)                 │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌─ Integration Points ─────────────────────────────────────┐
│  Cost Optimizer: generateCostReport() includes advice     │
│  Daily Report: Weekly summary (Sunday)                    │
│  API: /api/savings-advisor (dedicated endpoint)           │
└──────────────────────────────────────────────────────────┘
```

### Integration Points

| Module | File | Usage |
|--------|------|-------|
| Usage Tracker | `src/lib/usage-tracker.ts` | `getUsageData(30)`, `getUsageSummary(30)`, `analyzePatterns(30)` |
| Cost Optimizer | `src/lib/cost-optimizer.ts` | `generateCostReport()` — include advice in report |
| Daily Report | `src/lib/daily-report-generator.ts` | Weekly summary integration (optional) |
| State Store | `src/lib/redis-store.ts` | Cache advice (regenerate weekly) |

### State Management

Extends `IStateStore`:
- `getSavingsAdvice(): Promise<SavingsAdvice | null>`
- `setSavingsAdvice(advice: SavingsAdvice): Promise<void>`

---

## 3. Detailed Design

### 3.1 New Types

**File: `src/types/savings-advisor.ts`** (NEW)

```typescript
/**
 * Compute Savings Plans Advisor Types
 * Analyzes usage history to recommend optimal Savings Plans commitment.
 */

/** Usage percentiles from historical data */
export interface UsagePercentiles {
  p10: number;   // 10th percentile vCPU (conservative baseline)
  p25: number;   // 25th percentile
  p50: number;   // Median vCPU
  p75: number;   // 75th percentile
  p90: number;   // 90th percentile
  p99: number;   // 99th percentile (peak)
  min: number;
  max: number;
  avg: number;
  dataPointCount: number;
  periodDays: number;
}

/** A single commitment option simulation */
export interface CommitmentOption {
  name: string;                      // 'conservative' | 'recommended' | 'aggressive' | 'custom'
  label: string;                     // Human-readable label
  committedVcpu: number;             // vCPU commitment level
  committedHourlyRate: number;       // USD/hour commitment
  committedMonthlyRate: number;      // USD/month commitment

  // Simulation results
  savingsVsOnDemand: number;         // Monthly USD savings vs full on-demand
  savingsPct: number;                // % savings vs on-demand (0-100)
  annualSavings: number;             // Annual USD savings

  // Risk metrics
  overCommitmentPct: number;         // % of hours where committed > actual (wasted)
  overCommitmentMonthlyWaste: number; // USD/month wasted on unused commitment
  underCommitmentPct: number;        // % of hours where actual > committed (paying on-demand for excess)

  // Effective cost
  effectiveMonthlyTotal: number;     // Commitment + on-demand excess
  effectiveVcpuRate: number;         // Blended $/vCPU-hour
}

/** Complete savings advice */
export interface SavingsAdvice {
  id: string;                        // "savings-{timestamp}"
  generatedAt: string;               // ISO 8601
  dataSource: {
    periodDays: number;
    dataPointCount: number;
    oldestDataAge: number;           // Hours
  };
  percentiles: UsagePercentiles;
  options: CommitmentOption[];        // 3-4 options (conservative, recommended, aggressive, [custom])
  recommendation: string;            // Human-readable summary
  awsPurchaseUrl: string;            // Direct link to AWS Savings Plans purchase page
  caveats: string[];                 // Warnings and considerations
}

/** Configuration */
export interface SavingsAdvisorConfig {
  enabled: boolean;
  minDataDays: number;               // Minimum days of data for valid advice (default: 30)
  savingsRate: number;               // Savings Plans discount rate (default: 0.50 = 50% off on-demand)
  commitmentTerm: '1yr' | '3yr';     // Commitment term (default: '1yr')
  paymentOption: 'no-upfront' | 'partial-upfront' | 'all-upfront'; // (default: 'no-upfront')
}

export const DEFAULT_SAVINGS_ADVISOR_CONFIG: SavingsAdvisorConfig = {
  enabled: true,  // Enabled by default (no side effects, just analysis)
  minDataDays: 30,
  savingsRate: 0.50,
  commitmentTerm: '1yr',
  paymentOption: 'no-upfront',
};

/** Fargate pricing for calculations (Seoul region) */
export const FARGATE_SAVINGS_PRICING = {
  onDemandVcpuPerHour: 0.04656,      // On-demand vCPU rate
  onDemandMemGbPerHour: 0.00511,     // On-demand memory rate
  savingsPlanVcpuPerHour: 0.02328,   // 50% off on-demand (1yr, no upfront)
  memoryRatio: 2,                     // GiB per vCPU (fixed in our setup)
  hoursPerMonth: 730,
  hoursPerYear: 8760,
};
```

### 3.2 Core Module

**File: `src/lib/savings-advisor.ts`** (NEW, ~250 lines)

```typescript
/**
 * Savings Plans Advisor
 * Calculates optimal Compute Savings Plans commitment from usage history.
 *
 * Pure analysis module — no AWS API calls, no side effects.
 * Uses local usage data from usage-tracker.ts.
 */

import { getUsageData, getUsageSummary, analyzePatterns } from '@/lib/usage-tracker';
import { getStore } from '@/lib/redis-store';
import type {
  UsagePercentiles,
  CommitmentOption,
  SavingsAdvice,
  SavingsAdvisorConfig,
  DEFAULT_SAVINGS_ADVISOR_CONFIG,
  FARGATE_SAVINGS_PRICING,
} from '@/types/savings-advisor';
import type { UsageDataPoint } from '@/types/cost';

// ============================================================
// Percentile Calculation
// ============================================================

/**
 * Calculate vCPU usage percentiles from historical data.
 */
export function calculateUsagePercentiles(
  data: UsageDataPoint[],
  periodDays: number
): UsagePercentiles
```

**Logic for `calculateUsagePercentiles()`:**
1. Extract `vcpu` values from all data points
2. Sort ascending
3. Calculate percentiles:
   - p10 = value at index `Math.floor(n * 0.10)`
   - p25, p50, p75, p90, p99 similarly
4. Calculate min, max, avg
5. Return `UsagePercentiles`

```typescript
// ============================================================
// Commitment Simulation
// ============================================================

/**
 * Simulate a specific commitment level against actual usage data.
 * Calculates savings, waste, and effective costs.
 */
export function simulateCommitment(
  committedVcpu: number,
  data: UsageDataPoint[],
  config: SavingsAdvisorConfig
): CommitmentOption
```

**Logic for `simulateCommitment()`:**
1. For each data point:
   - `coveredVcpu = min(dataPoint.vcpu, committedVcpu)`
   - `excessVcpu = max(0, dataPoint.vcpu - committedVcpu)`
   - `coveredCost = coveredVcpu * savingsPlanRate`
   - `excessCost = excessVcpu * onDemandRate`
   - `onDemandCost = dataPoint.vcpu * onDemandRate`
   - `savings += onDemandCost - (coveredCost + excessCost)`
   - If `committedVcpu > dataPoint.vcpu` → overCommitHours++
   - If `dataPoint.vcpu > committedVcpu` → underCommitHours++
2. Extrapolate to monthly:
   - `monthlySavings = (savings / data.length) * hoursPerMonth`
   - `monthlyWaste = (overCommitHours / data.length) * committedVcpu * (savingsPlanRate) * hoursPerMonth`
   - Actually waste = hours where you're paying for unused commitment
3. Calculate rates and percentages
4. Return `CommitmentOption`

Note on cost calculation with memory:
```
// Total hourly cost for X vCPU = X * vcpuRate + X * memoryRatio * memGbRate
// = X * (0.04656 + 2 * 0.00511) = X * 0.05678
// Savings Plan covers vCPU portion only; memory stays on-demand
// Simplified: assume SP discount applies to effective rate
```

```typescript
// ============================================================
// Advice Generation
// ============================================================

/**
 * Generate complete savings advice with multiple commitment options.
 * Returns null if insufficient data.
 */
export async function generateSavingsAdvice(
  config?: Partial<SavingsAdvisorConfig>
): Promise<SavingsAdvice | null>
```

**Logic for `generateSavingsAdvice()`:**
1. Merge config with defaults
2. Get usage data: `getUsageData(config.minDataDays)`
3. Get summary: `getUsageSummary(config.minDataDays)`
4. If `summary.oldestDataAge < config.minDataDays * 24` → return null (insufficient data)
5. Calculate percentiles: `calculateUsagePercentiles(data, config.minDataDays)`
6. Simulate 3 options:
   - **Conservative**: commit at p10 vCPU level
   - **Recommended**: commit at avg vCPU level (capped at p75 to avoid over-commitment)
   - **Aggressive**: commit at p50 vCPU level
7. Sort by `savingsPct` descending
8. Generate recommendation text:
   - "Based on {N} days of data ({M} data points), we recommend committing to {X} vCPU..."
9. Add caveats:
   - "Savings Plans are a 1-year commitment and cannot be cancelled"
   - "Actual savings depend on future usage patterns"
   - "This analysis covers Fargate compute only (not EBS, network, etc.)"
10. Set `awsPurchaseUrl` = `https://console.aws.amazon.com/savingsplans/home#/purchase`
11. Cache in store: `getStore().setSavingsAdvice(advice)`
12. Return `SavingsAdvice`

```typescript
/**
 * Get cached savings advice or generate fresh if stale (> 7 days).
 */
export async function getSavingsAdvice(): Promise<SavingsAdvice | null>
```

**Logic:**
1. Load from store
2. If exists and < 7 days old → return cached
3. Otherwise → `generateSavingsAdvice()`

### 3.3 Cost Optimizer Integration

**File: `src/lib/cost-optimizer.ts`** (MODIFY)

Add savings advice to cost report:

```typescript
// === IMPORT — add: ===
import { getSavingsAdvice } from '@/lib/savings-advisor';

// === INSIDE generateCostReport(), after AI recommendations: ===

// Savings Plans advice (if available)
let savingsAdvice = null;
try {
  savingsAdvice = await getSavingsAdvice();
} catch {
  // Non-blocking
}

// Add to CostReport return (extend type if needed):
return {
  ...report,
  savingsAdvice,  // SavingsAdvice | null
};
```

### 3.4 API Endpoint

**File: `src/app/api/savings-advisor/route.ts`** (NEW)

```typescript
import { NextResponse } from 'next/server';
import { getSavingsAdvice, generateSavingsAdvice } from '@/lib/savings-advisor';

// GET /api/savings-advisor — Get current advice
export async function GET() {
  const advice = await getSavingsAdvice();
  if (!advice) {
    return NextResponse.json({
      available: false,
      message: 'Insufficient data. At least 30 days of usage data required.',
    });
  }
  return NextResponse.json({ available: true, advice });
}

// POST /api/savings-advisor — Force regeneration
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const customVcpu = (body as Record<string, unknown>).committedVcpu as number | undefined;

  const advice = await generateSavingsAdvice();
  if (!advice) {
    return NextResponse.json({
      available: false,
      message: 'Insufficient data.',
    }, { status: 400 });
  }
  return NextResponse.json({ available: true, advice });
}
```

### 3.5 Dashboard UI

No dashboard changes. Advice accessible via API and included in cost reports.

### 3.6 Environment Variables

No new environment variables needed. The advisor is enabled by default since it has no side effects (pure analysis).

Optional override if desired:

| Variable | Default | Description |
|----------|---------|-------------|
| `SAVINGS_ADVISOR_MIN_DAYS` | `30` | Minimum days of data for valid advice |

---

## 4. Implementation Guide

### File Changes

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `src/types/savings-advisor.ts` | CREATE | Type definitions (~100 lines) |
| 2 | `src/lib/savings-advisor.ts` | CREATE | Core module (~250 lines) |
| 3 | `src/lib/cost-optimizer.ts` | MODIFY | Include advice in report (+10 lines) |
| 4 | `src/types/redis.ts` | MODIFY | IStateStore extension (+2 lines) |
| 5 | `src/lib/state-store.ts` | MODIFY | InMemoryStateStore (+8 lines) |
| 6 | `src/lib/redis-state-store.ts` | MODIFY | RedisStateStore (+12 lines) |
| 7 | `src/app/api/savings-advisor/route.ts` | CREATE | API endpoint (~30 lines) |
| 8 | `src/lib/__tests__/savings-advisor.test.ts` | CREATE | Tests (~220 lines) |
| 9 | `CLAUDE.md` | MODIFY | Add API route (+1 line) |

### Reusable Functions

```typescript
// From usage-tracker.ts
import { getUsageData, getUsageSummary, analyzePatterns } from '@/lib/usage-tracker';
// getUsageData(days: number): Promise<UsageDataPoint[]>
// getUsageSummary(days: number = 7): Promise<{ avgVcpu, peakVcpu, avgUtilization, dataPointCount, oldestDataAge }>
// analyzePatterns(days: number = 7): Promise<UsagePattern[]>

// From cost-optimizer.ts
import { calculateMonthlyCost, getBaselineMonthlyCost } from '@/lib/cost-optimizer';
// calculateMonthlyCost(avgVcpu: number): number
// getBaselineMonthlyCost(): number

// From redis-store.ts
import { getStore } from '@/lib/redis-store';
```

### IStateStore Extension

Add to `src/types/redis.ts`:
```typescript
// Savings Plans Advisor
getSavingsAdvice(): Promise<SavingsAdvice | null>;
setSavingsAdvice(advice: SavingsAdvice): Promise<void>;
```

InMemoryStateStore:
```typescript
private savingsAdvice: SavingsAdvice | null = null;

async getSavingsAdvice(): Promise<SavingsAdvice | null> {
  return this.savingsAdvice;
}
async setSavingsAdvice(advice: SavingsAdvice): Promise<void> {
  this.savingsAdvice = advice;
}
```

RedisStateStore:
```typescript
async getSavingsAdvice(): Promise<SavingsAdvice | null> {
  const data = await this.client.get('sentinai:savings-advice');
  return data ? JSON.parse(data) : null;
}
async setSavingsAdvice(advice: SavingsAdvice): Promise<void> {
  // Expire after 8 days (refresh weekly)
  await this.client.set('sentinai:savings-advice', JSON.stringify(advice), 'EX', 8 * 24 * 3600);
}
```

### CostReport Type Extension

Add to `src/types/cost.ts`:
```typescript
import type { SavingsAdvice } from './savings-advisor';

// Extend CostReport interface:
export interface CostReport {
  // ... existing fields ...
  savingsAdvice?: SavingsAdvice | null;
}
```

### Implementation Order

1. Types → 2. IStateStore → 3. Store implementations → 4. Core module → 5. Cost optimizer integration → 6. API → 7. Tests → 8. Config

---

## 5. Test Specification

**File: `src/lib/__tests__/savings-advisor.test.ts`** (NEW)

### Mock Strategy

```typescript
vi.mock('@/lib/usage-tracker', () => ({
  getUsageData: vi.fn(),
  getUsageSummary: vi.fn(),
  analyzePatterns: vi.fn(),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getSavingsAdvice: vi.fn().mockResolvedValue(null),
    setSavingsAdvice: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### Test Data Factory

```typescript
function generateUsageData(days: number, pattern: 'stable' | 'variable' | 'peak'): UsageDataPoint[] {
  const data: UsageDataPoint[] = [];
  const pointsPerDay = 2880; // 30s intervals
  for (let i = 0; i < days * pointsPerDay; i++) {
    const hour = Math.floor((i % pointsPerDay) / 120);
    let vcpu: number;
    switch (pattern) {
      case 'stable': vcpu = 2; break;
      case 'variable': vcpu = hour >= 8 && hour <= 20 ? 2 : 1; break;
      case 'peak': vcpu = hour >= 12 && hour <= 14 ? 4 : 1; break;
    }
    data.push({
      timestamp: Date.now() - (days * pointsPerDay - i) * 30000,
      vcpu,
      cpuUtilization: vcpu * 25,
    });
  }
  return data;
}
```

### Test Cases

```
describe('savings-advisor')
  describe('calculateUsagePercentiles')
    it('should calculate correct percentiles for stable usage')
    it('should calculate correct percentiles for variable usage')
    it('should handle single data point')
    it('should handle empty data array')

  describe('simulateCommitment')
    it('should calculate savings for exact match (commitment = avg usage)')
    it('should show zero waste for under-commitment (commitment < min usage)')
    it('should calculate waste for over-commitment (commitment > max usage)')
    it('should calculate correct overCommitmentPct')
    it('should calculate correct underCommitmentPct')
    it('should calculate effective monthly total correctly')
    it('should handle memory cost in calculations')

  describe('generateSavingsAdvice')
    it('should return null when insufficient data (< 30 days)')
    it('should generate 3 options: conservative, recommended, aggressive')
    it('should sort options by savings percentage')
    it('should set conservative option at p10 level')
    it('should cap recommended option at p75 level')
    it('should include purchase URL')
    it('should include caveats')
    it('should cache result in store')

  describe('getSavingsAdvice')
    it('should return cached advice if fresh (< 7 days)')
    it('should regenerate if stale (> 7 days)')
    it('should return null if no data available')

  describe('cost-optimizer integration')
    it('should include savingsAdvice in CostReport when available')
    it('should set savingsAdvice to null when insufficient data')
```

### Minimum Coverage Target

- Statement coverage: ≥ 90%
- Branch coverage: ≥ 85%

---

## 6. Verification

### Step 1: Build

```bash
npm run build
```

### Step 2: Unit Tests

```bash
npx vitest run src/lib/__tests__/savings-advisor.test.ts
```

### Step 3: Integration Test

```bash
npm run dev

# Check advice (should show insufficient data with fresh install)
curl http://localhost:3002/api/savings-advisor | jq .
# Expected: { "available": false, "message": "Insufficient data..." }

# Check cost report includes savingsAdvice field
curl http://localhost:3002/api/cost-report | jq '.savingsAdvice'

# After 30+ days of operation:
curl http://localhost:3002/api/savings-advisor | jq '.advice.options'
# Expected: Array of 3 CommitmentOption objects with savings calculations
```

### Step 4: Full Test Suite

```bash
npm run test:run
```

### Step 5: Validate Calculations

Manually verify with known data:
- 30 days stable at 2 vCPU:
  - On-demand monthly: `2 * (0.04656 + 2 * 0.00511) * 730 = $82.85`
  - With SP (commit 2 vCPU, 50% off): `2 * 0.02328 * 730 + 2 * 2 * 0.00511 * 730 = $41.43`
  - Savings: $41.43/month, 50%
