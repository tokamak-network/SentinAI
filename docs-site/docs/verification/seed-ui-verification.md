# Predictive Scaling — Seed-based UI verification guide

| Item | Content |
|------|------|
| version | 1.0.0 |
| Created date | 2026-02-06 |
| based document | `docs/verification/predictive-scaling-verification.md` |
| target | Front-end QA, developer |
| Prerequisites | No K8s/RPC required. Just run `npm run dev` |

---

## 1. Overview

Inject scenario-specific mock data into MetricsStore through the `POST /api/metrics/seed?scenario=<name>` endpoint and verify the Predictive Scaling function in the dashboard UI.

**Advantage**: The operation of the Scaling Forecast card can be fully verified without an actual L2 RPC connection or K8s cluster.

### Available scenarios

| Scenario | CPU pattern | TxPool pattern | Expected Forecast Results |
|---------|---------|------------|---------------|
| `stable` | 15~25% 평탄 | 10~30 | maintain, 1 vCPU |
| `rising` | 20% → 70% linear increase | Increase from 20 → 200 | scale_up, 2 to 4 vCPU |
| `spike` | 30% flat → last 5 95% | 50 → 5000 surge | scale_up, 4 vCPU |
| `falling` | 80% → 20% reduction | 300 → 20 decrease | scale_down, 1 vCPU |

---

## 2. Advance preparation

```bash
# Run the development server (seed function works even without L2_RPC_URL)
npm run dev
# Connect to http://localhost:3002
```

> **Note**: Seed endpoints and UI are only active in the `NODE_ENV !== 'production'` environment.

---

## 3. UI verification items

### TC-S01: Seed Test Data panel display

**Purpose**: Verify that the Seed UI component is rendered properly in the development environment.

**procedure**:
1. Access `http://localhost:3002` in browser
2. Resource Center on the left → Check Scaling Forecast card

**Acceptance Criteria**:
- [ ] “Seed Test Data” label and Database icon are displayed
- There are 4 scenario options in the [ ] dropdown: Stable, Rising, Spike, Falling
- [ ] “Seed” button is active (indigo color)
- [ ] Dropdown default value is "Rising (20% → 70%)"

---

### TC-S02: Stable scenario injection and prediction verification

**Purpose**: Verify that “maintain” predictions are visible after steady-state data injection

**procedure**:
1. Select “Stable (15-25% CPU)” from the dropdown
2. Click the “Seed” button
3. The button changes to “Seeding...” state and waits for return.

**Acceptance Criteria**:
- When the [ ] button is clicked, the text changes to “Seeding...” and becomes inactive.
- After completing [ ], the button returns to “Seed”.
- [ ] The Action badge on the Scaling Forecast card displays **blue "Stable"**
- [ ] Display reasoning text in AI Insight area (e.g. phrases related to “stable”, “idle”)
- [ ] Data Collection progress bar disappears (`isReady: true`)
- [ ] Predicted vCPU is displayed as **1 vCPU**
- [ ] Trend arrow icon is **gray (rotated 45 degrees)**

---

### TC-S03: Rising scenario injection and scale-up prediction confirmation

**Purpose**: Verify that “scale_up” forecasts are visible after injection of uptrend data.

**procedure**:
1. Select “Rising (20% → 70%)” from the dropdown
2. Click the “Seed” button
3. Wait for results

**Acceptance Criteria**:
- [ ] Action badge displays **orange "Scale Up"**
- [ ] Predicted vCPU displayed as **2 or 4 vCPU**
- [ ] Predicted vCPU box has **orange background** (higher value than current)
- [ ] Trend arrow is **orange** (rising)
- [ ] Displays reasoning related to rising trends in the AI ​​Insight area
- [ ] Key Factors section is displayed and there are 1 to 3 elements
- [ ] Among Key Factors, items with impact > 0.3 are marked with **orange dots**.

---

### TC-S04: Spike scenario injection and emergency scale-up confirmation

**Purpose**: Verify maximum scale-up prediction after rapid spike data injection

**procedure**:
1. Select “Spike (30% → 95%)” from the dropdown
2. Click the “Seed” button
3. Wait for results

**Acceptance Criteria**:
- [ ] Action badge displays **orange "Scale Up"**
- [ ] Predicted vCPU displayed as **4 vCPU**
- [ ] AI Insight displays reasoning related to a spike or sudden increase
- [ ] AI Confidence percentage is displayed (e.g. "AI Confidence: 85%")

---

### TC-S05: Falling scenario injection and scale-down prediction confirmation

**Purpose**: Verify “scale_down” predictions after injecting downward trend data.

**procedure**:
1. Select “Falling (80% → 20%)” from the dropdown.
2. Click the “Seed” button
3. Wait for results

**Acceptance Criteria**:
- [ ] Action badge displays **green "Scale Down"**
- [ ] Predicted vCPU is displayed as **1 vCPU**
- [ ] Predicted vCPU box is the same as current or **green background** (lower value than current)
- [ ] Trend arrow turns **green (rotated 180 degrees)**
- [ ] Among Key Factors, items with impact < -0.3 are marked with a **green dot**.

---

### TC-S06: Transition consistency between scenarios

**Purpose**: Ensure that the UI refreshes correctly when switching between multiple scenarios in succession.

**procedure**:
1. Rising scenario Seed → Check results
2. Immediately seed the Falling scenario → check the results
3. Immediately seed the Spike scenario → Check the results
4. Immediately seed the stable scenario → check the results

**Acceptance Criteria**:
- [ ] At each conversion, the previous prediction data is completely replaced.
- [ ] Action badge color changed to suit the scenario
- [ ] Predicted vCPU value changed to suit scenario
- [ ] Trend arrow direction/color changed to suit the scenario
- [ ] No errors or broken UI

---

### TC-S07: Seed button continuous click defense

**Purpose**: Check whether re-clicks are blocked during seeding

**procedure**:
1. Click the “Seed” button
2. Try clicking the button again in the "Seeding..." state.

**Acceptance Criteria**:
- [ ] Button is disabled in "Seeding..." state (cursor-not-allowed)
- [ ] No duplicate requests occur
- Return to normal operation after [ ] completion

---

### TC-S08: Data Collection progress bar → prediction conversion

**Purpose**: Insufficient data → Verify transition where progress bar disappears and prediction is displayed after seed injection

**procedure**:
1. Restart the server to initialize MetricsStore
2. Access dashboard → Check “Collecting Data...” progress bar
3. Inject data with the Seed button

**Acceptance Criteria**:
- [ ] Display “Collecting Data...” progress bar immediately after server restart
- [ ] Display “N/10 data points” text under progress bar
- [ ] Progress bar disappears after seed injection
- [ ] Prediction result (Current vCPU → Predicted vCPU) visualization is displayed instead

---

## 4. CLI Verification (Secondary)

Auxiliary procedures to verify data at the API level before and after UI validation.

### 4.1 Verify scenario injection

```bash
# Rising scenario injection
curl -s -X POST "http://localhost:3002/api/metrics/seed?scenario=rising" | python3 -m json.tool
```

**Expected response**:
```json
{
    "success": true,
    "scenario": "rising",
    "injectedCount": 20,
    "timeRange": { "from": "...", "to": "..." },
    "summary": {
        "cpuRange": "18.5% - 71.2%",
        "txPoolRange": "15 - 208"
    }
}
```

### 4.2 Check prediction after injection

```bash
curl -s "http://localhost:3002/api/scaler" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('predictionMeta', {})
pred = d.get('prediction')
print(f'metricsCount: {meta.get(\"metricsCount\")}')
print(f'isReady: {meta.get(\"isReady\")}')
if pred:
    print(f'predictedVcpu: {pred[\"predictedVcpu\"]}')
    print(f'confidence: {pred[\"confidence\"]}')
    print(f'trend: {pred[\"trend\"]}')
    print(f'action: {pred[\"recommendedAction\"]}')
    print(f'reasoning: {pred[\"reasoning\"][:80]}...')
else:
    print('prediction: null')
"
```

### 4.3 Batch verification of 4 scenarios

```bash
for scenario in stable rising spike falling; do
  echo "=== $scenario ==="
  curl -s -X POST "http://localhost:3002/api/metrics/seed?scenario=$scenario" > /dev/null
  sleep 1
  curl -s "http://localhost:3002/api/scaler" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pred = d.get('prediction')
if pred:
    print(f'  vcpu={pred[\"predictedVcpu\"]} trend={pred[\"trend\"]} action={pred[\"recommendedAction\"]} conf={pred[\"confidence\"]}')
else:
    print('  prediction: null')
"
  echo ""
done
```

**Expected results**:
```
=== stable ===
  vcpu=1 trend=stable action=maintain conf=0.xx

=== rising ===
  vcpu=2 trend=rising action=scale_up conf=0.xx

=== spike ===
  vcpu=4 trend=rising action=scale_up conf=0.xx

=== falling ===
  vcpu=1 trend=falling action=scale_down conf=0.xx
```

> **Note**: If the AI ​​Gateway is not connected, fallback prediction is returned and confidence is fixed at 0.5. Even in fallback mode, trends and recommendedActions are judged correctly according to data patterns.

---

## 5. Summary of verification checklist

### Seed UI rendering

- [ ] TC-S01: Seed Test Data panel display

### Forecast results by scenario

- [ ] TC-S02: Stable → maintain, 1 vCPU, blue badge
- [ ] TC-S03: Rising → scale_up, 2~4 vCPU, orange badge
- [ ] TC-S04: Spike → scale_up, 4 vCPU, orange badge
- [ ] TC-S05: Falling → scale_down, 1 vCPU, green badge

###Interaction

- [ ] TC-S06: Transition consistency between scenarios
- [ ] TC-S07: Seed button continuous click defense
- [ ] TC-S08: Progress bar → Prediction conversion

---

*End of document*
