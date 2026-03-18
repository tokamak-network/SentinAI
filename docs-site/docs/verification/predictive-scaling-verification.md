# Predictive Scaling function verification and performance evaluation

| Item | Content |
|------|------|
| version | 1.0.0 |
| Created date | 2026-02-06 |
| based document | `docs/done/proposal-1-predictive-scaling.md` |
| target | QA, DevOps, Project Manager |

---

## 1. Implementation complete status

### 1.1 Implementation status by file

| file | status | number of lines | Remarks |
|------|------|---------|------|
| `src/types/prediction.ts` | Done | 169 | 8 types/interface definitions |
| `src/lib/metrics-store.ts` | Done | 169 | Ring Buffer (60 items), linear regression trend detection |
| `src/lib/predictive-scaler.ts` | Done | 311 | AI Gateway integration, fallback logic |
| `src/lib/prediction-tracker.ts` | Done | 153 | Accuracy tracking (up to 100 records) |
| `src/app/api/metrics/route.ts` | Edit completed | - | `pushMetric` integration, blockInterval calculation |
| `src/app/api/scaler/route.ts` | Edit completed | - | Integrating prediction logic into GET/POST |
| `src/app/page.tsx` | Edit completed | - | Forecast cards, trend charts, progress UI |

### 1.2 Fidelity of implementation compared to proposal

- **Type definition**: 100% match (as proposed specification)
- **MetricsStore**: 100% match (Ring Buffer, statistics, trends)
- **Predictive Scaler**: 100% match (AI Linkage, Fallback, Rate Limiting)
- **Prediction Tracker**: 100% match (accuracy tracking)
- **API integration**: 100% match (metrics pushMetric, scaler prediction integration)
- **UI**: 100% match (Forecast card, progress, Key Factors)
- **Test Code**: Not implemented

---

## 2. Functional verification procedure

### 2.1 Prerequisites

```bash
# 1. Setting environment variables (.env.local)
L2_RPC_URL=https://rpc.titok.tokamak.network # 필수
AI_GATEWAY_URL=https://api.ai.tokamak.network # 예측 AI용
ANTHROPIC_API_KEY=<your-key> # For predictive AI

# 2. Run a development server
npm run dev    # localhost:3002

# or Docker
docker compose up -d    # localhost:3002
```

### 2.2 TC-01: MetricsStore data collection verification

**Purpose**: Check if data is accumulated in MetricsStore when calling `/api/metrics`

```bash
# 15 consecutive calls (5 second intervals)
for i in $(seq 1 15); do
  echo "=== Request $i ==="
  curl -s "http://localhost:3002/api/metrics" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"cpu={d['metrics']['cpuUsage']:.1f}%, txPool={d['metrics']['txPoolCount']}, block={d['metrics']['blockHeight']}\")"
  sleep 5
done
```

**Acceptance Criteria**:
- [ ] Return JSON response for each call (HTTP 200)
- [ ] Output `Kubectl Failed` or RPC data to the server log (errors are allowed when K8s is not connected)
- [ ] cpuUsage, txPoolCount, blockHeight values ​​are updated every time

### 2.3 TC-02: Check prediction metadata (data insufficient condition)

**Purpose**: Ensure that `prediction: null`, `isReady: false` are returned when there are less than 10 data points.

```bash
# Called immediately after server restart (0 data state)
curl -s "http://localhost:3002/api/scaler" | python3 -m json.tool
```

**Acceptance Criteria**:
- [ ] `prediction` field is `null`
- [ ] `predictionMeta.metricsCount` < 10
- [ ] `predictionMeta.isReady` = `false`
- [ ] `predictionMeta.minRequired` = 10

**Expected response**:
```json
{
  "currentVcpu": 1,
  "prediction": null,
  "predictionMeta": {
    "metricsCount": 0,
    "minRequired": 10,
    "nextPredictionIn": 0,
    "isReady": false
  }
}
```

### 2.4 TC-03: AI prediction generation verification (data sufficient state)

**Purpose**: Check whether AI predictions are generated normally after accumulating more than 10 pieces of data

```bash
# Step 1: Data accumulation (at least 10 times, approximately 50 seconds)
for i in $(seq 1 12); do
  curl -s "http://localhost:3002/api/metrics" > /dev/null
  echo "Collected data point $i"
  sleep 5
done

# Step 2: Check prediction
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('predictionMeta', {})
pred = d.get('prediction')
print(f\"metricsCount: {meta.get('metricsCount')}\")
print(f\"isReady: {meta.get('isReady')}\")
if pred:
    print(f\"predictedVcpu: {pred['predictedVcpu']}\")
    print(f\"confidence: {pred['confidence']}\")
    print(f\"trend: {pred['trend']}\")
    print(f\"action: {pred['recommendedAction']}\")
    print(f\"reasoning: {pred['reasoning'][:100]}...\")
    print(f\"factors: {len(pred.get('factors', []))} items\")
else:
    print('prediction: null (AI not available or insufficient data)')
"
```

**Acceptance Criteria**:
- [ ] `predictionMeta.isReady` = `true`
- [ ] `prediction` field is not `null` (when connected to AI) or returns fallback prediction
- [ ] `predictedVcpu` is one of 1, 2, or 4
- [ ] `confidence` ranges from 0.0 to 1.0
- [ ] `trend` is one of `rising`, `falling`, or `stable`
- [ ] `recommendedAction` is one of `scale_up`, `scale_down`, or `maintain`
- [ ] 1 or more elements present in `factors` array

### 2.5 TC-04: Rate Limiting (5 minute cooldown) verification

**Purpose**: Verify that cached predictions are returned when re-requested within 5 minutes

```bash
# Step 1: Request the first prediction
PRED1=$(curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prediction',{}).get('generatedAt','none'))")
echo "Prediction 1 generatedAt: $PRED1"

# Step 2: Immediately re-request
PRED2=$(curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prediction',{}).get('generatedAt','none'))")
echo "Prediction 2 generatedAt: $PRED2"

# Step 3: Check nextPredictionIn
curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"nextPredictionIn: {d['predictionMeta']['nextPredictionIn']:.0f}s\")"
```

**Acceptance Criteria**:
- [ ] `generatedAt` timestamps of `PRED1` and `PRED2` are the same (cache return)
- [ ] `nextPredictionIn` > 0 (on cooldown)

### 2.6 TC-05: Fallback verification in case of AI Gateway failure

**Purpose**: Check whether rule-based fallback prediction works when AI Gateway connection fails.

```bash
# Change AI_GATEWAY_URL to the wrong address and run
AI_GATEWAY_URL=http://localhost:9999 npm run dev

# Request prediction after accumulating data
# (After performing the same data accumulation procedure as TC-03 above)
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
pred = d.get('prediction')
if pred:
    print(f\"confidence: {pred['confidence']}\")
    print(f\"reasoning: {pred['reasoning']}\")
else:
    print('No prediction')
"
```

**Acceptance Criteria**:
- [ ] Server does not crash
- [ ] `prediction` is not `null` (Fallback operation)
- [ ] `confidence` = 0.5 (Fallback 고정값)
- [ ] `reasoning` contains the string "Fallback"

### 2.7 TC-06: Proactive scaling decision verification

**Purpose**: Determine whether predictive-based proactive scaleup takes precedence over reactive when making POST `/api/scaler` calls.

```bash
# Test with auto-scaling + dry run
curl -s -X POST "http://localhost:3002/api/scaler" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}' | python3 -m json.tool
```

**Acceptance Criteria**:
- [ ] Include `[Predictive]` prefix in `decision.reason` (when making prediction-based decisions)
- Use [ ] or responsive decision (if prediction confidence < 0.7 or not scale_up)
- [ ] No actual K8s changes with `dryRun: true`

### 2.8 TC-07: UI validation

**Purpose**: Verify that forecast-related UI elements are displayed correctly in the dashboard.

```
Access http://localhost:3002 (or Docker: http://localhost:3002) in your browser.
```

| Verification items | How to check |
|-----------|----------|
| Scaling Forecast Card | Show title "Scaling Forecast" |
| Data collection progress | Immediately after starting the server: "Collecting Data..." progress bar |
| Predicted vCPU visualization | When data is sufficient: Compare Current vCPU → Predicted vCPU |
| Trend direction | Arrow icon changes color according to trend (rising=orange, falling=green) |
| Action badge | Scale Up (orange), Scale Down (green), Stable (blue) |
| AI Insight | Predictive reasoning text display |
| Key Factors | Up to 3 elements, colored according to impact |
| Resource Trend Chart | CPU % area chart, trend label display |

### 2.9 TC-08: Independence from stress mode

**Purpose**: Ensure that no data is stored in MetricsStore in `stress=true` mode.

```bash
# Call stress mode 10 times
for i in $(seq 1 10); do
  curl -s "http://localhost:3002/api/metrics?stress=true" > /dev/null
done

# Check metricsCount (should not increase)
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"metricsCount: {d['predictionMeta']['metricsCount']}\")"
```

**Acceptance Criteria**:
- [ ] `metricsCount` is the same (does not increase) before and after calling stress mode

---

## 3. Performance evaluation criteria

### 3.1 Metric collection performance

| indicators | target value | Measurement method |
|------|--------|----------|
| pushMetric overhead | < 1ms | metrics API response time comparison (before/after push) |
| Ring Buffer Memory | < 50KB | 60 data points × ~800 bytes/point |
| statistical calculation time | < 5 ms | `getMetricsStats()` execution time |

**Measurement Script**:
```bash
# Average response time for 50 calls
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:3002/api/metrics"
done | awk '{sum+=$1; count++} END {printf "avg: %.3fs (n=%d)\n", sum/count, count}'
```

### 3.2 AI prediction performance

| indicators | target value | Remarks |
|------|--------|------|
| AI Gateway response time | < 3s | Based on Claude Haiku 4.5 |
| Fallback response time | < 10ms | Rules-based, no network required |
| Rate Limiting Effect | AI call up to 1 time per 5 minutes | cost control |
| Cache hit rate | > 95% | Consider polling frequency compared to 5 minute cooldown |

**Measurement Script**:
```bash
# scaler API response time (including predictions)
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:3002/api/scaler"
done | awk '{sum+=$1; count++} END {printf "avg: %.3fs (n=%d)\n", sum/count, count}'
```

### 3.3 Evaluation of prediction accuracy

> **Note**: Accuracy measurements can only be meaningful after long-term (24 hours+) operation in a real K8s cluster connection environment.

| indicators | target value | Remarks |
|------|--------|------|
| Overall Accuracy | > 70% | predicted vs actual vCPU difference ≤ 1 |
| Recent 20 Accuracy | > 75% | Reflection of learning effects |
| False Positive Rate | < 20% | Unnecessary scale_up ratio |
| Preemptive scaling effect | > 0 | Number of times we scaled up faster compared to responsive |

**Prediction Tracker API** (currently internal module, API endpoint not exposed):
```typescript
// Accuracy statistics provided by prediction-tracker.ts
import { getAccuracy } from '@/lib/prediction-tracker';

const stats = getAccuracy();
// {
//   totalPredictions: 45,
//   verifiedPredictions: 30,
//   accuratePredictions: 24,
//   accuracyRate: 0.80,
//   recentAccuracy: 0.85,
// }
```

### 3.4 Cost impact assessment

| Scenario | Estimated Cost Impact |
|---------|---------------|
| AI Gateway call | ~288 calls/day (based on 5 minute cooldown) |
| Preemptive scale-up (hit) | Avoid service interruption, cost neutral |
| Proactive scale-up (false positives) | Unnecessary vCPU increase → additional cost of up to $0.09/hour |
| Fallback mode | $0 AI cost, risk of decreased accuracy |

---

## 4. Edge case verification

| # | Scenario | Expected Behavior | Verification method |
|---|---------|----------|----------|
| E-01 | AI Gateway timeout | Fallback prediction (confidence 0.5) | Set AI_GATEWAY_URL to slow server |
| E-02 | AI returns incorrect JSON | Fallback prediction | Manual testing or unit testing |
| E-03 | AI returns `predictedVcpu: 3` | `parseAIResponse` returns null → Fallback | unit testing |
| E-04 | AI returns `confidence: 1.5` | `parseAIResponse` returns null → Fallback | unit testing |
| E-05 | MetricsStore buffer overflow (61+) | Remove oldest data (keep 60) | Check count after pushMetric 61 times |
| E-06 | Restart server | MetricsStore initialization (in-memory) | After server restart metricsCount=0 |
| E-07 | Simultaneous multiple requests | Call AI only once with rate limiting | Running 10 curls in parallel |
| E-08 | L2 RPC connection failure | metrics API 500 → Stop data collection | Setting L2_RPC_URL to invalid value |

---

## 5. Known limitations

### 5.1 In-memory state volatility

MetricsStore, PredictionTracker, and scaling state are all managed in-memory. All time series data and forecast history will be reset upon server restart.

**Impact**: Unpredictable until at least 10 data points are accumulated after deployment/restart (approximately 50 seconds to 10 minutes)

### 5.2 Prediction Tracker not linked

`prediction-tracker.ts` is implemented, but `recordPrediction()` / `recordActual()` is not called in `scaler/route.ts`. Additional integration is required to enable accuracy tracking.

### 5.3 Single source of metrics

Data is currently collected depending on the polling cycle in `metrics/route.ts` (frontend 1 second). There is no separate background collector, so data is only accumulated when the UI is open.

### 5.4 Absence of test code

Unit tests, integration tests have not been written yet. Testing of core functions such as `parseAIResponse`, `calculateStats`, and `generateFallbackPrediction` is recommended.

---

## 6. Summary of verification checklist

### Build and type safety

- [ ] `npx tsc --noEmit` No error
- [ ] No error with `npm run lint` (existing warning allowed)
- [ ] `npm run build` success

### Functional verification (TC-01 ~ TC-08)

- [ ] TC-01: MetricsStore data collection
- [ ] TC-02: prediction null when data is insufficient
- [ ] TC-03: AI Prediction Generation
- [ ] TC-04: Rate Limiting (5 minute cooldown)
- [ ] TC-05: AI Fallback operation
- [ ] TC-06: Proactive scaling decision making
- [ ] TC-07: Display UI elements
- [ ] TC-08: Stress mode independence

### Performance criteria

- [ ] metrics API response < 3s (when connected to K8s)
- [ ] scaler API response < 5s (including AI calls)
- [ ] Fallback response < 100ms
- [ ] Stable memory usage (limited to 60 data points)

---

*End of document*
