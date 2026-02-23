# SentinAI Architecture

System architecture and component interactions for autonomous L2/Rollup operations.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SentinAI Dashboard                        │
│                      (Next.js 16 / React)                        │
└───────────────┬─────────────────────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
    ┌───────────────────────┐         ┌──────────────────────┐
    │  Telemetry Collector  │         │   API Gateway        │
    │  - L2 RPC Polling     │         │   - REST endpoints   │
    │  - K8s Metrics        │         │   - MCP Server       │
    │  - Component Logs     │         │   - Authentication   │
    └───────────┬───────────┘         └──────────┬───────────┘
                │                                │
                ▼                                ▼
    ┌─────────────────────────────────────────────────────────┐
    │              Core Processing Engine                      │
    ├─────────────────────────────────────────────────────────┤
    │  • Anomaly Detection (Z-score, AI analysis)             │
    │  • Root Cause Analysis (Claude Haiku 4.5)               │
    │  • Predictive Scaling (Time-series forecasting)         │
    │  • Action Planning (Policy-based decision trees)        │
    │  • Execution Engine (K8s API, safe rollback)            │
    └───────────┬─────────────────────────────────────────────┘
                │
                ▼
    ┌───────────────────────────────────────────────────────┐
    │                  State Management                      │
    │  • In-Memory Ring Buffer (60 data points)             │
    │  • Redis (optional, multi-instance state sync)        │
    │  • Audit Trail (decision history, action logs)        │
    └───────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Telemetry Collector

**Responsibilities:**
- Poll L2 RPC for block height, gas usage, transaction pool metrics
- Query AWS EKS for CPU, memory, pod status via K8s API
- Aggregate component logs (op-geth, op-node, op-batcher, op-proposer)

**Data Flow:**
```
L2 RPC → Metrics API → In-Memory Buffer (60 points, 5-min window)
                    ↓
                Time-series analysis (anomaly detection input)
```

**Key Metrics:**
- `blockHeight`: Current L2 block number
- `cpuUsage`: Percentage (0-100)
- `txPoolCount`: Pending transaction count
- `gasUsedRatio`: Gas consumption rate
- `blockInterval`: Time between blocks (ms)

---

### 2. Anomaly Detection Engine

**Algorithm:**
- **Z-score calculation** on windowed metrics (mean, stddev)
- **Threshold**: |z-score| > 2.0 triggers alert
- **AI enhancement**: Claude Haiku 4.5 analyzes log context for cross-component patterns

**Detection Flow:**
```
Metric Stream → Statistical Analysis → Z-score > 2.0?
                                            ↓ Yes
                                      AI Log Analysis
                                            ↓
                                    Anomaly Event Created
                                            ↓
                                    RCA Engine Triggered
```

**Output:**
```json
{
  "metric": "cpuUsage",
  "value": 87.3,
  "zScore": 3.2,
  "direction": "up",
  "severity": "medium",
  "description": "CPU spike detected: 87.3% (3.2σ above baseline)"
}
```

---

### 3. Root Cause Analysis (RCA) Engine

**Model:** Claude Haiku 4.5 (via LiteLLM AI Gateway)

**Input Context:**
- Recent anomaly metrics
- Component logs (last 50 lines each: op-geth, op-node, op-batcher, op-proposer)
- Historical incident patterns

**Prompt Strategy:**
```
You are a Senior Protocol Engineer analyzing Optimism Rollup health.

Metrics: [anomaly summary]
Logs: [aggregated component logs]

Diagnose the root cause and provide:
1. Probable cause (1-2 sentences)
2. Affected components
3. Risk level (low/medium/high/critical)
4. Recommended action plan
```

**Output:**
```json
{
  "rootCause": "Derivation lag: op-node falling behind L1",
  "affectedComponents": ["op-node", "op-batcher"],
  "riskLevel": "high",
  "actionPlan": "Increase op-node CPU allocation; verify L1 RPC health"
}
```

---

### 4. Predictive Scaling Engine

**Model:** Tier-based AI selection
- **Fast Tier**: qwen3-80b-next (1.8s latency, real-time analysis)
- **Best Tier**: qwen3-235b (11s latency, complex pattern recognition)

**Data Input:**
- In-memory ring buffer (60 data points)
- Statistical summary: min, max, mean, stddev, trend
- Recent 15 data points (granular pattern analysis)

**Prediction Flow:**
```
Time-Series Data → AI Analysis → Predicted vCPU (1/2/4)
                               ↓
                         Confidence Score (0-100)
                               ↓
                         Trend Direction (stable/rising/falling)
                               ↓
                         Key Factors (reasoning)
```

**Output:**
```json
{
  "predictedVCpu": 4,
  "confidence": 85,
  "trend": "rising",
  "keyFactors": ["TxPool growth", "Block interval variance"],
  "reasoning": "Traffic surge pattern detected; recommend scaling to 4 vCPU"
}
```

---

### 5. Action Planning & Execution

**Policy Framework:**

```
Risk Tier       Auto-Execute    Approval Required    Examples
────────────────────────────────────────────────────────────────
Low             ✓               ✗                    Increase CPU 1→2
Medium          ✓               ✗                    Restart component
High            ✗               ✓ (ChatOps)          Downscale 4→1
Critical        ✗               ✓ (Multi-approval)   DB migration
```

**Execution Safety:**
- **Cooldown**: 5-minute window after any scaling action
- **Simulation Mode**: Default dry-run; requires explicit `SCALING_SIMULATION_MODE=false`
- **Rollback**: Automatic rollback on health check failure within 2 minutes
- **Audit Trail**: Every action logged with timestamp, decision reasoning, outcome

**K8s Deployment Update:**
```typescript
await k8s.apps.v1.patchNamespacedDeployment(
  'op-geth',
  'default',
  {
    spec: {
      template: {
        spec: {
          containers: [{ resources: { requests: { cpu: '4000m' } } }]
        }
      }
    }
  }
);
```

---

### 6. MCP Integration Layer

**MCP Server:** Model Context Protocol for external AI agents (Claude Desktop, Claude Code)

**Exposed Tools:**
- `sentinai.getMetrics`: Current system metrics + anomaly status
- `sentinai.getRca`: Latest root cause analysis
- `sentinai.getPrediction`: Predictive scaling forecast
- `sentinai.executeAction`: Execute approved action (policy-gated)
- `sentinai.getAuditTrail`: Decision history and action logs

**Authentication:**
- API key via `x-api-key` header
- Configurable via `SENTINAI_API_KEY` environment variable

**Example Invocation (Claude Desktop):**
```json
{
  "tool": "sentinai.getMetrics",
  "arguments": {
    "includeAnomalies": true
  }
}
```

---

## Data Flow: Incident to Resolution

```
1. Metric Anomaly Detected (cpuUsage spike)
         ↓
2. RCA Engine Analyzes Logs
         ↓
3. Action Plan Generated ("Increase CPU to 4 vCPU")
         ↓
4. Policy Check (Low risk → auto-execute)
         ↓
5. K8s API Call (patch deployment)
         ↓
6. Verification Poll (2-minute health window)
         ↓
7. Outcome Logged (success/rollback)
         ↓
8. Cooldown Period (5 minutes, no further scaling)
```

---

## Deployment Architecture

### Local Development
```
Docker Compose
├── sentinai (Next.js app, port 3002)
├── redis (optional state store, port 6379)
└── Local L2 RPC (optional, port 8545)
```

### Production (AWS EKS)
```
AWS EKS Cluster
├── sentinai Deployment (2 replicas, autoscaling)
├── Redis StatefulSet (persistence enabled)
├── L2 RPC Connection (external, load-balanced)
└── IAM Role (EKS read/write permissions)
```

**Network:**
- Public: Dashboard UI (behind CloudFront/CDN)
- Internal: K8s API, Redis, internal metrics endpoints

---

## Security Model

### Authentication Layers
1. **API Key**: Required for write operations (`SENTINAI_API_KEY`)
2. **Read-Only Mode**: Optional lockdown via `SENTINAI_READ_ONLY_MODE=true`
3. **AWS IAM**: EKS cluster access via IAM roles (least privilege)

### Forbidden Actions (Hard-coded Blacklist)
- Database DROP/DELETE statements
- Service account deletion
- Namespace-wide resource deletion
- Manual pod exec/debug without approval

### Audit Controls
- All actions logged with: timestamp, user context, decision reasoning, execution outcome
- Logs persist to Redis (if enabled) or in-memory audit trail (last 100 events)
- Export via `/api/agent-decisions` endpoint

---

## Scalability & Performance

### Metrics Collection
- **Polling Interval**: 30 seconds (configurable)
- **Buffer Size**: 60 data points (30 minutes rolling window)
- **Memory Footprint**: ~2MB per buffer (5 metrics × 60 points × 8 bytes)

### AI Model Latency
| Model            | Latency | Use Case                    |
|------------------|---------|-----------------------------|
| qwen3-80b-next   | 1.8s    | Real-time anomaly detection |
| qwen3-235b       | 11s     | Deep pattern analysis       |
| Claude Haiku 4.5 | 3-5s    | RCA log analysis            |

### Horizontal Scaling
- **Stateless**: Dashboard frontend (Next.js)
- **Stateful**: Redis for multi-instance state sync
- **Read Replicas**: Multiple dashboard instances can poll same Redis

---

## Monitoring & Observability

### Health Endpoints
- `/api/health`: System status (L2 connected, K8s accessible)
- `/api/metrics`: Current metrics + anomaly status
- `/api/agent-decisions`: Recent decision history

### Dashboards
- **Main Dashboard**: Real-time metrics, anomaly alerts, action history
- **v2 Dashboard**: Advanced analytics, cost tracking, predictive charts

### Logging
- **Structured Logs**: JSON format via console (Next.js middleware)
- **Log Levels**: debug, info, warn, error
- **Aggregation**: Compatible with CloudWatch Logs, Datadog, Sentry

---

## Future Architecture Enhancements

### Planned (Q1 2026)
- Multi-cluster support (manage multiple L2 networks from one dashboard)
- Prometheus metrics export (Grafana integration)
- Webhook notifications (Slack, Discord, PagerDuty)

### Researching (Q2 2026)
- Self-healing feedback loop (auto-tune anomaly thresholds based on false positive rate)
- Cost optimization engine (recommend cheaper instance types based on usage patterns)
- Multi-model ensemble (combine predictions from multiple AI models for higher confidence)

---

For implementation details, see:
- [API Reference](api-reference.md)
- [MCP User Guide](sentinai-mcp-user-guide.md)
- [Testing Guide](../verification/testing-guide.md)
