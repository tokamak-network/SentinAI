# SentinAI 구현 로드맵 (2026-02-09)

## 📌 개요

E2E 테스트(Playwright)와 Redis 캐싱 전략을 구현하기 위한 상세 로드맵입니다.
- **전체 기간**: 7.5 근무일 (순차) 또는 5 근무일 (병렬)
- **시작일**: 2026-02-10
- **완료 예상**: 2026-02-20

---

## 🎯 Task 1: E2E Testing with Playwright (5 days)

### 목표
- UI 렌더링 검증: 0% → 75-80%
- Anomaly 배너, 피드, 히트맵 자동 테스트
- CI/CD 통합으로 회귀 테스트 자동화

### 단계별 계획

#### Phase 1: Setup & Configuration (1일)
**Task #1**
- [ ] Playwright 설치: `npm install -D @playwright/test@1.48.0`
- [ ] 브라우저 설치: `npx playwright install chromium firefox webkit`
- [ ] `playwright.config.ts` 작성:
  - 브라우저: Chromium, Firefox, Webkit
  - Reporters: HTML, JSON, List
  - WebServer: `npm run dev` 자동 시작
  - Timeout, Retries 설정
- [ ] 디렉토리 구조:
  ```
  tests/
  ├── e2e/
  │   ├── anomaly-detection.spec.ts
  │   ├── cost-heatmap.spec.ts
  │   ├── daily-report.spec.ts
  │   └── helpers/
  │       ├── seed-data.ts
  │       └── wait-utils.ts
  └── fixtures/
      └── test-data.json
  ```

**Verification:**
```bash
npx playwright --version
npx playwright test --help
```

#### Phase 2: Add Test IDs (0.5일)
**Task #2**
- [ ] `src/app/page.tsx`에 data-testid 추가:
  - Anomaly Banner (3개): `anomaly-banner`, `anomaly-banner-title`, `anomaly-banner-message`
  - Anomaly Feed (5개/항목): `anomaly-feed-item-{i}`, `anomaly-severity-{i}`, `anomaly-message-{i}`
  - Usage Heatmap (2개/셀): `heatmap-cell-{day}-{hour}`, `heatmap-tooltip-{day}-{hour}`
- [ ] 총 ~200개 Test ID 추가
- [ ] 로직 변경 없음 (최소 침습)

**Naming Convention:** `{feature}-{element}[-{index}]`

#### Phase 3: Core Test Scenarios (2일)
**Task #3**

**3.1 Anomaly Detection** (`anomaly-detection.spec.ts`)
```typescript
test('should detect spike anomaly and show alert banner')
test('should show different colors per severity')
test('should clear banner when anomaly resolves')
```

**3.2 Cost Heatmap** (`cost-heatmap.spec.ts`)
```typescript
test('should render 7x24 grid')
test('should apply correct color gradients')
test('should show tooltip on hover')
test('should update on new cost data')
```

**3.3 Daily Report** (`daily-report.spec.ts`)
```typescript
test('should generate report and show success message')
test('should include all required sections in report')
```

**Helper Utilities:**
- `seedMetrics(page, scenario)` - POST /api/metrics/seed
- `seedStableData(page, days)` - 7일 데이터 수집
- `waitForMetricsUpdate(page, timeout)` - 폴링 응답 대기
- `waitForCostReport(page, timeout)` - Cost report API 대기

#### Phase 4: CI/CD Integration (0.5일)
**Task #4**

**npm Scripts** (package.json):
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

**GitHub Actions** (`.github/workflows/e2e.yml`):
- Trigger: push to main, pull_request
- Install: Node, dependencies, Playwright browsers
- Run: `npm run test:e2e` with environment variables
- Artifacts: playwright-report/, screenshots, videos
- Environment:
  - `SCALING_SIMULATION_MODE=true` (avoid real K8s changes)
  - `L2_RPC_URL` (from secrets)
  - `ANTHROPIC_API_KEY` (from secrets)

#### Phase 5: Verification & Documentation (1일)
**Task #5**

**Success Criteria:**
- [ ] 9개 테스트 모두 통과 (chromium)
- [ ] 실행 시간 < 5분
- [ ] CI/CD 파이프라인 통과
- [ ] Screenshot/video artifacts 업로드
- [ ] Coverage: Critical UI Flows 100%, Data Visualization 90%

**Local Testing:**
```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Run tests
npm run test:e2e
npm run test:e2e:ui  # Interactive debugging
```

**Documentation:**
- Create `docs/verification/e2e-playwright-verification.md`
- Summary of test results
- Known limitations and future improvements

---

## 🎯 Task 2: Redis Caching Strategy (2.5 days)

### 목표
- 서버 재시작 후 데이터 손실 방지 (100% 해결)
- Alert 중복 발송 차단
- 비용 최적화 데이터 7일 유지

### 현재 상태: 40% 완료
- ✅ metrics-store: Redis 통합됨
- ✅ k8s-scaler: Redis 통합됨
- ❌ anomaly-event-store: 필요 (High priority)
- ❌ usage-tracker: 필요 (High priority)
- ❌ daily-accumulator: 권장 (Medium priority)
- ❌ alert-dispatcher: 권장 (Medium priority)
- ❌ prediction-tracker: 선택 (Low priority)

### 단계별 계획

#### Phase 1-2: Interface & InMemory (2.5시간)
**Task #6**

**1. IStateStore 확장** (`src/types/redis.ts`):
```typescript
export interface IStateStore {
  // === P1: Anomaly Event Store ===
  getAnomalyEvents(limit?, offset?): Promise<{events, total, activeCount}>;
  createAnomalyEvent(event): Promise<void>;
  updateAnomalyEvent(eventId, updates): Promise<void>;
  getActiveAnomalyEventId(): Promise<string | null>;
  setActiveAnomalyEventId(eventId): Promise<void>;
  cleanupStaleAnomalyEvents(): Promise<void>;

  // === P1: Usage Tracker ===
  pushUsageData(point): Promise<void>;
  getUsageData(days): Promise<UsageDataPoint[]>;
  getUsageDataCount(): Promise<number>;
  clearUsageData(): Promise<void>;

  // === P2/P3: Daily Accumulator, Alert Dispatcher, Prediction Tracker ===
  // (see detailed plan document)
}
```

**2. InMemoryStateStore 구현** (`src/lib/redis-store.ts`):
```typescript
export class InMemoryStateStore implements IStateStore {
  private anomalyEvents: AnomalyEvent[] = [];
  private activeAnomalyEventId: string | null = null;
  private usageData: UsageDataPoint[] = [];
  // ... P2/P3 fields

  async pushUsageData(point): Promise<void> {
    this.usageData.push(point);
    if (this.usageData.length > 10080) {
      this.usageData = this.usageData.slice(-10080);
    }
  }
  // ... all other methods
}
```

#### Phase 3-4: Redis P1 & Module Migration (5시간)
**Task #7-8**

**3. RedisStateStore P1 구현**:
```
sentinai:anomaly:
├── events           List[100]  (7 days TTL)
└── active           String

sentinai:usage:
└── data             List[10080] (7 days TTL)
```

**4. 모듈 마이그레이션**:
- `src/lib/anomaly-event-store.ts`: 동기 → async 변환
- `src/lib/usage-tracker.ts`: 동기 → async 변환
- Import `getStore()` 사용

**Before:**
```typescript
let events: AnomalyEvent[] = [];
export function createOrUpdateEvent(...): AnomalyEvent { }
```

**After:**
```typescript
import { getStore } from '@/lib/redis-store';
export async function createOrUpdateEvent(...): Promise<AnomalyEvent> {
  const store = getStore();
  await store.createAnomalyEvent(newEvent);
}
```

#### Phase 5-8: Redis P2/P3 & Module Migration (5시간)
**Task #9**

**P2 Stores:**
- `daily-accumulator.ts`: Hash 저장 (48h TTL)
- `alert-dispatcher.ts`: Alert history + cooldown (10min TTL)

**P3 Store:**
- `prediction-tracker.ts`: Records List

See detailed plan document for full Redis key structure.

#### Phase 9: API Route Updates (1.5시간)
**Task #10**

Update all API endpoints to use async/await:
- `src/app/api/metrics/route.ts`
- `src/app/api/anomalies/route.ts`
- `src/app/api/anomalies/config/route.ts`
- `src/app/api/reports/daily/route.ts`
- `src/app/api/cost-report/route.ts`

**Before:**
```typescript
recordUsage(currentVcpu, effectiveCpu);
```

**After:**
```typescript
await recordUsage(currentVcpu, effectiveCpu);
```

#### Phase 10-11: Testing & Documentation (4시간)
**Task #11**

**Comprehensive Testing:**
```bash
# Start Redis
docker run -d --name sentinai-redis -p 6379:6379 redis:7-alpine

# Set environment
export REDIS_URL=redis://localhost:6379

# Start dev server
npm run dev

# Test scenarios:
# 1. Create anomaly data
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"

# 2. Restart server
docker restart sentinai

# 3. Verify data persistence
curl "http://localhost:3002/api/anomalies" | jq '.events | length'
# Expected: Same number of events (Redis) vs 0 (InMemory)
```

**Documentation:**
- Update `CLAUDE.md` with Redis key structure
- Update `ENV_GUIDE.md` with REDIS_URL config
- Create implementation summary

---

## 📊 Timeline

### 순차 진행 (Sequential)
```
Week 1:
  Mon (2/10): Task #1 (Playwright Setup)
  Tue (2/11): Task #2 (Test IDs)
  Wed (2/12): Task #3 (Test Scenarios)
  Thu (2/13): Task #4 (CI/CD)
  Fri (2/14): Task #5 (Verification)

Week 2:
  Mon (2/17): Task #6 (Redis Setup)
  Tue (2/18): Task #7-8 (Redis P1)
  Wed (2/19): Task #9 (Redis P2/P3)
  Thu (2/20): Task #10-11 (API Routes + Testing)
```

### 병렬 진행 (Parallel - 2명)
```
Developer A (E2E Testing):       Developer B (Redis Caching):
  Mon-Fri: Task #1-5              Mon-Fri: Task #6-11
  Complete by: Friday 2/14        Complete by: Friday 2/20

Cross-review & Integration: Week 3
```

---

## 🔧 Prerequisites

**Required:**
- Node.js 20+
- npm 10+
- Git configured
- `L2_RPC_URL` environment variable set
- AI API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)

**For Redis Testing (Optional):**
- Docker or Redis installed
- `REDIS_URL=redis://localhost:6379`

---

## ✅ Success Criteria

### Task 1 (E2E Testing)
- [ ] 9 tests passing
- [ ] Execution time < 5 minutes
- [ ] CI/CD pipeline green
- [ ] Artifacts uploaded (screenshots, videos)
- [ ] Coverage > 75% for critical UI flows

### Task 2 (Redis Caching)
- [ ] Data persists after server restart
- [ ] Fallback to InMemory works (REDIS_URL unset)
- [ ] Alert cooldown maintained (no duplicates)
- [ ] Usage data survives 7 days
- [ ] API response time < 20ms overhead

---

## 📝 Key Resources

- **Plan Document**: `/Users/theo/.claude/plans/zazzy-singing-engelbart.md`
- **Test Plan**: See Task 1, Phase 3
- **Redis Architecture**: See Task 2 sections above
- **Critical Files**: Listed in each task description

---

## 🚀 Quick Start Tomorrow

**Morning Checklist:**

```bash
# 1. Verify environment
node --version      # 20+
npm --version       # 10+
git status         # Check clean working tree

# 2. Start Task #1
npm install -D @playwright/test@1.48.0

# 3. Create directory structure
mkdir -p tests/e2e/helpers tests/fixtures

# 4. Begin with playwright.config.ts
# (See Task #1 Phase 1 description above)
```

---

**Generated:** 2026-02-09
**Status:** Ready for implementation
**Owner:** (Assign as needed)
