# Proposal 16: L1 RPC Call Budget Manager

## 1. Overview

### Problem Statement

L2 network components (op-node, op-batcher, op-proposer) access L1 via Proxyd, which distributes requests across multiple backends (e.g., `infura_theo1`, `infura_theo2`, `infura_theo3`). Each backend has a quota:

| Provider | Free Tier Limit | Overage Cost |
|----------|----------------|--------------|
| Infura | 100K req/day | $50/mo (Growth Plan) |
| Alchemy | 300M CU/month | $49/mo (Growth Plan) |

Currently, SentinAI only reacts **after** 429 errors occur (Proposal: Proxyd Backend 429 Auto-Replacement, implemented in `l1-rpc-failover.ts`). There is no **proactive** quota tracking, so backends hit their limits unexpectedly, causing:

- Temporary L1 connectivity loss until failover completes
- Wasted spare URLs on preventable quota exhaustion
- No visibility into per-backend usage rates

### Solution Summary

Implement an **L1 RPC Budget Manager** that:
1. Tracks per-backend call volume by counting probes and estimating actual usage
2. Sets daily/monthly budgets per backend with configurable limits
3. Proactively removes backends from the Proxyd `backend_groups` at 90% quota usage
4. Automatically restores backends when quotas reset (monthly/daily)
5. Sends alerts at 80% usage threshold

### Goals

- Prevent quota overage charges (~$50-99/month savings)
- Eliminate unnecessary 429→spare URL consumption cycles
- Provide visibility into per-backend RPC usage rates
- Zero-touch operation after initial budget configuration

### Non-Goals

- Exact per-request tracking (estimation via probe rate is sufficient)
- Modifying Proxyd's internal routing logic
- Supporting non-Infura/Alchemy providers (generic budget model)

### Monthly Savings Estimate

| Item | Cost |
|------|------|
| Infura overage prevention (Growth Plan) | **$50/mo** |
| Alchemy overage prevention (Growth Plan) | **$49/mo** |
| Reduced spare URL consumption | Operational stability |

---

## 2. Architecture

### Data Flow

```
┌─ Agent Loop (30s cycle, existing) ───────────────────────┐
│                                                           │
│  Phase 1.5: checkProxydBackends() (existing)              │
│       └─> probeBackend(url) — counts 429s                 │
│                                                           │
│  Phase 1.6: checkRpcBudgets() (NEW)                       │
│       ├─> estimateBackendUsage(probeResults)               │
│       ├─> [80% threshold] → sendBudgetAlert()              │
│       ├─> [90% threshold] → removeFromBackendGroup()       │
│       └─> [quota reset] → restoreToBackendGroup()          │
└───────────────────────────────────────────────────────────┘

Budget State (IStateStore):
┌──────────────────────────────────────────────────────────┐
│  infura_theo1: { daily: 85000/100000, monthly: 2.1M/3M } │
│  infura_theo2: { daily: 42000/100000, monthly: 1.0M/3M } │
│  infura_theo3: { daily: 98000/100000, monthly: 2.9M/3M } │ ← CRITICAL
│  alchemy:      { daily: 12000/∞,      monthly: 50M/300M } │
└──────────────────────────────────────────────────────────┘
```

### Integration Points

| Module | File | Usage |
|--------|------|-------|
| L1 RPC Failover | `src/lib/l1-rpc-failover.ts` | `checkProxydBackends()` probe data, `replaceBackendInToml()`, ConfigMap access |
| Agent Loop | `src/lib/agent-loop.ts` | Phase 1.6 integration (after existing Phase 1.5) |
| Alert Dispatcher | `src/lib/alert-dispatcher.ts` | Webhook alert pattern (reuse format) |
| State Store | `src/lib/redis-store.ts` | Budget counter persistence |
| Scheduler | `src/lib/scheduler.ts` | Monthly/daily reset cron |

### State Management

Extends `IStateStore`:
- `getRpcBudgetState(): Promise<RpcBudgetState | null>`
- `setRpcBudgetState(state: RpcBudgetState): Promise<void>`

---

## 3. Detailed Design

### 3.1 New Types

**File: `src/types/rpc-budget.ts`** (NEW)

```typescript
/**
 * L1 RPC Budget Manager Types
 * Per-backend quota tracking and proactive budget management.
 */

/** Budget configuration for a single backend */
export interface BackendBudget {
  name: string;                    // e.g., 'infura_theo1'
  dailyLimit: number;              // Max requests per day (0 = unlimited)
  monthlyLimit: number;            // Max requests per month (0 = unlimited)
  warningPct: number;              // Alert threshold (default: 80)
  criticalPct: number;             // Auto-remove threshold (default: 90)
}

/** Runtime usage counters for a single backend */
export interface BackendUsageCounter {
  name: string;
  dailyCount: number;              // Estimated requests today
  monthlyCount: number;            // Estimated requests this month
  lastResetDaily: string;          // ISO date (YYYY-MM-DD) of last daily reset
  lastResetMonthly: string;        // ISO date (YYYY-MM) of last monthly reset
  removedFromGroup: boolean;       // Whether this backend was removed from backend_groups
  removedAt?: string;              // ISO timestamp of removal
  estimatedDailyRate: number;      // Requests/hour estimated rate
}

/** Budget alert event */
export interface BudgetAlertEvent {
  timestamp: string;
  backendName: string;
  level: 'warning' | 'critical';
  usagePct: number;
  dailyCount: number;
  dailyLimit: number;
  monthlyCount: number;
  monthlyLimit: number;
  action: 'alert-only' | 'removed-from-group' | 'restored';
  message: string;
}

/** Overall budget state */
export interface RpcBudgetState {
  counters: BackendUsageCounter[];
  budgets: BackendBudget[];
  alerts: BudgetAlertEvent[];       // Recent alerts (ring buffer, max 50)
  lastCheckTime: number;            // Unix timestamp of last check
}

/** Budget check result */
export interface BudgetCheckResult {
  backendsChecked: number;
  alertsSent: number;
  backendsRemoved: string[];
  backendsRestored: string[];
}

/** Configuration via environment */
export interface RpcBudgetConfig {
  enabled: boolean;
  /** JSON config string, e.g.:
   *  [{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000},
   *   {"name":"infura_theo2","dailyLimit":100000,"monthlyLimit":3000000}]
   */
  budgets: BackendBudget[];
  /** Estimation multiplier: actual_requests ≈ probe_count × multiplier
   *  Since agent loop probes every 30s, and actual L2 components make many more calls,
   *  default multiplier = 100 (1 probe ≈ 100 actual requests)
   */
  estimationMultiplier: number;
}

export const DEFAULT_RPC_BUDGET_CONFIG: RpcBudgetConfig = {
  enabled: false,
  budgets: [],
  estimationMultiplier: 100,
};
```

### 3.2 Core Module

**File: `src/lib/rpc-budget-manager.ts`** (NEW, ~250 lines)

```typescript
/**
 * L1 RPC Budget Manager
 * Tracks per-backend call volume and proactively manages quota usage.
 *
 * Integration: Called from agent-loop.ts after checkProxydBackends().
 * Uses probe data from l1-rpc-failover.ts to estimate actual usage.
 */

import { getStore } from '@/lib/redis-store';
import { getL1FailoverState, replaceBackendInToml } from '@/lib/l1-rpc-failover';
import { runK8sCommand } from '@/lib/k8s-config';
import type {
  RpcBudgetState,
  BackendBudget,
  BackendUsageCounter,
  BudgetAlertEvent,
  BudgetCheckResult,
  RpcBudgetConfig,
} from '@/types/rpc-budget';

// ============================================================
// Constants
// ============================================================

const MAX_ALERT_EVENTS = 50;
const DEFAULT_WARNING_PCT = 80;
const DEFAULT_CRITICAL_PCT = 90;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between alerts per backend

// ============================================================
// Configuration
// ============================================================

/**
 * Parse budget configuration from environment.
 *
 * L1_RPC_BUDGET_ENABLED=true
 * L1_RPC_BUDGET_CONFIG=[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000}]
 * L1_RPC_BUDGET_MULTIPLIER=100
 */
export function parseBudgetConfig(): RpcBudgetConfig

// ============================================================
// Core Logic
// ============================================================

/**
 * Initialize or load budget state.
 */
export async function initBudgetState(config: RpcBudgetConfig): Promise<RpcBudgetState>

/**
 * Check and reset daily/monthly counters if date has changed.
 * Returns list of restored backend names.
 */
export async function checkAndResetCounters(state: RpcBudgetState): Promise<string[]>
```

**Logic for `checkAndResetCounters()`:**
1. Get current date `YYYY-MM-DD` and month `YYYY-MM`
2. For each counter:
   - If `lastResetDaily !== today` → reset `dailyCount = 0`, update `lastResetDaily`
   - If `lastResetMonthly !== thisMonth` → reset `monthlyCount = 0`, update `lastResetMonthly`
   - If counter was `removedFromGroup` and daily was reset → restore to group (only if monthly hasn't exceeded)
3. Return names of restored backends

```typescript
/**
 * Estimate backend usage from probe intervals.
 * Called each agent loop cycle (every 30s).
 *
 * Estimation: Each probe cycle accounts for `multiplier` actual requests.
 */
export function incrementUsage(
  state: RpcBudgetState,
  activeBackendNames: string[],
  multiplier: number
): void
```

**Logic for `incrementUsage()`:**
1. For each active backend name in the current group:
   - Find its counter
   - `counter.dailyCount += multiplier`
   - `counter.monthlyCount += multiplier`
   - `counter.estimatedDailyRate = counter.dailyCount / hoursSinceLastDailyReset`

```typescript
/**
 * Check budgets and take action (alert/remove/restore).
 * Main function called from agent loop.
 */
export async function checkRpcBudgets(): Promise<BudgetCheckResult | null>
```

**Logic for `checkRpcBudgets()`:**
1. Parse config → if not enabled, return null
2. Load state from store (or init)
3. Call `checkAndResetCounters()` → restore backends if quota reset
4. Call `incrementUsage()` with active backend names
5. For each backend with a budget:
   - Calculate `dailyPct = dailyCount / dailyLimit * 100`
   - Calculate `monthlyPct = monthlyCount / monthlyLimit * 100`
   - `usagePct = max(dailyPct, monthlyPct)`
   - If `usagePct >= criticalPct (90%)` AND not already removed:
     - Remove from `backend_groups` in ConfigMap TOML
     - `kubectl patch configmap` + restart Proxyd pod
     - Record alert event
   - Else if `usagePct >= warningPct (80%)`:
     - Send webhook alert (if cooldown expired)
     - Record alert event
6. Save state to store
7. Return `BudgetCheckResult`

```typescript
/**
 * Remove a backend from the Proxyd backend_groups (ConfigMap TOML).
 * Does NOT delete the [backends.NAME] section — only removes from groups list.
 */
async function removeFromBackendGroup(
  backendName: string,
  configMapName: string,
  dataKey: string,
  targetGroup: string
): Promise<boolean>
```

**Logic for `removeFromBackendGroup()`:**
1. Read ConfigMap TOML via kubectl
2. Parse TOML → find `backend_groups[targetGroup].backends`
3. Filter out `backendName` from the backends array
4. Stringify and patch ConfigMap
5. Restart Proxyd pod: `kubectl rollout restart deployment proxyd -n {namespace}`

```typescript
/**
 * Restore a backend to the Proxyd backend_groups.
 */
async function restoreToBackendGroup(
  backendName: string,
  configMapName: string,
  dataKey: string,
  targetGroup: string
): Promise<boolean>
```

**Logic for `restoreToBackendGroup()`:**
1. Read ConfigMap TOML
2. Parse → add `backendName` back to `backend_groups[targetGroup].backends`
3. Patch ConfigMap + restart Proxyd pod

```typescript
/**
 * Send budget alert via webhook (same format as alert-dispatcher.ts).
 */
async function sendBudgetAlert(event: BudgetAlertEvent): Promise<boolean>
```

**Logic for `sendBudgetAlert()`:**
1. Get `ALERT_WEBHOOK_URL` from env
2. Format Slack Block Kit message with budget details
3. POST to webhook URL
4. Return success/failure

```typescript
/**
 * Get current budget state for API/dashboard.
 */
export async function getBudgetState(): Promise<RpcBudgetState | null>
```

### 3.3 Agent Loop Integration

**File: `src/lib/agent-loop.ts`** (MODIFY)

Add after the existing Phase 1.5 (Proxyd backend health check):

```typescript
// === EXISTING IMPORT — add: ===
import { checkRpcBudgets } from '@/lib/rpc-budget-manager';

// === INSIDE runAgentCycle(), after Phase 1.5 Proxyd health check: ===

// Phase 1.6: RPC Budget check (non-blocking)
try {
  const budgetResult = await checkRpcBudgets();
  if (budgetResult && budgetResult.backendsRemoved.length > 0) {
    console.log(`[AgentLoop] RPC budget: removed backends: ${budgetResult.backendsRemoved.join(', ')}`);
  }
  if (budgetResult && budgetResult.backendsRestored.length > 0) {
    console.log(`[AgentLoop] RPC budget: restored backends: ${budgetResult.backendsRestored.join(', ')}`);
  }
} catch {
  // Non-blocking — continue cycle
}
```

### 3.4 API Endpoint

**File: `src/app/api/rpc-budget/route.ts`** (NEW)

```typescript
import { NextResponse } from 'next/server';
import { getBudgetState, parseBudgetConfig } from '@/lib/rpc-budget-manager';

// GET /api/rpc-budget — Get current budget state
export async function GET() {
  const config = parseBudgetConfig();
  if (!config.enabled) {
    return NextResponse.json({
      enabled: false,
      message: 'RPC budget manager is disabled. Set L1_RPC_BUDGET_ENABLED=true',
    });
  }
  const state = await getBudgetState();
  return NextResponse.json({ enabled: true, state });
}
```

### 3.5 Dashboard UI

No dashboard changes. Budget data available via `/api/rpc-budget`.

### 3.6 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `L1_RPC_BUDGET_ENABLED` | `false` | Enable per-backend RPC quota tracking |
| `L1_RPC_BUDGET_CONFIG` | `[]` | JSON array of `BackendBudget` objects |
| `L1_RPC_BUDGET_MULTIPLIER` | `100` | Estimation multiplier (probes → actual requests) |

Add to `.env.local.sample`:
```bash
# === L1 RPC Budget Manager (Optional) ===
# Track per-backend RPC quota usage and proactively manage limits.
# L1_RPC_BUDGET_ENABLED=true
# L1_RPC_BUDGET_CONFIG=[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000},{"name":"infura_theo2","dailyLimit":100000,"monthlyLimit":3000000}]
# L1_RPC_BUDGET_MULTIPLIER=100  # 1 probe ≈ 100 actual L2 component requests
```

---

## 4. Implementation Guide

### File Changes

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `src/types/rpc-budget.ts` | CREATE | Type definitions (~80 lines) |
| 2 | `src/lib/rpc-budget-manager.ts` | CREATE | Core module (~250 lines) |
| 3 | `src/lib/agent-loop.ts` | MODIFY | Phase 1.6 integration (+12 lines) |
| 4 | `src/types/redis.ts` | MODIFY | IStateStore extension (+2 lines) |
| 5 | `src/lib/state-store.ts` | MODIFY | InMemoryStateStore (+10 lines) |
| 6 | `src/lib/redis-state-store.ts` | MODIFY | RedisStateStore (+15 lines) |
| 7 | `src/app/api/rpc-budget/route.ts` | CREATE | API endpoint (~25 lines) |
| 8 | `src/lib/__tests__/rpc-budget-manager.test.ts` | CREATE | Tests (~200 lines) |
| 9 | `.env.local.sample` | MODIFY | Add env vars (+5 lines) |
| 10 | `CLAUDE.md` | MODIFY | Add env vars + API route (+4 lines) |

### Reusable Functions

```typescript
// From l1-rpc-failover.ts
import { getL1FailoverState, replaceBackendInToml } from '@/lib/l1-rpc-failover';
// getL1FailoverState() → L1FailoverState (includes proxydHealth[])
// replaceBackendInToml(toml, backendName, newUrl) → { updatedToml, previousUrl }

// From k8s-config.ts
import { runK8sCommand, getNamespace } from '@/lib/k8s-config';
// runK8sCommand(command, options?) → { stdout, stderr }

// From redis-store.ts
import { getStore } from '@/lib/redis-store';
```

### IStateStore Extension

Add to `src/types/redis.ts`:
```typescript
getRpcBudgetState(): Promise<RpcBudgetState | null>;
setRpcBudgetState(state: RpcBudgetState): Promise<void>;
```

### Implementation Order

1. Types → 2. IStateStore extension → 3. Store implementations → 4. Core module → 5. Agent loop → 6. API → 7. Tests → 8. Config

---

## 5. Test Specification

**File: `src/lib/__tests__/rpc-budget-manager.test.ts`** (NEW)

### Mock Strategy

```typescript
vi.mock('@/lib/l1-rpc-failover', () => ({
  getL1FailoverState: vi.fn().mockReturnValue({
    proxydHealth: [
      { name: 'infura_theo1', rpcUrl: 'https://mainnet.infura.io/v3/key1', consecutive429: 0, healthy: true, replaced: false },
      { name: 'infura_theo2', rpcUrl: 'https://mainnet.infura.io/v3/key2', consecutive429: 0, healthy: true, replaced: false },
    ],
    spareUrls: [],
  }),
  replaceBackendInToml: vi.fn(),
}));

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  getNamespace: vi.fn().mockReturnValue('default'),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getRpcBudgetState: vi.fn().mockResolvedValue(null),
    setRpcBudgetState: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### Test Cases

```
describe('rpc-budget-manager')
  describe('parseBudgetConfig')
    it('should return disabled config when env var not set')
    it('should parse valid JSON budget config')
    it('should handle malformed JSON gracefully')
    it('should apply default warning/critical thresholds')

  describe('checkAndResetCounters')
    it('should reset daily counter when date changes')
    it('should reset monthly counter when month changes')
    it('should restore removed backends on daily reset')
    it('should NOT restore if monthly limit still exceeded')

  describe('incrementUsage')
    it('should increment daily and monthly counters')
    it('should calculate estimated daily rate')
    it('should only increment active backends')

  describe('checkRpcBudgets')
    it('should return null when disabled')
    it('should send warning alert at 80% usage')
    it('should remove backend from group at 90% usage')
    it('should not re-remove already removed backend')
    it('should restore backend when quota resets')
    it('should respect alert cooldown (1 hour)')

  describe('removeFromBackendGroup')
    it('should update ConfigMap TOML correctly')
    it('should handle backend not in group gracefully')

  describe('restoreToBackendGroup')
    it('should re-add backend to group in TOML')
    it('should not duplicate if already in group')
```

### Minimum Coverage Target

- Statement coverage: ≥ 80%
- Branch coverage: ≥ 75%

---

## 6. Verification

### Step 1: Build

```bash
npm run build
```

### Step 2: Unit Tests

```bash
npx vitest run src/lib/__tests__/rpc-budget-manager.test.ts
```

### Step 3: Integration Test

```bash
# Set budget config and enable
export L1_RPC_BUDGET_ENABLED=true
export L1_RPC_BUDGET_CONFIG='[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000}]'
npm run dev

# Check budget state
curl http://localhost:3002/api/rpc-budget | jq .
```

### Step 4: Full Test Suite

```bash
npm run test:run
```
