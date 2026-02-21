# RCA Engine (Root Cause Analysis) Guide

## 📋 Overview

RCA Engine is an AI-based analysis system that **tracks the root cause after detecting anomalies** and **suggests solutions**.

**File**: `src/lib/rca-engine.ts`

### 3-step analysis process

```
1️⃣ Timeline composition
├─ Log parsing
├─ Ideal Metric Conversion
└─ Sort by time

2️⃣ AI causality analysis
├─ Utilize component dependency graph
├─ Chain failure tracking
└─ Severity assessment

3️⃣ Provide recommended actions
├─ Immediate action (Immediate)
└─ Preventive measures
```

---

## 🏗️ Optimism Rollup Architecture

### Component relationship diagram

```
                    ┌─────────────────┐
                    │   L1 (Ethereum) │
                    │   or Sepolia    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   op-node        │
                    │ (Derivation      │
                    │  Driver)         │
                    └────┬─────────────┘
                    ┌────┴─────┬──────────────┐
                    ▼          ▼              ▼
            ┌──────────────┐ ┌────────────┐ ┌──────────────┐
            │  op-geth     │ │ op-batcher │ │ op-proposer  │
            │  (Execution) │ │ (Batches)  │ │ (State Root) │
            └──────────────┘ └────────────┘ └──────────────┘
                    │
                    └─────→ L1 (Submit batches & roots)
```

### Role of each component

| component | Role | Dependency | Scope of influence |
|---------|------|--------|---------|
| **L1** | External Chain (Ethereum/Sepolia) | None | All components |
| **op-node** | Receive L1 data → derive L2 state | L1 | All subcomponents |
| **op-geth** | L2 block execution (transaction processing) | op-node | transaction processing |
| **op-batcher** | Submit L2 Transaction Batch (L1) | op-node, L1 | transaction compression |
| **op-proposer** | Submitted by Sang Geun Sang for L2 (L1) | op-node, L1 | Withdrawal |

### Dependency graph

```typescript
const DEPENDENCY_GRAPH = {
  'l1': {
    dependsOn: [],
    feeds: ['op-node', 'op-batcher', 'op-proposer'],
  },
  'op-node': {
    dependsOn: ['l1'],
    feeds: ['op-geth', 'op-batcher', 'op-proposer'],
  },
  'op-geth': {
    dependsOn: ['op-node'],
    feeds: [],
  },
  'op-batcher': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-proposer': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
};
```

**Important**: If an op-node fails, all child components are affected!

---

## 📊 Timeline configuration

### Data Source

Timeline collects events from three sources:

#### 1. Log parsing (Log Events)

```typescript
function parseLogsToEvents(logs: Record<string, string>): RCAEvent[]
```

**Supported Formats**:
- ISO 8601: `2024-12-09T14:30:45.123Z`
- Geth format: `[12-09|14:30:45.123]`
- General format: `2024-12-09 14:30:45`

**Extraction Conditions**:
- ERROR, ERR, FATAL level → type: `error`
- WARN, WARNING level → type: `warning`

**example**:
```
[12-09|14:30:45.123] ERROR [execution] block derivation failed: context deadline exceeded

→ {
  timestamp: 1733761845123,
component: 'op-geth', # automatic mapping
  type: 'error',
  description: 'block derivation failed: context deadline exceeded',
  severity: 'high'
}
```

#### 2. Anomalous metric conversion (Anomaly Events)

```typescript
function anomaliesToEvents(anomalies: AnomalyResult[]): RCAEvent[]
```

**Metric → Component Mapping**:

| metrics | component | Cause |
|--------|---------|------|
| `cpuUsage` | op-geth | CPU spikes/load |
| `txPoolPending` | op-geth | Transaction Accumulation |
| `gasUsedRatio` | op-geth | block saturation |
| `l2BlockHeight`, `l2BlockInterval` | op-node | Block creation stagnation |

**example**:
```
Anomaly: CPU spike (Z-Score: 3.2)

→ {
  timestamp: 1733761900000,
  component: 'op-geth',
  type: 'metric_anomaly',
  description: 'CPU usage spike: 30% → 65%',
severity: 'high' # |Z| Since > 2.5
}
```

#### 3. Sort chronologically

```typescript
function buildTimeline(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  minutes: number = 5
): RCAEvent[]
```

**movement**:
1. Combine log + anomaly metrics
2. Filter only the last 5 minutes of data
3. Sort by timestamp

**result**:
```json
[
  {
    "time": "2024-12-09T14:28:00Z",
    "component": "op-node",
    "type": "error",
    "description": "L1 reorg detected"
  },
  {
    "time": "2024-12-09T14:28:30Z",
    "component": "op-geth",
    "type": "warning",
    "description": "Derivation stalled"
  },
  {
    "time": "2024-12-09T14:29:00Z",
    "component": "op-geth",
    "type": "metric_anomaly",
    "description": "TxPool: 1000 → 5000 (monotonic increase)"
  }
]
```

---

## 🧠 AI-based causal analysis

### System Prompt Structure

RCA Engine provides **clear instructions from an SRE perspective** to Claude:

```
1. Component Architecture (detailed description of 5 components)
2. Dependency Graph
3. Common Failure Patterns (5 typical failure patterns)
4. Analysis Guidelines (Analysis Methodology)
```

### 5 typical failure patterns

#### 1️⃣ L1 Reorg (L1 chain reorganization)

**Cause**: Chain reorganization occurs in L1
```
┌─────────────────────────────────┐
│ L1 Reorg                        │
└────────────┬────────────────────┘
             │
             ▼
┌────────────────────────────────┐
│ op-node Derivation Reset       │
│ (Initialization of inductive state) │
└────────────┬────────────────────┘
             │
             ▼
┌────────────────────────────────┐
│ L2 Block Generation Stall      │
│ (Pause block creation) │
└────────────────────────────────┘
```

**Symptoms**:
- Block height plateau 2 minutes or more
- Temporarily stop synchronization

---

#### 2️⃣ L1 Gas Spike

**Cause**: L1 network congestion
```
┌──────────────────────────┐
│ L1 Gas Price Surge       │
│ (Gas costs rise rapidly) │
└─────────┬────────────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
Batcher    Proposer
Failed    Failed
│         │
└────┬────┘
     ▼
TxPool
Accumulation
```

**Symptoms**:
- op-batcher: batch submission failed
- TxPool: monotonic increase (over 5 minutes)
- 로그: "transaction underpriced" 또는 "replacement transaction underpriced"

---

#### 3️⃣ op-geth Crash

**Cause**: Op-geth process crash (OOM, signal, etc.)
```
┌──────────────────┐
│ op-geth Crash    │
│ (End process) │
└────────┬─────────┘
         │
         ▼
CPU: 100% → 0%
Memory: Peak → 0
Port: Open → Closed
```

**Symptoms**:
- CPU suddenly drops to 0% (Zero-drop detection)
- Stop processing all transactions
- 로그: "connection refused", "unexpected EOF"

---

#### 4️⃣ Network Partition (P2P network disconnection)

**Cause**: P2P communication disconnection between nodes
```
┌──────────────────────────┐
│ Network Partition        │
│ (P2P Gossip disconnection) │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ op-node Peer Loss        │
│ (Loss of peer node connectivity) │
└────────┬─────────────────┘
         │
         ▼
Unsafe Head Divergence
(Safe Head Radiation)
```

**Symptoms**:
- on-node: "peer disconnected" 로그
- Block interval: increase
- Unsafe head: different from expected value

---

#### 5️⃣ Sequencer Stall (Sequencer 정지)

**Cause**: Problem with the Sequencer node itself
```
┌──────────────────────┐
│ Sequencer Stall      │
│ (Stop block generation) │
└──────────┬───────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Block Height   TxPool
Plateau        Growth
(2 minutes+) (5 minutes+)
```

**Symptoms**:
- Block height: no change
- TxPool: continues to increase
- Log: timeout such as "context deadline exceeded"

---

### AI analysis result format

The JSON returned by Claude:

```json
{
  "rootCause": {
    "component": "op-node" | "op-geth" | "op-batcher" | "op-proposer" | "l1" | "system",
"description": "Clear root cause description",
    "confidence": 0.0 - 1.0
  },
  "causalChain": [
    {
      "timestamp": 1733761800000,
      "component": "op-node",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
"description": "What happened in this step"
    }
  ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}
```

### Confidence score

| Reliability | Meaning | Situation |
|--------|------|------|
| **0.9~1.0** | very high | clear log + ideal metric matching |
| **0.7~0.9** | High | Only one of the logs or metrics is clear |
| **0.5~0.7** | middle | Several possibilities |
| **0.3~0.5** | low | AI call failure → Fallback |
| **< 0.3** | very low | Lack of data |

---

## 🔀 Dependency tracking

### Upstream dependency lookup

```typescript
findUpstreamComponents(component: RCAComponent): RCAComponent[]
```

**yes**:
```
Upstream dependencies of op-geth:
  op-geth → op-node → l1

Upstream dependencies of op-batcher:
  op-batcher → [op-node, l1]
```

### Track downstream impacts

```typescript
findAffectedComponents(rootComponent: RCAComponent): RCAComponent[]
```

**yes**:
```
Components affected when op-node fails:
  op-node fails
├─ op-geth impact (op-geth requires op-node)
├─ op-batcher impact
└─ op-proposer influence

Components affected when op-geth fails:
  op-geth fails
└─ (None - op-geth does not supply any other components)
```

---

## 🛠️ Fallback analysis (AI call failure)

Automatically perform rule-based analysis when AI calls fail.

### Fallback logic

```typescript
function generateFallbackAnalysis(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  lastError?: string
): RCAResult
```

**movement**:
1. Find the first ERROR event in the Timeline
2. List all components affected by that component
3. Provide basic recommended actions

**Confidence**: 0.3 (low - manual verification recommended)

**Recommended Action for Return**:
```json
{
  "immediate": [
    "Check component logs for detailed error messages",
    "Verify all pods are running: kubectl get pods -n <namespace>",
    "Check L1 connectivity and block sync status"
  ],
  "preventive": [
    "Set up automated alerting for critical metrics",
    "Implement health check endpoints for all components",
    "Document incident response procedures"
  ]
}
```

---

## 📝 Log parsing details

### Supported log formats

#### ISO 8601 format
```
2024-12-09T14:30:45.123Z ERROR [op-geth] failed to execute block
→ timestamp: 1733761845123
```

#### Geth Format
```
[12-09|14:30:45.123] op-geth ERROR block execution timeout
→ timestamp: Year-December-09 14:30:45.123
```

#### General format
```
2024-12-09 14:30:45 ERROR op-node derivation failed
→ timestamp: 14:30:45 on the date
```

### Component name normalization

```typescript
const COMPONENT_NAME_MAP = {
  'op-geth': 'op-geth',
  'geth': 'op-geth',
  'op-node': 'op-node',
  'node': 'op-node',
  'op-batcher': 'op-batcher',
  'batcher': 'op-batcher',
  'op-proposer': 'op-proposer',
  'proposer': 'op-proposer',
};
```

### Log level extraction

```typescript
const LOG_LEVEL_MAP = {
'ERROR', 'ERR', 'FATAL' → type: 'error'   (심각도: high)
'WARN', 'WARNING'       → type: 'warning' (심각도: medium)
};
```

---

## 📊 Execution example

### Step 1: Configure Timeline

```bash
Timeline Events (within 5 minutes):
[14:28:00] op-node     ERROR  L1 reorg detected
[14:28:30] op-node     WARNING Derivation stalled
[14:29:00] op-geth     METRIC  TxPool: 1000 → 5000
[14:29:30] op-geth     ERROR   Connection refused
[14:30:00] op-batcher  ERROR   Batch submission failed
```

### Step 2: AI Analysis

**Prompt to be sent**:
```
System: [RCA_SYSTEM_PROMPT includes architecture, patterns, etc.]

User:
== Event Timeline ==
[timeline JSON]

== Detected Anomalies ==
- txPoolPending: 5000 (z-score: 3.1, spike)

== Recent Metrics ==
[Metric Snapshot]

== Component Logs ==
[Log contents]

Analyze the above data and identify the root cause.
```

**Claude responds**:
```json
{
  "rootCause": {
    "component": "op-node",
"description": "Chain reorganization occurs in L1, which resets the induced state of the op-node. This causes op-geth execution to be delayed and transactions to accumulate in the TxPool.",
    "confidence": 0.85
  },
  "causalChain": [
    {
      "timestamp": 1733761680000,
      "component": "l1",
      "type": "error",
      "description": "L1 reorg detected"
    },
    {
      "timestamp": 1733761710000,
      "component": "op-node",
      "type": "error",
      "description": "Derivation reset due to L1 reorg"
    },
    {
      "timestamp": 1733761740000,
      "component": "op-geth",
      "type": "metric_anomaly",
      "description": "TxPool accumulation (1000 → 5000)"
    }
  ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "remediation": {
    "immediate": [
      "Monitor L1 finality status",
      "Check op-node derivation progress",
      "Verify op-geth is catching up with pending transactions"
    ],
    "preventive": [
      "Increase watchdog timeout thresholds during L1 finality uncertainty",
      "Implement automated derivation state validation",
      "Set up alerts for L1 reorg patterns"
    ]
  }
}
```

### Step 3: Save results

```typescript
{
  "id": "rca-1733761845-abc123",
  "rootCause": { ... },
  "causalChain": [ ... ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "timeline": [ ... ],
  "remediation": { ... },
  "generatedAt": "2024-12-09T14:30:45.678Z"
}
```

---

## 📞 API usage

### RCA Analysis Request

```bash
curl -X POST "http://localhost:3002/api/rca" \
  -H "Content-Type: application/json" \
  -d '{
    "autoTriggered": false
  }'
```

**response**:
```json
{
  "success": true,
  "result": {
    "id": "rca-1733761845-abc123",
    "rootCause": { ... },
    "causalChain": [ ... ],
    "affectedComponents": ["op-geth", "op-batcher"],
    "timeline": [ ... ],
    "remediation": {
      "immediate": [ ... ],
      "preventive": [ ... ]
    },
    "generatedAt": "2024-12-09T14:30:45.678Z"
  }
}
```

### RCA history search

```bash
# Recent 10 RCA analysis results
curl -s "http://localhost:3002/api/rca?limit=10" | jq '.history'

# Specific RCA analysis results
curl -s "http://localhost:3002/api/rca/rca-1733761845-abc123" | jq '.result'
```

---

## ⚙️ Performance optimization

### Settings

```typescript
/** Maximum number of history items */
const MAX_HISTORY_SIZE = 20;

/** AI call timeout */
const AI_TIMEOUT = 30000;  // 30 seconds

/** Number of retries */
const MAX_RETRIES = 2;

/** Retry wait time */
retry_delay = 1000 * (attempt + 1);  // exponential backoff
```

### Timeline period

```typescript
/** By default, only the most recent 5 minutes of data is analyzed */
buildTimeline(anomalies, logs, minutes = 5)
```

---

## 🔍 Fallback trigger condition

If RCA analysis fails:

1. AI call failure (network error, timeout)
2. JSON parsing failure
3. AI response is not in expected format

**At this time, it automatically switches to rule-based analysis and the confidence level is displayed as 0.3.**

---

## 📚 Related files

| file | Role |
|------|------|
| `src/lib/rca-engine.ts` | Main RCA Engine |
| `src/types/rca.ts` | type definition |
| `src/app/api/rca/route.ts` | API endpoint |
| `src/lib/anomaly-detector.ts` | Layer 1 abnormality detection |
| `src/lib/ai-client.ts` | AI 호출 (Claude) |

---

## 🎯 Summary of Key Features

✅ **Component-centric Analysis**: Based on Optimism architecture
✅ **Causal Chain Tracing**: Tracing from root cause to final symptom
✅ **Dependency Graph**: Automatic calculation of component dependencies
✅ **AI-Powered**: Claude-based semantic analysis
✅ **Fallback Support**: Rule-based analysis when AI fails
✅ **Actionable Advice**: Provides immediate action + preventive action
✅ **History Management**: Save the last 20 analysis results
