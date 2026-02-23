# API Reference

Complete reference for SentinAI REST API and MCP endpoints.

---

## Base URL

**Local Development:**
```
http://localhost:3002
```

**Production:**
```
https://your-sentinai-instance.com
```

---

## Authentication

### API Key (Optional)

When `SENTINAI_API_KEY` is configured, all write operations require authentication:

```bash
curl -X POST https://sentinai.example.com/api/scaler \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"action": "scale", "targetVCpu": 4}'
```

**Protected Operations:**
- POST, PUT, PATCH, DELETE requests
- Exempt: `/api/health`, `/api/agent-loop`, `/api/metrics/seed`

---

## Core Endpoints

### GET /api/health

System health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-23T07:00:00.000Z",
  "l2Connected": true,
  "k8sConnected": true
}
```

**Status Codes:**
- `200`: All systems operational
- `503`: L2 or K8s connection failed

---

### GET /api/metrics

Current system metrics and anomaly status.

**Query Parameters:**
- `includeHistory` (optional): Include time-series data (default: false)

**Response:**
```json
{
  "metrics": {
    "blockHeight": 12345678,
    "cpuUsage": 45.3,
    "txPoolCount": 23,
    "gasUsedRatio": 0.78,
    "blockInterval": 2000
  },
  "anomalies": [
    {
      "metric": "cpuUsage",
      "value": 87.3,
      "zScore": 3.2,
      "direction": "up",
      "severity": "medium",
      "description": "CPU spike detected"
    }
  ],
  "components": [
    { "name": "op-geth", "status": "healthy", "cpu": 45.3 },
    { "name": "op-node", "status": "healthy", "cpu": 12.1 }
  ],
  "cost": {
    "opGethMonthlyCost": 73.44,
    "currentVCpu": 2
  }
}
```

---

### POST /api/metrics/seed

Inject test scenario data (development/demo only).

**Body:**
```json
{
  "scenario": "spike",  // "stable" | "spike" | "rising" | "falling"
  "dataPoints": 20
}
```

**Response:**
```json
{
  "status": "success",
  "injected": 20,
  "scenario": "spike"
}
```

---

### GET /api/anomalies

Fetch recent anomaly events.

**Query Parameters:**
- `limit` (optional): Max events to return (default: 10)
- `severity` (optional): Filter by severity (low/medium/high/critical)

**Response:**
```json
{
  "anomalies": [
    {
      "id": "evt_abc123",
      "timestamp": "2026-02-23T07:00:00.000Z",
      "metric": "cpuUsage",
      "value": 87.3,
      "zScore": 3.2,
      "severity": "medium",
      "resolved": false
    }
  ],
  "count": 1
}
```

---

### POST /api/rca

Request root cause analysis for current anomaly.

**Body:**
```json
{
  "anomalyEventId": "evt_abc123"  // optional, uses latest if omitted
}
```

**Response:**
```json
{
  "eventId": "evt_abc123",
  "rootCause": "Derivation lag: op-node falling behind L1",
  "affectedComponents": ["op-node", "op-batcher"],
  "riskLevel": "high",
  "actionPlan": "Increase op-node CPU allocation; verify L1 RPC health",
  "confidence": 85,
  "analyzedAt": "2026-02-23T07:01:23.000Z"
}
```

---

### POST /api/scaler

Execute scaling action (manual or policy-driven).

**Body:**
```json
{
  "action": "scale",
  "targetVCpu": 4,
  "reason": "Manual scaling for load test"  // optional
}
```

**Response (Simulation Mode):**
```json
{
  "status": "simulated",
  "decision": {
    "action": "scale",
    "targetVCpu": 4,
    "currentVCpu": 2,
    "reason": "Manual scaling for load test"
  },
  "message": "Scaling action logged (simulation mode active)"
}
```

**Response (Live Mode):**
```json
{
  "status": "success",
  "decision": {
    "action": "scale",
    "targetVCpu": 4,
    "currentVCpu": 2,
    "executedAt": "2026-02-23T07:05:00.000Z"
  },
  "verificationStatus": "healthy",
  "cooldownUntil": "2026-02-23T07:10:00.000Z"
}
```

**Status Codes:**
- `200`: Action executed successfully
- `403`: Read-only mode enabled or in cooldown period
- `400`: Invalid parameters

---

### GET /api/agent-decisions

Audit trail of recent scaling decisions.

**Query Parameters:**
- `limit` (optional): Max decisions to return (default: 20)

**Response:**
```json
{
  "decisions": [
    {
      "id": "dec_xyz789",
      "timestamp": "2026-02-23T07:05:00.000Z",
      "action": "scale",
      "targetVCpu": 4,
      "previousVCpu": 2,
      "reason": "Anomaly-driven scaling (cpuUsage spike)",
      "outcome": "success",
      "verificationStatus": "healthy"
    }
  ],
  "count": 1
}
```

---

### POST /api/nlops

Natural language operations chat interface.

**Body:**
```json
{
  "message": "What's the current CPU usage?",
  "conversationId": "conv_abc123"  // optional, for multi-turn context
}
```

**Response:**
```json
{
  "reply": "Current CPU usage is 45.3% (2 vCPU allocated).",
  "conversationId": "conv_abc123",
  "actions": [],  // any tool calls executed
  "timestamp": "2026-02-23T07:10:00.000Z"
}
```

---

### GET /api/cost-report

Cost analysis and optimization recommendations.

**Response:**
```json
{
  "current": {
    "vCpu": 2,
    "monthlyCost": 73.44,
    "currency": "USD"
  },
  "optimizations": [
    {
      "recommendation": "Reduce to 1 vCPU during low-traffic periods",
      "potentialSavings": 36.72,
      "confidence": 85
    }
  ]
}
```

---

### GET /api/goals

Goal manager status (autonomous agent goals).

**Response:**
```json
{
  "activeGoals": [
    {
      "id": "goal_123",
      "description": "Maintain CPU < 80% during peak hours",
      "status": "active",
      "progress": 75,
      "createdAt": "2026-02-23T00:00:00.000Z"
    }
  ],
  "completedCount": 12,
  "failedCount": 2
}
```

---

### POST /api/goals

Create new autonomous goal.

**Body:**
```json
{
  "description": "Reduce transaction pool backlog to < 10",
  "priority": "high",
  "deadline": "2026-02-24T00:00:00.000Z"  // optional
}
```

**Response:**
```json
{
  "goalId": "goal_124",
  "status": "created",
  "estimatedCompletion": "2026-02-23T12:00:00.000Z"
}
```

---

### POST /api/remediation

Trigger auto-remediation for known issue patterns.

**Body:**
```json
{
  "issueType": "sync-stall",  // "sync-stall" | "high-cpu" | "txpool-backlog"
  "autoApprove": false  // require approval for high-risk actions
}
```

**Response:**
```json
{
  "remediationId": "rem_abc123",
  "steps": [
    "Restart op-node component",
    "Verify sync status recovery"
  ],
  "status": "pending-approval",
  "estimatedDuration": "5 minutes"
}
```

---

## MCP Endpoints

MCP (Model Context Protocol) server for AI agent integration.

### Base URL
```
http://localhost:3002/api/mcp
```

### Available Tools

#### sentinai.getMetrics
Get current system metrics and anomaly status.

**Arguments:**
```json
{
  "includeAnomalies": true,
  "includeHistory": false
}
```

**Returns:**
Same as `GET /api/metrics`

---

#### sentinai.getRca
Get root cause analysis for latest anomaly.

**Arguments:**
```json
{
  "anomalyEventId": "evt_abc123"  // optional
}
```

**Returns:**
Same as `POST /api/rca`

---

#### sentinai.getPrediction
Get predictive scaling forecast.

**Arguments:**
```json
{
  "horizonMinutes": 5
}
```

**Returns:**
```json
{
  "predictedVCpu": 4,
  "confidence": 85,
  "trend": "rising",
  "keyFactors": ["TxPool growth", "Block interval variance"]
}
```

---

#### sentinai.executeAction
Execute approved scaling action.

**Arguments:**
```json
{
  "action": "scale",
  "targetVCpu": 4,
  "reason": "AI agent recommendation"
}
```

**Returns:**
Same as `POST /api/scaler`

---

#### sentinai.getAuditTrail
Fetch decision history.

**Arguments:**
```json
{
  "limit": 20
}
```

**Returns:**
Same as `GET /api/agent-decisions`

---

## WebSocket API (Future)

**Planned for Q1 2026:**

Real-time metric streaming via WebSocket.

```javascript
const ws = new WebSocket('wss://sentinai.example.com/api/stream');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Metric update:', data);
};

// Expected payload:
{
  "type": "metric",
  "metric": "cpuUsage",
  "value": 45.3,
  "timestamp": "2026-02-23T07:00:00.000Z"
}
```

---

## Rate Limits

**Current:** No enforced rate limits

**Recommended Client Behavior:**
- Metrics polling: Max 1 req/30 seconds
- Action execution: Max 1 req/5 minutes (respect cooldown)
- RCA requests: Max 1 req/minute

---

## Error Responses

### Standard Error Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}  // optional context
}
```

### Common Error Codes

| Status | Code                  | Description                          |
|--------|-----------------------|--------------------------------------|
| 400    | INVALID_PARAMETERS    | Missing or invalid request params    |
| 401    | UNAUTHORIZED          | Missing or invalid API key           |
| 403    | FORBIDDEN             | Read-only mode or cooldown active    |
| 404    | NOT_FOUND             | Resource not found                   |
| 429    | RATE_LIMIT_EXCEEDED   | Too many requests                    |
| 500    | INTERNAL_ERROR        | Server error                         |
| 503    | SERVICE_UNAVAILABLE   | L2/K8s connection failed             |

---

## Example: Full Incident Workflow

```bash
# 1. Check system health
curl http://localhost:3002/api/health

# 2. Get current metrics
curl http://localhost:3002/api/metrics

# 3. Detect anomaly → trigger RCA
curl -X POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{"anomalyEventId": "evt_abc123"}'

# 4. Get predictive forecast
curl http://localhost:3002/api/agent-decisions

# 5. Execute scaling action
curl -X POST http://localhost:3002/api/scaler \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"action": "scale", "targetVCpu": 4, "reason": "RCA recommendation"}'

# 6. Verify execution
curl http://localhost:3002/api/agent-decisions?limit=1

# 7. Check audit trail
curl http://localhost:3002/api/agent-decisions?limit=10
```

---

For architecture details, see [Architecture Guide](architecture.md).  
For MCP integration, see [MCP User Guide](sentinai-mcp-user-guide.md).
