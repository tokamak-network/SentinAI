# TODO: SentinAI Implementation (2026-02-10)

## 🎯 Current Tasks

### **TASK 1: E2E Testing with Playwright** ⏳ PENDING

#### [ ] #1: Playwright Setup & Configuration (1 day)
- [ ] `npm install -D @playwright/test@1.48.0`
- [ ] `npx playwright install chromium firefox webkit`
- [ ] Create `playwright.config.ts`
  - [ ] Configure Chromium, Firefox, Webkit
  - [ ] Setup reporters (HTML, JSON, List)
  - [ ] Add WebServer to auto-start `npm run dev`
  - [ ] Set retries, timeout, traces
- [ ] Create directory structure:
  - [ ] `tests/e2e/`
  - [ ] `tests/e2e/helpers/`
  - [ ] `tests/fixtures/`

**Verification:**
```bash
npx playwright --version
npx playwright test --help
```

---

#### [ ] #2: Add Test IDs to page.tsx (0.5 day)
**File:** `src/app/page.tsx`

- [ ] Anomaly Banner (3 IDs):
  - [ ] `data-testid="anomaly-banner"`
  - [ ] `data-testid="anomaly-banner-title"`
  - [ ] `data-testid="anomaly-banner-message"`

- [ ] Anomaly Feed (~10 IDs per item):
  - [ ] `data-testid="anomaly-feed-item-{index}"`
  - [ ] `data-testid="anomaly-severity-{index}"` (spike→red, drop→yellow, plateau→orange)
  - [ ] `data-testid="anomaly-message-{index}"`

- [ ] Usage Heatmap (~170 IDs):
  - [ ] `data-testid="usage-heatmap"`
  - [ ] `data-testid="heatmap-day-{day}"` (0-6)
  - [ ] `data-testid="heatmap-cell-{day}-{hour}"` (7×24 grid)
  - [ ] `data-testid="heatmap-tooltip-{day}-{hour}"`

- [ ] Key Metrics:
  - [ ] `data-testid="current-vcpu"`
  - [ ] `data-testid="monthly-cost"`
  - [ ] `data-testid="l2-block-number"`

**Naming Convention:** `{feature}-{element}[-{index}]`

---

#### [ ] #3: Core E2E Test Scenarios (2 days)

**[ ] 3.1: Anomaly Detection** (`tests/e2e/anomaly-detection.spec.ts`)
```typescript
import { test, expect } from '@playwright/test';
import { seedMetrics, waitForMetricsUpdate } from './helpers/seed-data';

test.describe('Anomaly Detection Pipeline', () => {
  test('should detect spike anomaly and show alert banner', async ({ page }) => {
    // 1. Navigate to dashboard
    // 2. Seed spike data
    // 3. Wait for metrics update
    // 4. Verify banner visibility and style
  });

  test('should show different colors per severity', async ({ page }) => {
    // Test severity-based colors: spike→red, drop→yellow, plateau→orange
  });

  test('should clear banner when anomaly resolves', async ({ page }) => {
    // Test banner disappears when anomaly resolves
  });
});
```

**[ ] 3.2: Cost Heatmap Visualization** (`tests/e2e/cost-heatmap.spec.ts`)
```typescript
test.describe('Usage Heatmap', () => {
  test('should render 7x24 grid');
  test('should apply correct color gradients');
  test('should show tooltip on hover');
  test('should update when new cost data arrives');
});
```

Color gradient validation:
- 0% → `bg-gray-800`
- 1-19% → `bg-green-900/60`
- 20-39% → `bg-green-700/60`
- 40-59% → `bg-yellow-700/60`
- 60-79% → `bg-orange-700/60`
- 80-100% → `bg-red-700/60`

**[ ] 3.3: Daily Report Generation** (`tests/e2e/daily-report.spec.ts`)
```typescript
test.describe('Daily Report', () => {
  test('should generate report and show success message');
  test('should include all required sections in report');
  test('should list reports in UI');
});
```

**[ ] Helper Utilities** (`tests/e2e/helpers/seed-data.ts`)
- [ ] `seedMetrics(page, scenario)` - POST /api/metrics/seed
- [ ] `seedStableData(page, days)` - Create multi-day data
- [ ] `waitForMetricsUpdate(page, timeout)` - Poll for response
- [ ] `waitForCostReport(page, timeout)` - Wait for cost API

---

#### [ ] #4: CI/CD Integration (0.5 day)

**[ ] npm Scripts** (`package.json`)
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:chromium": "playwright test --project=chromium"
  }
}
```

**[ ] GitHub Actions** (`.github/workflows/e2e.yml`)
- [ ] Create workflow file
- [ ] Triggers: `push` to main, `pull_request`
- [ ] Install Node, npm dependencies
- [ ] Install Playwright browsers
- [ ] Run: `npm run test:e2e`
- [ ] Set environment variables:
  - [ ] `SCALING_SIMULATION_MODE=true`
  - [ ] `L2_RPC_URL` (from secrets)
  - [ ] `ANTHROPIC_API_KEY` (from secrets)
- [ ] Upload artifacts:
  - [ ] `playwright-report/`
  - [ ] Screenshots on failure
  - [ ] Videos on failure

---

#### [ ] #5: Verification & Documentation (1 day)

**[ ] Local Testing:**
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run test:e2e
npm run test:e2e:ui  # Interactive mode
```

**[ ] Success Criteria:**
- [ ] 9 tests passing (anomaly 3 + heatmap 4 + report 2)
- [ ] Execution time < 5 minutes
- [ ] CI pipeline passing
- [ ] Screenshots/videos uploaded
- [ ] Coverage: Critical UI 100%, Data Viz 90%

**[ ] Documentation:**
- [ ] Create `docs/verification/e2e-playwright-verification.md`
- [ ] Document test results
- [ ] List any flaky tests
- [ ] Note limitations

---

### **TASK 2: Redis Caching Strategy** ⏳ PENDING

#### [ ] #6: Interface Extension & InMemory Implementation (2.5 hours)

**[ ] Extend IStateStore** (`src/types/redis.ts`)
- [ ] P1 Anomaly Store methods:
  - [ ] `getAnomalyEvents(limit?, offset?)`
  - [ ] `createAnomalyEvent(event)`
  - [ ] `updateAnomalyEvent(eventId, updates)`
  - [ ] `getActiveAnomalyEventId()`
  - [ ] `setActiveAnomalyEventId(eventId)`
  - [ ] `cleanupStaleAnomalyEvents()`

- [ ] P1 Usage Tracker methods:
  - [ ] `pushUsageData(point)`
  - [ ] `getUsageData(days)`
  - [ ] `getUsageDataCount()`
  - [ ] `clearUsageData()`

- [ ] P2/P3 methods (see detailed plan)

**[ ] Implement InMemoryStateStore** (`src/lib/redis-store.ts`)
- [ ] Add private fields for all 5 stores
- [ ] Implement all interface methods
- [ ] Maintain current in-memory logic

**Verification:**
```bash
npm run lint
npx tsc --noEmit
```

---

#### [ ] #7: Redis P1 Implementation (3 hours)

**[ ] RedisStateStore P1 Methods** (`src/lib/redis-store.ts`)

**Anomaly Event Store:**
```
sentinai:anomaly:events         List[100] (7 days TTL)
sentinai:anomaly:active         String
```

- [ ] `createAnomalyEvent()` - LPUSH + LTRIM
- [ ] `updateAnomalyEvent()` - LRANGE + modify + re-save
- [ ] `getAnomalyEvents()` - LRANGE with pagination
- [ ] `getActiveAnomalyEventId()` - GET
- [ ] `setActiveAnomalyEventId()` - SET/DEL
- [ ] `cleanupStaleAnomalyEvents()` - Auto-resolve logic

**Usage Tracker:**
```
sentinai:usage:data             List[10080] (7 days TTL)
```

- [ ] `pushUsageData()` - RPUSH + LTRIM
- [ ] `getUsageData(days)` - LRANGE + filter by timestamp
- [ ] `getUsageDataCount()` - LLEN
- [ ] `clearUsageData()` - DEL

**[ ] Unit Tests** (`src/lib/__tests__/redis-store-redis-p1.test.ts`)
- [ ] Test with local Redis (Docker)
- [ ] Verify data persistence
- [ ] Test TTL expiration

---

#### [ ] #8: Module Migration P1 (2 hours)

**[ ] Migrate anomaly-event-store.ts** (`src/lib/anomaly-event-store.ts`)
- [ ] Import `getStore()` from redis-store
- [ ] Convert all functions to `async`
- [ ] Replace `let events = []` with `getStore()` calls
- [ ] Replace `activeEventId` with store methods
- [ ] Remove in-memory variable declarations
- [ ] Update all function signatures to return Promise

Before:
```typescript
let events: AnomalyEvent[] = [];
export function createOrUpdateEvent(...): AnomalyEvent { }
```

After:
```typescript
import { getStore } from '@/lib/redis-store';
export async function createOrUpdateEvent(...): Promise<AnomalyEvent> {
  const store = getStore();
  // ... use await
}
```

**[ ] Migrate usage-tracker.ts** (`src/lib/usage-tracker.ts`)
- [ ] Same pattern: getStore(), async/await
- [ ] Replace `let usageData = []` with store methods
- [ ] Update all callers to use `await`

---

#### [ ] #9: Redis P2/P3 Implementation & Migration (5 hours)

**[ ] Daily Accumulator:**
- [ ] Keys: `sentinai:daily:state:{date}` (Hash, 48h TTL)
- [ ] Methods: getDailyAccumulatorState, saveDailyAccumulatorState
- [ ] Migrate: `src/lib/daily-accumulator.ts`

**[ ] Alert Dispatcher:**
- [ ] Keys: `sentinai:alert:history` (List, 24h TTL)
- [ ] Keys: `sentinai:alert:cooldown:{type}` (String, 10min TTL)
- [ ] Keys: `sentinai:alert:config` (Hash)
- [ ] Methods: getAlertHistory, pushAlertRecord, getLastAlertTime, setLastAlertTime, getAlertConfig, updateAlertConfig
- [ ] Migrate: `src/lib/alert-dispatcher.ts`

**[ ] Prediction Tracker:**
- [ ] Keys: `sentinai:prediction:records` (List, 7d TTL)
- [ ] Methods: getPredictionRecords, pushPredictionRecord, updatePredictionRecord
- [ ] Migrate: `src/lib/prediction-tracker.ts`

**[ ] Unit Tests:**
- [ ] `redis-store-redis-p2.test.ts`
- [ ] `redis-store-redis-p3.test.ts`

---

#### [ ] #10: API Route Updates & Integration Testing (4.5 hours)

**[ ] Update API Routes** - Add `await` to all store calls:
- [ ] `src/app/api/metrics/route.ts`
- [ ] `src/app/api/anomalies/route.ts`
- [ ] `src/app/api/anomalies/config/route.ts`
- [ ] `src/app/api/reports/daily/route.ts`
- [ ] `src/app/api/cost-report/route.ts`

**[ ] Integration Testing:**
```bash
# Setup
docker run -d --name sentinai-redis -p 6379:6379 redis:7-alpine
export REDIS_URL=redis://localhost:6379
npm run dev

# Test 1: Data Persistence
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"
docker restart sentinai
curl "http://localhost:3002/api/anomalies" | jq '.events | length'
# Expected: Same number (Redis) vs 0 (InMemory)

# Test 2: Fallback Mode
unset REDIS_URL
docker restart sentinai
npm run dev
# Expected: InMemory mode, all features work

# Test 3: Alert Cooldown
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"
# Alert should be sent
docker restart sentinai
# Alert should NOT be sent again (cooldown maintained)
```

---

#### [ ] #11: Documentation & Finalization (1 hour)

**[ ] Update CLAUDE.md:**
- [ ] Add Redis key structure documentation
- [ ] Document state management changes
- [ ] Clarify REDIS_URL configuration

**[ ] Update ENV_GUIDE.md:**
- [ ] Document REDIS_URL environment variable
- [ ] Explain fallback behavior
- [ ] Provide setup instructions

**[ ] Create Implementation Summary:**
- [ ] List all Redis keys
- [ ] Document fallback strategy
- [ ] Note performance considerations

**[ ] Final Verification:**
- [ ] `npm run lint` passes
- [ ] `npm run test:run` passes
- [ ] Build succeeds
- [ ] No TypeScript errors

---

## 📊 Progress Tracking

### Task 1: E2E Testing (5 days)
- [ ] Phase 1: Setup - 1 day
- [ ] Phase 2: Test IDs - 0.5 day
- [ ] Phase 3: Scenarios - 2 days
- [ ] Phase 4: CI/CD - 0.5 day
- [ ] Phase 5: Verification - 1 day

**Status:** ⏳ Not Started

### Task 2: Redis Caching (2.5 days)
- [ ] Phase 1-2: Setup - 2.5 hours
- [ ] Phase 3-4: Redis P1 - 5 hours
- [ ] Phase 5-8: Redis P2/P3 - 5 hours
- [ ] Phase 9: API Routes - 1.5 hours
- [ ] Phase 10-11: Testing & Docs - 4 hours

**Status:** ⏳ Not Started

---

## 🚀 Quick Start Command

```bash
# Tomorrow morning:
npm install -D @playwright/test@1.48.0
npx playwright install chromium firefox webkit
mkdir -p tests/e2e/helpers tests/fixtures

# Then start with Task #1, Phase 1:
# Create playwright.config.ts
```

---

**Generated:** 2026-02-09
**Ready:** 2026-02-10
**Estimated Completion:** 2026-02-20
