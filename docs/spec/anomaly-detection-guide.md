# Anomaly Detection standards and operation method

## 📋 Overview

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.

1. **Layer 1**: Statistical-based anomaly detection (Z-Score + Rule-based)
2. **Layer 2**: AI semantic analysis (Claude-based root cause analysis)
3. **Layer 3**: Send notification (Slack/Webhook)

---

## 🔍 Layer 1: Statistics-based anomaly detection

### outline

Layer 1 analyzes **real-time metric data** to detect immediate anomalies.

**파일**: `src/lib/anomaly-detector.ts`

### Detection Metrics

| metrics | Unit | Description |
|--------|------|------|
| **cpuUsage** | % | L2 node CPU utilization (0~100%) |
| **txPoolPending** | dog | Number of pending transactions |
| **gasUsedRatio** | % | Block's gas usage rate (0~1) |
| **l2BlockHeight** | number | L2 latest block height |
| **l2BlockInterval** | seconds | Consecutive block generation interval |

### Detection rules

#### 1️⃣ Z-Score based detection (most common)

**Criteria**: Deviating from the mean by more than 2.5 times the standard deviation

```
Z-Score = (Current value - Average) / Standard deviation

Detection Condition: |Z-Score| > 2.5
```

**example**:
```
Average CPU utilization: 30%
Standard deviation: 5%
Current value: 50%

Z-Score = (50 - 30) / 5 = 4.0
→ Since 4.0 > 2.5, anomaly detected! (Spike)
```

**Settings**:
```typescript
const Z_SCORE_THRESHOLD = 2.5;  // Confidence 99.3%
const MIN_HISTORY_POINTS = 5;   // Minimum 5 historical data
```

**Applies to**:
- CPU Usage (using Z-Score)
- TxPool Pending (using Z-Score)
- Gas Used Ratio (using Z-Score)
- L2 Block Interval (using Z-Score)

---

#### 2️⃣ CPU 0% Drop (Process Crash)

**Baseline**: CPU suddenly drops to 0%

```
Average CPU >= 10% for last 3 data
→ Current CPU < 1%
→ Suspected process crash
```

**Settings**:
```typescript
if (currentCpu < 1 && recentMean >= 10) {
// Determined as a process crash
}
```

**example**:
```
Recent CPU change: 35% → 32% → 38% (average 35%)
Current CPU: 0%

→ Anomaly detection! (Drop, rule: zero-drop)
→ Severity: Critical (process aborted)
```

---

#### 3️⃣ L2 Block Height Plateau (Sequencer 정지)

**Criteria**: Block height does not change for more than 2 minutes

```
All blocks have the same height for the last 2 minutes
→ Sequencer stoppage suspicion
```

**Settings**:
```typescript
const BLOCK_PLATEAU_SECONDS = 120;  // 2분

// test
if (all_recent_heights_same_&& duration >= 120 seconds) {
// Judged as Sequencer stop
}
```

**example**:
```
time block height state
14:00  12340    ✓
14:30  12340    ✓
15:00 12340 ✓ ← No change for 60 minutes

→ Anomaly detection! (Plateau, rule: plateau)
→ Severity: High (Sequencer stopped)
```

---

#### 4️⃣ Monotonically increase TxPool (Batcher fails)

**Criteria**: Transaction pool continues to grow for more than 5 minutes

```
All txPool values ​​increase or remain the same for the last 5 minutes
→ Suspected batcher failure (transaction batch not processed)
```

**Settings**:
```typescript
const TXPOOL_MONOTONIC_SECONDS = 300;  // 5분

// test
for (let i = 1; i < history.length; i++) {
if (current[i] < current[i-1]) {
isMonotonic = false;  // If it decreases even once, it is normal.
  }
}

if (isMonotonic && increment > 0) {
// Judgment as batcher failure
}
```

**example**:
```
Time TxPool Status
00:00  100     ✓
01:00 150 ✓ (increase)
02:00 180 ✓ (increased)
03:00 190 ✓ (increased)
04:00 195 ✓ (increased)
05:00 200 ✓ (Increase) ← Continue to increase for 5 minutes

→ Anomaly detection! (Spike, rule: monotonic-increase)
→ Severity: High (Batcher batch not processed)
```

---

### Detection priority

Detection order (collision avoidance):

```typescript
1. CPU 0% Drop (most severe)
2. L2 Block Height Plateau
3. TxPool Monotonic Increase
4. Z-Score based detection (excluding metrics already detected in the rules above)
```

### Exception handling

| Conditions | Action |
|------|------|
| Historical data < 5 | Skip detection (insufficient data) |
| standard deviation = 0 | Z-Score = 0 (normal, no change) |
| Metric already detected | Avoid duplicate detection |

---

## 🧠 Layer 2: AI semantic analysis

### outline

When an anomaly is detected at Layer 1, Layer 2 uses **Claude AI** to analyze the root cause.

**File**: `src/lib/anomaly-ai-analyzer.ts`

### Prompt Structure

```
System Prompt:
├─ SRE role definition
├─ Optimism component relationship diagram
├─ Common failure patterns (5 types)
└─ Analysis guidelines

User Prompt:
├─ List of detected abnormalities
├─ Current metric data
└─ related logs (op-geth, op-node, op-batcher, op-proposer)
```

### Optimism component failure patterns

| pattern | Cause | Symptoms | Impact |
|------|------|------|------|
| **L1 Reorg** | L1 chain reorganization | op-node induced state reset → temporary synchronization stop | block height stagnation |
| **L1 Gas Spike** | L1 gas prices soar | Batcher fails to send batch to L1 | Increase TxPool |
| **op-geth Crash** | op-geth process crash | CPU plummets to 0% | All downstream impacts |
| **Network Partition** | P2P network disconnection | Unable to communicate with fellow nodes | Unsafe head divergence |
| **Sequencer Stall** | Sequencer stop | Block creation stopped | Block height stagnates, TxPool increases |

### AI analysis results

```typescript
interface DeepAnalysisResult {
  severity: 'low' | 'medium' | 'high' | 'critical';
  anomalyType: 'performance' | 'security' | 'consensus' | 'liveness';
correlations: string[];           // related symptoms
predictedImpact: string;          // expected impact
suggestedActions: string[];       // 권장 조치
relatedComponents: string[];      // Affected Components
}
```

**example**:
```json
{
  "severity": "critical",
  "anomalyType": "liveness",
  "correlations": [
"CPU 0% drop detected",
"Start TxPool monotonically increasing (batch unprocessed)"
  ],
"predictedImpact": "Op-geth is down, so all transaction processing is halted. User traffic impacted.",
  "suggestedActions": [
"Restart op-geth process",
"Check memory/disk space",
“Review recent logs”
  ],
  "relatedComponents": [
    "op-geth",
    "op-node",
    "op-batcher"
  ]
}
```

### Performance optimization

**Caching**:
```typescript
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;  // 5분

// Do not reanalyze the same anomaly within 5 minutes
```

**Rate Limiting**:
```typescript
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;  // 1분

// AI call up to 1 time per minute
```

---

## 📢 Layer 3: Sending notifications

### Notification filtering

**condition**:
1. AI analysis severity >= set threshold
2. Cooldown elapsed since last notification

**Settings**:
```typescript
interface AlertConfig {
enabled: boolean;                    // Whether to enable notifications
  webhookUrl?: string;                 // Slack/Discord URL
  thresholds: {
notifyOn: AISeverity[];            // Notification target severity (low/medium/high/critical)
cooldownMinutes: number;           // Prevent duplicate notifications (minutes)
  };
}
```

**Default**:
```typescript
notifyOn: ['high', 'critical'] // Notify only when high or higher
cooldownMinutes: 10                   // 10분 cooldown
```

### Notification Channel

| Channel | Use | Settings |
|------|------|------|
| **Slack** | Operation Team Notification | `ALERT_WEBHOOK_URL` |
| **Webhook** | External system integration | Custom URL |
| **Dashboard** | Show dashboard | automatic recording |

---

## 📊 Entire pipeline

```
Metric collection (1 minute interval)
    ↓
Layer 1: Statistical detection (on the fly)
├─ Z-Score test
├─ CPU 0% Drop check
├─ Block plateau inspection
├─ TxPool Monotonic Check
    ↓
[Anomaly detected?]
    │
├─ YES → Layer 2: AI analysis (only once per minute)
│ ├─ Root cause analysis
│ ├─ Severity assessment
│ └─ Provide recommended actions
    │            ↓
│ Layer 3: Sending notifications (based on settings)
│ └─ Severity >= threshold and cooldown elapses
    │
└─ NO → Normal (continue monitoring)
```

---

## 🧪 Test example

### Quick Test: Z-Score detection

```bash
# 1. Create Mock Data (Rising Trend)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 2. Check for abnormalities
curl -s "http://localhost:3002/api/metrics" | jq '.anomalies'

# Expected results:
# [
#   {
#     "isAnomaly": true,
#     "metric": "cpuUsage",
#     "direction": "spike",
#     "zScore": 3.2,
#     "rule": "z-score"
#   }
# ]
```

### Deep Test: AI Analytics

```bash
# 1. Abnormal event inquiry
curl -s "http://localhost:3002/api/anomalies" | jq '.events[0]'

# 2. Check Layer 2 AI analytics
curl -s "http://localhost:3002/api/anomalies" | jq '.events[0].deepAnalysis'

# Expected results:
# {
#   "severity": "high",
#   "anomalyType": "performance",
# "correlations": ["CPU spikes persist"],
# "predictedImpact": "Possible block creation delay",
#   "suggestedActions": ["..."],
#   "relatedComponents": ["op-geth", "op-node"]
# }
```

---

## ⚙️ Customize settings

### Environment variables

```bash
# Can be set in .env.local

# Adjust Z-Score threshold (default 2.5)
# Fix Z_SCORE_THRESHOLD in anomaly-detector.ts

# Block Plateau Time (default 120 seconds)
# BLOCK_PLATEAU_SECONDS = 120

# TxPool Monotonic time (default 300 seconds)
# TXPOOL_MONOTONIC_SECONDS = 300

# Notification settings
# Can be configured in /api/anomalies/config
```

### Change notification settings with API

```bash
curl -X PUT "http://localhost:3002/api/anomalies/config" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "thresholds": {
      "notifyOn": ["high", "critical"],
      "cooldownMinutes": 10
    }
  }'
```

---

## 📈 Reference values ​​for each metric

### CPU Usage

| status | CPU% | Description |
|------|-------|------|
| summit | 20~40 | Typical L2 node |
| load | 40~70 | high traffic |
| danger | 70~99 | Impending Overload |
| crash | 0~1 | process abort |

### Block Interval

| status | spacing | Description |
|------|------|------|
| summit | 2~4 seconds | Optimism standard |
| slow | 4~10 seconds | network delay |
| very slow | 10~60 seconds | serious congestion |
| stop | 60 seconds+ | Sequencer stop |

### TxPool Pending

| status | count | Description |
|------|------|------|
| summit | 0~1000 | Normal load |
| High | 1000~10000 | Batcher delay |
| very high | 10000+ | Batcher failure |

---

## 🔗 Related files

| file | Role |
|------|------|
| `src/lib/anomaly-detector.ts` | Layer 1 statistical detection |
| `src/lib/anomaly-ai-analyzer.ts` | Layer 2 AI analysis |
| `src/lib/alert-dispatcher.ts` | Layer 3 notification sending |
| `src/types/anomaly.ts` | type definition |
| `src/app/api/anomalies/route.ts` | API endpoint |

---

## 📚 Additional Resources

- [Anomaly Detection Proposal](./done/proposal-2-anomaly-detection.md)
- [RCA Engine Guide](./done/proposal-3-rca-engine.md)
- [Alert Configuration API](../app/api/anomalies/config/route.ts)
