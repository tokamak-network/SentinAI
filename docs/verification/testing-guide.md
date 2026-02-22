# SentinAI Test Guide

**Version:** 1.1
**Date:** 2026-02-22

---

## 1. Project overview

SentinAI is an AI-based monitoring and auto-scaling dashboard for Optimism L2 nodes.

### 1.1 Current implementation status

| Phase | Features | status | file location |
|-------|------|------|----------|
| P1 | Predictive Scaling | ✅ 완료 | `src/lib/predictive-scaler.ts` |
| P2 | Anomaly Detection | ✅ 완료 | `src/lib/anomaly-detector.ts` |
| P3 | RCA Engine | ✅ 완료 | `src/lib/rca-engine.ts` |
| P4 | Cost Optimizer | ✅ 완료 | `src/lib/cost-optimizer.ts` |
| P5 | NLOps | ✅ 완료 | `src/lib/nlops-engine.ts`, `src/app/api/nlops/route.ts` |
| P6 | Zero-Downtime | ✅ 완료 | `src/lib/zero-downtime-scaler.ts` |
| P7 | Return to the State ✅ completed | `src/lib/redis-store.ts` |
| P8 | Auto-Remediation | ✅ 완료 | `docs/done/proposal-8-auto-remediation.md` |

---

## 1.2 Unit Test Coverage

**Latest execution standard (2026-02-22):** 59 files, 898 tests 100% passed, lines coverage 62.22%
**Note:** The detailed table below is a 2026-02-10 extended operations snapshot.

### Test status (2026-02-10 snapshot: 23 files, 541 tests)

#### Phase 1-2: Core business logic (10 modules, 211 tests)

| module | test | Coverage | Description |
|------|--------|---------|------|
| `anomaly-detector.test.ts` | 24 | 98.92% | Z-Score, CPU zero-drop, block plateau |
| `metrics-store.test.ts` | 19 | 100% | Ring buffer, stats, trend detection |
| `scaling-decision.test.ts` | 36 | 100% | Hybrid scoring, vCPU tiers |
| `predictive-scaler.test.ts` | 20 | ~75% | Rate limiting, AI parsing, fallback |
| `rca-engine.test.ts` | 25 | ~60% | Dependency graph, fault propagation |
| `cost-optimizer.test.ts` | 23 | ~75% | Fargate pricing, recommendations |
| `anomaly-ai-analyzer.test.ts` | 16 | ~75% | AI semantic analysis, fallback |
| `usage-tracker.test.ts` | 19 | ~85% | Usage patterns, stress filtering |
| `alert-dispatcher.test.ts` | 18 | ~80% | Slack formatting, cooldown |
| `daily-accumulator.test.ts` | 36 | 97.6% | Snapshot capture, hourly summaries |

#### Phase 3: System module (2 modules, 80 tests)

| module | test | Coverage | Description |
|------|--------|---------|------|
| `scheduler.test.ts` | 27 | ~90% | Cron scheduling, idempotency |
| `redis-store.test.ts` | 53 | ~95% | InMemory/Redis state management |

#### Round 2: Data/Tracking Module (3 modules, 93 tests)

| module | test | Coverage | Description |
|------|--------|---------|------|
| `ai-response-parser.test.ts` | 37 | ~85% | JSON extraction, error handling |
| `prediction-tracker.test.ts` | 30 | ~90% | Prediction accuracy tracking |
| `anomaly-event-store.test.ts` | 27 | ~88% | Event lifecycle management |

#### Round 3: Log/Reporting Module (3 modules, 50 tests) ✨ NEW

| module | test | Coverage | Description |
|------|--------|---------|------|
| `ai-analyzer.test.ts` | 12 | ~80% | Log chunk AI analysis |
| `log-ingester.test.ts` | 19 | ~85% | K8s log fetching |
| `daily-report-generator.test.ts` | 20 | ~80% | Report generation + fallback |

#### Existing modules (5 modules, 56 tests)

| module | test | Coverage | Description |
|------|--------|---------|------|
| `ai-client.test.ts` | 17 | ~90% | Multi-provider AI fallback |
| `k8s-scaler.test.ts` | 11 | ~85% | StatefulSet patching |
| `k8s-config.test.ts` | 7 | ~80% | kubectl configuration |
| `nlops-engine.test.ts` | 31 | ~90% | Natural language intent classification |
| `zero-downtime-scaler.test.ts` | 21 | ~95% | Pod swap orchestration |

### Overall testing status

| indicators | 2026-02-09 | 2026-02-10 | growth rate |
|------|-----------|-----------|--------|
| **테스트 파일** | 10 | **23** | +130% |
| **Number of tests** | 211 | **541** | +156% |
| **커버리지** | 23% | **~51%** (Total), **~70%** (Core) | +50% |
| **Running Time** | 0.4s | 1.0s | - |

---

## 2. Preferences

### 2.1 Required environment variables

```bash
# .env.local
L2_RPC_URL=https://mainnet.optimism.io
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org

# AI Gateway (Tokamak)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=sk-xxx

# optional
AWS_CLUSTER_NAME=op-celestia-dev
K8S_NAMESPACE=optimism
```

### 2.2 Install dependencies

```bash
cd /home/theo/SentinAI
npm install
```

---

## 3. Local testing

### 3.1 Running the development server

```bash
npm run dev
# Check the dashboard at http://localhost:3002
```

### 3.2 Unit testing

```bash
# Full tests (898 tests, 59 files)
npm run test:run

# Full testing + coverage report
npm run test:coverage

# Run tests for each section
## Existing features (5 modules, 56 tests)
npx vitest run src/lib/__tests__/ai-client.test.ts              # 17 tests
npx vitest run src/lib/__tests__/k8s-scaler.test.ts            # 11 tests
npx vitest run src/lib/__tests__/k8s-config.test.ts            # 7 tests
npx vitest run src/lib/__tests__/nlops-engine.test.ts          # 31 tests
npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts  # 21 tests

## Phase 1-2: Core business logic (10 modules, 211 tests)
npx vitest run src/lib/__tests__/anomaly-detector.test.ts      # 24 tests
npx vitest run src/lib/__tests__/metrics-store.test.ts         # 19 tests
npx vitest run src/lib/__tests__/scaling-decision.test.ts      # 36 tests
npx vitest run src/lib/__tests__/predictive-scaler.test.ts     # 20 tests
npx vitest run src/lib/__tests__/rca-engine.test.ts            # 25 tests
npx vitest run src/lib/__tests__/cost-optimizer.test.ts        # 23 tests
npx vitest run src/lib/__tests__/anomaly-ai-analyzer.test.ts   # 16 tests
npx vitest run src/lib/__tests__/usage-tracker.test.ts         # 19 tests
npx vitest run src/lib/__tests__/alert-dispatcher.test.ts      # 18 tests
npx vitest run src/lib/__tests__/daily-accumulator.test.ts     # 36 tests

## Phase 3: System module (2 modules, 80 tests)
npx vitest run src/lib/__tests__/scheduler.test.ts             # 27 tests
npx vitest run src/lib/__tests__/redis-store.test.ts           # 53 tests

## Round 2: Data/Tracking Module (3 modules, 93 tests)
npx vitest run src/lib/__tests__/ai-response-parser.test.ts    # 37 tests
npx vitest run src/lib/__tests__/prediction-tracker.test.ts    # 30 tests
npx vitest run src/lib/__tests__/anomaly-event-store.test.ts   # 27 tests

## Round 3: Log/Reporting Module (3 modules, 50 tests) ✨ NEW
npx vitest run src/lib/__tests__/ai-analyzer.test.ts           # 12 tests
npx vitest run src/lib/__tests__/log-ingester.test.ts          # 19 tests
npx vitest run src/lib/__tests__/daily-report-generator.test.ts # 20 tests

# Watch mode
npm test

# Run only specific tests
npx vitest run -t "should detect spike" # Search by specific test name
```

### 3.3 E2E testing

```bash
# Install Playwright (first time)
npx playwright install

# Run E2E tests
npm run test:e2e

# Run in UI mode
npx playwright test --ui
```

### 3.4 Tier 3 Gate Test (Coverage/E2E/Bundle/CWV)

#### Run integration (recommended)

```bash
npm run prod:gate:tier3
```

Run script: `scripts/prod-gate-tier3.sh`

#### Individual execution

```bash
# 12) Coverage gate
npm run test:coverage
node scripts/check-coverage.mjs

# 14) Bundle gate
npm run build
node scripts/check-bundle-size.mjs

# 13) E2E gate
npx playwright install --with-deps chromium
npm run test:e2e

# 15) CWV gate
npx @lhci/cli@0.15.x autorun --config=.lighthouserc.cwv.json
```

#### Threshold adjustment (for local experiments)

```bash
# Change minimum coverage value (default 50)
TIER3_MIN_COVERAGE_PCT=55 node scripts/check-coverage.mjs

# Change bundle maximum (default 200KB)
TIER3_FIRST_LOAD_JS_MAX_BYTES=230400 node scripts/check-bundle-size.mjs
```

#### Check order in case of failure

1. Check if `npm run build` succeeds first.
2. Check whether Playwright browser is installed (`npx playwright install --with-deps chromium`)
3. Check whether `.next/build-manifest.json` is created (Bundle gate prerequisite)
4. Check whether `coverage/coverage-summary.json` is created (Coverage gate prerequisite)
5. Check if the CWV measurement URL is opened (`http://localhost:3002/v2`)

#### CI auto-run

- 워크플로: `.github/workflows/prod-gate-tier3.yml`
- Trigger: Every day at UTC 00:00 (KST 09:00), manual execution (`workflow_dispatch`)

---

## 4. API testing

### 4.1 Core API endpoints

| Endpoint | method | Description |
|-----------|--------|------|
| `/api/health` | GET | system status |
| `/api/metrics` | GET | L2 metrics query |
| `/api/metrics?stress=true` | GET | stress mode metrics |
| `/api/metrics/seed?scenario=rising` | POST | Seed test data |
| `/api/anomalies` | GET | Anomaly detection results |
| `/api/rca` | POST | Root Cause Analysis |
| `/api/cost-report?days=7` | GET | Cost Analysis Report |
| `/api/scaler` | GET | scaler status |
| `/api/scaler` | POST | Running Scaling |

### 4.2 curl test example

```bash
# Health check
curl http://localhost:3002/api/health | jq

# Metric query
curl http://localhost:3002/api/metrics | jq

# Stress mode metrics
curl "http://localhost:3002/api/metrics?stress=true" | jq

# Anomaly detection
curl http://localhost:3002/api/anomalies | jq

# RCA analysis (AI call)
curl -X POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}' | jq

# Cost report (AI call)
curl "http://localhost:3002/api/cost-report?days=7" | jq

# Seed prediction data
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising" | jq
```

---

## 5. Test dashboard functionality

### 5.1 Main dashboard (page.tsx)

| Features | Test Method | Expected results |
|------|------------|----------|
| network status | Check the top bar | L1/L2 block height, TxPool, Sync status |
| stress mode | Click the “Simulate Load” button | CPU surges, costs increase |
| Predictive Scaling | Check out Resource Center | Show current → predicted vCPUs |
| Anomaly Detection | Anomaly Banner | Red banner when detecting CPU spike, etc. |
| RCA analysis | “CHECK HEALTH” button | Display AI analysis results |
| cost analysis | “COST ANALYSIS” button | Usage pattern heatmap, recommendation display |

### 5.2 Test scenario

#### Scenario 1: Verify healthy state
1. Access dashboard
2. Check the L2 Block increase in the network status bar
3. Check Health Score 90+
4. Click “CHECK HEALTH” → “System Healthy” message

#### Scenario 2: Stress Mode
1. Click the “Simulate Load” button
2. Check CPU Usage surge (50% → 80%+)
3. Check the Anomaly Banner display
4. Check vCPU scale-up (1 → 2 or 4)

#### Scenario 3: RCA Analysis
1. Activate stress mode
2. Click “CHECK HEALTH” or “Analyze Now” on the Anomaly Banner
3. Check AI analysis results:
   - Root Cause (component, description, confidence)
- Causal Chain (event sequence)
- Remediation (immediate action, preventive action)

#### Scenario 4: Cost Analysis
1. Click the “COST ANALYSIS” button
2. Check usage pattern heatmap (7 days x 24 hours)
3. Check AI recommendations (downscale, schedule, etc.)
4. Check expected savings

---

## 6. Code structure

### 6.1 Core libraries

```
src/lib/
├── ai-client.ts # Claude API integration
├── anomaly-detector.ts # Anomaly detection (Z-Score, Rules)
├── anomaly-event-store.ts # anomaly event store
├── cost-optimizer.ts # AI cost optimization
├── k8s-scaler.ts # K8s scaling
├── metrics-store.ts # Store metrics time series
├── prediction-tracker.ts # prediction tracking
├── predictive-scaler.ts # AI predictive scaling
├── rca-engine.ts # Root cause analysis
├── usage-tracker.ts # Track usage patterns
└── zero-downtime-scaler.ts# Non-stop scaling
```

### 6.2 Type definition

```
src/types/
├── anomaly.ts      # AnomalyResult, AnomalyMetric
├── cost.ts         # CostReport, CostRecommendation, UsagePattern
├── daily-report.ts # DailyReport
├── prediction.ts   # MetricDataPoint, PredictionResult
├── rca.ts          # RCAResult, RCAEvent, RCAComponent
├── redis.ts # Redis state type
├── scaling.ts      # ScalingDecision, AISeverity
└── zero-downtime.ts# ZeroDowntimeConfig
```

### 6.3 API Route

```
src/app/api/
├── anomalies/
│ ├── config/route.ts # Anomaly detection settings
│ └── route.ts # Anomaly detection query
├── cost-report/route.ts # Cost analysis report
├── health/route.ts # Health check
├── metrics/
│ ├── route.ts # Metric query
│ └── seed/route.ts # Seed test data
├── rca/route.ts # Root cause analysis
├── reports/daily/route.ts# Daily report
└── scaler/route.ts # Scaler status/execution
```

---

## 7. AI testing

### 7.1 Check AI Gateway integration

```bash
# AI Gateway Connection Test (RCA)
curl -X POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}'

# Example response
{
  "success": true,
  "result": {
    "id": "rca-xxx",
    "rootCause": {
      "component": "op-geth",
      "description": "CPU usage spike...",
      "confidence": 0.85
    },
    ...
  }
}
```

### 7.2 Check fallback in case of AI failure

Check whether the fallback logic operates even when AI Gateway connection fails:

```bash
# Temporarily set ANTHROPIC_API_KEY to an invalid value
export ANTHROPIC_API_KEY=invalid

# RCA request → check fallback response
curl -X POST http://localhost:3002/api/rca -H "Content-Type: application/json" -d '{}'
# confidence: 0.3 (show fallback)
```

---

## 8. Build and Deploy

### 8.1 Production build

```bash
npm run build
npm run start
```

### 8.2 Cloud Run Deployment

```bash
# Run deployment script
./deploy-cloudrun.sh

# or manual deployment
gcloud run deploy sentinai \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```

---

## 9. Troubleshooting

### 9.1 General issues

| Symptoms | Cause | Solved |
|------|------|------|
| API not responding | Development server not running | Run `npm run dev` |
| AI analysis failure | API key not set | Check `.env.local` |
| Show Metric 0 | RPC connection failure | Check L2_RPC_URL |
| Build failed | type error | `npx tsc --noEmit` |

### 9.2 Check log

```bash
# Development server log
npm run dev 2>&1 | tee dev.log

# Filter specific module logs
grep "\[RCA Engine\]" dev.log
grep "\[Cost Optimizer\]" dev.log
grep "\[AI Client\]" dev.log
```

---

## 10. Next steps

### 10.1 Awaiting implementation

- **P5 NLOps**: System control with natural language commands
- **P6 Zero-Downtime**: Non-disruptive scaling strategy
- **P7 Redis State**: distributed state storage
- **P8 Auto-Remediation**: Auto-remediation system
- **Telegram Bot**: Mobile monitoring
- **Universal Platform**: Multi-blockchain support

### 10.2 Document location

```
docs/
├── done/ # Proposal that has been implemented
│   ├── proposal-1-predictive-scaling.md
│   ├── proposal-2-anomaly-detection.md
│   ├── proposal-3-rca-engine.md
│   └── proposal-4-cost-optimizer.md
├── todo/ # Waiting for implementation
│   ├── proposal-5-nlops.md
│   ├── proposal-6-zero-downtime-scaling.md
│   ├── proposal-7-redis-state-store.md
│   ├── proposal-8-auto-remediation.md
│   ├── telegram-bot-integration.md
│   ├── universal-blockchain-platform.md
│ └── testing-guide.md # This document
├── spec/ # technical specification
└── verification/ # verification report
```
