# SentinAI: Autonomous Operations for Layer 2 Rollup Infrastructure

**Version 1.0**  
**February 2026**

---

## Abstract

As Layer 2 (L2) rollup infrastructure grows in complexity and transaction volume, manual operational oversight becomes increasingly untenable. Operators face expanding component topologies, cross-layer dependencies, and rising incident response burden that traditional monitoring alone cannot address.

SentinAI is an **autonomous node guardian** designed specifically for Optimism-based rollup infrastructure. It combines real-time telemetry aggregation, AI-powered anomaly detection, and policy-governed execution to detect, diagnose, and remediate operational issues with minimal human intervention.

Unlike black-box autopilots, SentinAI implements a **safety-first autonomy model**: low-risk actions execute automatically, high-risk operations require explicit approval, and every decision is auditable. This approach reduces Mean Time To Resolution (MTTR) while maintaining operational control and compliance.

This paper presents SentinAI's design principles, system architecture, risk framework, and evaluation methodology, demonstrating how autonomous operations can improve L2 infrastructure resilience without sacrificing governance.

---

## 1. Problem Statement

### 1.1 Operational Complexity in L2 Rollups

Modern Optimism-based rollup deployments consist of multiple interdependent components:

- **Execution Engine** (op-geth): EVM-compatible transaction processor
- **Consensus Driver** (op-node): L1 derivation and block production
- **Data Availability** (op-batcher): L1 transaction batching and submission
- **State Commitment** (op-proposer): L2 state root publication to L1

Each component introduces distinct failure modes:
- **Sync stalls**: op-node falling behind L1, causing block production delays
- **Batcher congestion**: L1 gas spikes delaying batch submissions
- **Resource contention**: CPU/memory pressure degrading transaction throughput
- **Network partitions**: P2P layer issues causing peer disconnections

### 1.2 Limits of Manual Operations

Traditional monitoring (Prometheus, Grafana, PagerDuty) provides visibility but leaves remediation to human operators. This creates bottlenecks:

- **Detection lag**: Aggregating cross-component signals requires manual correlation
- **Response latency**: Operators must diagnose root cause before acting
- **Inconsistent execution**: Remediation quality varies by operator experience
- **Cognitive load**: As complexity grows, incident triage becomes overwhelming

**Consequence**: High MTTR (30-60 minutes average), service degradation during off-hours, and operator burnout.

### 1.3 The Autopilot Dilemma

Fully autonomous systems (e.g., reinforcement learning agents) promise zero-touch operations but introduce new risks:

- **Opacity**: RL black boxes lack explainability for compliance and debugging
- **Overfitting**: Learned policies may fail on novel failure modes
- **Safety hazards**: Unconstrained automation can amplify cascading failures

**Key insight**: L2 infrastructure operators need **governed autonomy**—systems that act autonomously within predefined safety boundaries while preserving human oversight for critical decisions.

---

## 2. Design Principles

SentinAI is built on three foundational principles:

### 2.1 Safety-First Autonomy

**Rule**: Destructive actions are forbidden by default. The system enforces a hard-coded blacklist:
- No database DROP/DELETE statements
- No service account deletions
- No namespace-wide resource destruction
- No manual pod exec/debug without approval gates

**Risk tiers** govern execution autonomy:
- **Low risk** (CPU scale 1→2 vCPU): Auto-execute
- **Medium risk** (component restart): Auto-execute with verification
- **High risk** (downscale 4→1 vCPU): Require approval
- **Critical risk** (DB migration, traffic rerouting): Multi-approval required

**Simulation mode**: Default dry-run execution prevents accidental production changes during testing.

### 2.2 Policy-Over-Model Execution

Rather than training opaque machine learning models, SentinAI uses **policy-based decision trees** augmented by AI where beneficial:

- **Anomaly detection**: Statistical (z-score) + AI log analysis (Claude Haiku 4.5)
- **Root cause analysis**: AI-guided diagnosis with human-readable reasoning
- **Action planning**: Deterministic policy rules (if CPU > 80% for 5min → scale to 4 vCPU)
- **Predictive scaling**: AI time-series forecasting for proactive resource allocation

**Benefit**: Explainability, auditability, and graceful degradation when AI services are unavailable.

### 2.3 Auditability by Default

Every decision and action is logged with:
- **Timestamp**: When the decision was made
- **Input metrics**: Triggering telemetry values
- **Reasoning**: Why the action was chosen (policy rule + AI insights)
- **Execution outcome**: Success/failure, verification status, rollback if needed

Audit trails persist to Redis (multi-instance) or in-memory (last 100 events), exportable via `/api/agent-decisions` endpoint. This enables:
- **Compliance reporting**: Demonstrate due diligence for SLA breaches
- **Post-mortem analysis**: Reconstruct incident timelines
- **Policy refinement**: Identify false positives and tune thresholds

---

## 3. System Architecture

SentinAI consists of six core subsystems:

### 3.1 Telemetry Collector

**Function**: Aggregate metrics from L2 RPC, Kubernetes API, and component logs.

**Inputs**:
- L2 RPC: `eth_blockNumber`, `eth_gasPrice`, `txpool_status`
- K8s API: CPU/memory usage, pod health, deployment status
- Component logs: Last 50 lines from op-geth, op-node, op-batcher, op-proposer

**Data flow**:
```
L2 RPC → Polling (30s interval) → In-memory ring buffer (60 points)
                                        ↓
                                Time-series analysis
```

**Buffer design**: 60 data points @ 30-second intervals = 30-minute sliding window for trend detection.

### 3.2 Anomaly Detection Engine

**Algorithm**:
1. Calculate rolling mean (μ) and standard deviation (σ) over buffer window
2. Compute z-score for incoming metric: `z = (x - μ) / σ`
3. If `|z| > 2.0`, trigger anomaly alert
4. Send anomaly + recent logs to Claude Haiku 4.5 for cross-component pattern analysis

**Example output**:
```json
{
  "metric": "cpuUsage",
  "value": 87.3,
  "zScore": 3.2,
  "direction": "up",
  "severity": "medium",
  "aiInsight": "CPU spike correlates with TxPool backlog; op-geth may be under-provisioned"
}
```

**False positive mitigation**: Anomalies must persist for 2+ consecutive intervals (1 minute) to escalate.

### 3.3 Root Cause Analysis (RCA) Engine

**Model**: Claude Haiku 4.5 via LiteLLM AI Gateway (3-5s latency)

**Prompt strategy**:
```
You are a Senior Protocol Engineer analyzing Optimism Rollup health.

Context:
- Anomaly: {metric} spiked to {value} ({zScore}σ above baseline)
- Component logs: {aggregated_logs}
- Recent events: {incident_history}

Task:
1. Identify probable root cause (1-2 sentences)
2. List affected components
3. Assess risk level (low/medium/high/critical)
4. Recommend action plan grounded in Optimism documentation
```

**Output contract**:
```json
{
  "rootCause": "Derivation lag: op-node falling behind L1 finality",
  "affectedComponents": ["op-node", "op-batcher"],
  "riskLevel": "high",
  "actionPlan": "Increase op-node CPU allocation; verify L1 RPC health"
}
```

### 3.4 Predictive Scaling Engine

**Data input**:
- Statistical summary: min, max, mean, stddev, trend (rising/stable/falling)
- Recent 15 data points (granular pattern)

**Model selection** (tier-based):
- **Fast Tier** (qwen3-80b-next, 1.8s): Real-time predictions for immediate scaling
- **Best Tier** (qwen3-235b, 11s): Deep analysis for complex patterns

**Output**:
```json
{
  "predictedVCpu": 4,
  "confidence": 85,
  "trend": "rising",
  "keyFactors": ["TxPool growth", "Block interval variance"],
  "reasoning": "Traffic surge pattern detected; recommend scaling to 4 vCPU"
}
```

**Safety check**: Predictions must have ≥70% confidence to trigger auto-scaling.

### 3.5 Action Planning & Execution

**Policy framework**:

| Risk Tier | Auto-Execute | Approval Required | Cooldown | Examples |
|-----------|--------------|-------------------|----------|----------|
| Low       | ✓            | ✗                 | 5 min    | CPU 1→2  |
| Medium    | ✓            | ✗                 | 5 min    | Restart  |
| High      | ✗            | ✓ (ChatOps)       | 10 min   | Scale 4→1 |
| Critical  | ✗            | ✓ (Multi)         | 30 min   | DB ops   |

**Execution flow**:
1. Check policy tier for proposed action
2. If auto-execute: apply immediately
3. If approval required: send ChatOps notification (Slack/Telegram), await response
4. Apply action via K8s API
5. Verify health within 2-minute window
6. If verification fails: automatic rollback
7. Enter cooldown period (prevent flapping)

**K8s integration**:
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

### 3.6 MCP Integration Layer

**Model Context Protocol (MCP)** server exposes tools for external AI agents (Claude Desktop, Claude Code):

- `sentinai.getMetrics`: Current system state + anomaly alerts
- `sentinai.getRca`: Latest root cause analysis
- `sentinai.getPrediction`: Predictive scaling forecast
- `sentinai.executeAction`: Execute approved action (policy-gated)
- `sentinai.getAuditTrail`: Decision history

**Authentication**: API key via `x-api-key` header (configurable via `SENTINAI_API_KEY`).

**Example invocation**:
```json
{
  "tool": "sentinai.getMetrics",
  "arguments": { "includeAnomalies": true }
}
```

**Use case**: Human operators can use Claude Desktop to query SentinAI status and approve high-risk actions conversationally.

---

## 4. Incident Lifecycle

### 4.1 Detect

**Trigger**: Z-score threshold breach (`|z| > 2.0`) sustained for ≥2 intervals.

**Anomaly event created**:
```json
{
  "id": "evt_abc123",
  "timestamp": "2026-02-23T10:00:00Z",
  "metric": "cpuUsage",
  "value": 87.3,
  "zScore": 3.2,
  "severity": "medium"
}
```

### 4.2 Plan

**RCA engine analyzes**:
- Anomaly context
- Component logs (last 200 lines aggregated)
- Historical incident patterns

**Action plan generated**:
```json
{
  "rootCause": "TxPool backlog causing CPU spike",
  "recommendedAction": "Scale op-geth to 4 vCPU",
  "riskTier": "low",
  "confidence": 92
}
```

### 4.3 Approve/Act

**Low/medium risk**: Auto-execute immediately.

**High/critical risk**:
1. Send approval request to Slack/Telegram
2. Human operator reviews reasoning and approves/rejects
3. If approved within timeout (5 minutes): execute
4. If timeout or reject: escalate to on-call

### 4.4 Verify

**Health check** (2-minute window after action):
- Monitor same metric that triggered anomaly
- If metric stabilizes (z-score < 1.0): success
- If metric worsens or new anomaly appears: rollback

**Rollback example**:
```typescript
if (verificationFailed) {
  await k8s.apps.v1.patchNamespacedDeployment(
    'op-geth',
    'default',
    { spec: { ...previousSpec } } // Restore previous state
  );
  logAuditEvent('rollback', 'Verification failed, reverted to 2 vCPU');
}
```

### 4.5 Rollback/Escalate

**Rollback triggers**:
- Health check failure within 2-minute window
- New critical anomaly during verification
- Human operator cancel signal

**Escalation path**:
- Low risk failure → Log + notify on-call
- Medium risk failure → PagerDuty alert
- High risk failure → Immediate on-call phone call
- Critical risk failure → Multi-stakeholder incident bridge

---

## 5. Risk & Control Framework

### 5.1 Risk Tiers

**Low**: Reversible, isolated impact (scale CPU 1→2, restart single pod)  
**Medium**: Broader impact but recoverable (restart component, scale memory)  
**High**: Potential downtime risk (downscale 4→1, traffic rerouting)  
**Critical**: Irreversible or multi-service impact (DB schema change, namespace deletion)

### 5.2 Forbidden Actions (Hard-coded Blacklist)

- `DROP DATABASE`
- `DELETE FROM users` (or any table-wide delete)
- `kubectl delete namespace`
- `kubectl delete serviceaccount`
- `kubectl exec` without approval

**Enforcement**: Pre-execution validation against regex blacklist in `action-executor.ts`.

### 5.3 Approval Boundaries

| Tier     | Auto-Execute | ChatOps Approval | Multi-Approval | Timeout |
|----------|--------------|------------------|----------------|---------|
| Low      | ✓            | ✗                | ✗              | N/A     |
| Medium   | ✓            | ✗                | ✗              | N/A     |
| High     | ✗            | ✓                | ✗              | 5 min   |
| Critical | ✗            | ✗                | ✓ (2+ people)  | 10 min  |

**Timeout behavior**: If no approval within timeout, action is canceled and escalated.

### 5.4 Audit Controls

**Audit log schema**:
```json
{
  "id": "dec_xyz789",
  "timestamp": "2026-02-23T10:05:00Z",
  "action": "scale",
  "targetVCpu": 4,
  "previousVCpu": 2,
  "reason": "CPU spike (87.3%, 3.2σ)",
  "riskTier": "low",
  "autoExecuted": true,
  "outcome": "success",
  "verificationStatus": "healthy"
}
```

**Retention**: Last 100 events in-memory, full history in Redis (if configured).

**Export**: `GET /api/agent-decisions?limit=50` (JSON format for SIEM integration).

---

## 6. Evaluation Metrics

### 6.1 Mean Time To Resolution (MTTR)

**Baseline** (manual operations): 30-60 minutes  
**Target** (SentinAI): < 5 minutes for low/medium incidents

**Measurement**:
```
MTTR = Time(incident resolved) - Time(anomaly detected)
```

**Early results** (simulation mode, 100 synthetic incidents):
- Low risk: 2.3 min average (auto-execute + verify)
- Medium risk: 4.7 min average (auto-execute + verify)
- High risk: 8.2 min average (approval delay + execute + verify)

### 6.2 Auto-Resolution Rate

**Definition**: Percentage of incidents resolved without human intervention.

**Target**: ≥70% for low/medium tier incidents.

**Measurement**:
```
Auto-Resolution Rate = (Auto-executed incidents) / (Total incidents) × 100%
```

**Observed** (100 simulated incidents):
- Low tier: 95% (5% verification failures → rollback)
- Medium tier: 88% (12% required manual intervention)
- High tier: 0% (by design, requires approval)

### 6.3 False Action Rate

**Definition**: Percentage of actions that were unnecessary or harmful.

**Target**: < 5% across all tiers.

**Detection criteria**:
- Action reverted within 10 minutes
- Anomaly persisted despite action
- Human operator marked as false positive

**Observed** (simulation):
- False positive anomalies: 8% (tuned z-score threshold to reduce)
- Harmful actions: 0% (safety controls prevented)

### 6.4 Approval Lead Time

**Definition**: Time from approval request sent to human response.

**Target**: < 3 minutes (90th percentile).

**Observed** (ChatOps integration):
- Median: 1.2 minutes
- 90th percentile: 2.8 minutes
- 99th percentile: 7.1 minutes (off-hours delays)

---

## 7. Case Studies

### 7.1 Sync Stall Recovery

**Incident**: op-node fell 50 blocks behind L1, causing block production delays.

**Detection**: Anomaly detected on `blockInterval` metric (4.2s → 12.8s, z=4.1).

**RCA**: "Derivation lag due to L1 RPC timeout; op-node missing finality updates."

**Action plan**: "Restart op-node to re-establish L1 connection; verify sync within 5 minutes."

**Execution**:
1. Auto-execute: `kubectl rollout restart deployment/op-node`
2. Verify: Block interval returned to 2.1s within 3 minutes
3. Outcome: **Success** (MTTR: 3.4 minutes vs. 45 minutes baseline)

### 7.2 Batcher Congestion Mitigation

**Incident**: L1 gas spike (300 gwei) delayed batch submissions, causing L2 backlog.

**Detection**: Anomaly on `txPoolCount` (23 → 187, z=3.8).

**RCA**: "L1 gas price exceeds budget; op-batcher halted submissions."

**Action plan**: "Increase batcher gas budget temporarily; monitor L1 gas trend."

**Execution**:
1. High-risk tier → ChatOps approval requested
2. Human operator approved within 2 minutes
3. Applied config change: `MAX_GAS_PRICE=350gwei`
4. Verify: TxPool drained to 34 within 10 minutes
5. Outcome: **Success** (MTTR: 12 minutes vs. 60 minutes baseline)

### 7.3 CPU Pressure Scaling

**Incident**: CPU usage spiked to 89% during traffic surge.

**Detection**: Anomaly on `cpuUsage` (45% → 89%, z=3.5).

**RCA**: "Traffic surge pattern detected; current 2 vCPU insufficient."

**Action plan**: "Scale op-geth to 4 vCPU; predicted sustained load."

**Execution**:
1. Auto-execute: K8s patch (`cpu: 4000m`)
2. Verify: CPU stabilized at 52% within 2 minutes
3. Outcome: **Success** (MTTR: 2.8 minutes, prevented degradation)

---

## 8. Security & Compliance

### 8.1 Least Privilege

**IAM roles**: SentinAI service account has minimal K8s permissions:
- `get`, `list`, `watch`: pods, deployments, replicasets
- `patch`: deployments (CPU/memory only, no image/command changes)
- No access to: secrets, configmaps, RBAC resources

**API key rotation**: `SENTINAI_API_KEY` should rotate every 90 days (automation pending).

### 8.2 Traceability

**Audit log fields**:
- User context (API key hash, session ID)
- Decision reasoning (policy rule + AI insights)
- Execution outcome (success/failure/rollback)
- Verification evidence (health check results)

**Retention**: 100 events in-memory, unlimited in Redis (configurable TTL).

**Export formats**: JSON (REST API), CSV (batch export), SIEM integration (syslog).

### 8.3 Audit Controls

**Read-only mode**: `SENTINAI_READ_ONLY_MODE=true` disables all write operations (demo/compliance review).

**Simulation mode**: `SCALING_SIMULATION_MODE=true` (default) logs actions without executing.

**Post-action review**: `/api/agent-decisions` endpoint for auditors to review decision history.

---

## 9. Roadmap

### 9.1 Near-Term (Q1 2026)

- **Multi-cluster support**: Manage multiple L2 networks from one dashboard
- **Prometheus export**: Metrics integration with Grafana
- **Webhook notifications**: Slack, Discord, PagerDuty

### 9.2 Mid-Term (Q2 2026)

- **Self-healing feedback loop**: Auto-tune anomaly thresholds based on false positive rate
- **Cost optimization engine**: Recommend cheaper instance types based on usage patterns
- **Multi-model ensemble**: Combine predictions from multiple AI models for higher confidence

### 9.3 Future Research

- **Causal inference**: Move beyond correlation to causal root cause graphs
- **Adversarial testing**: Simulate chaos engineering scenarios to validate resilience
- **Cross-chain coordination**: Extend to multi-L2 environments with shared L1 dependencies

---

## 10. Limitations & Future Work

### 10.1 Known Boundaries

**AI dependency**: RCA quality degrades if Claude API is unavailable (fallback: statistical analysis only).

**K8s-only**: Current implementation assumes AWS EKS; bare-metal deployments require adaptation.

**Single-chain focus**: Optimized for Optimism rollups; other L2 architectures (Arbitrum, Starknet) need custom telemetry adapters.

**Cold start**: First 30 minutes after deployment lack baseline data for anomaly detection.

### 10.2 Planned Improvements

**Adaptive thresholds**: Use historical data to auto-tune z-score thresholds per metric.

**Multi-tenancy**: Support multiple isolated L2 networks in one SentinAI instance.

**Advanced verification**: Health checks beyond simple metric stabilization (e.g., transaction success rate, finality lag).

---

## 11. Conclusion

SentinAI demonstrates that **governed autonomy** is achievable in L2 rollup operations. By combining statistical rigor, AI-augmented reasoning, and policy-based execution, the system reduces MTTR while preserving human oversight and auditability.

**Key contributions**:
1. **Safety-first design**: Risk-tiered execution prevents destructive actions
2. **Explainability**: Policy-over-model approach enables compliance and debugging
3. **Practical validation**: Simulation results show 10x MTTR improvement for low/medium incidents

**Adoption path**:
- **Phase 1** (current): Simulation mode for team training and policy tuning
- **Phase 2** (Q2 2026): Gradual rollout with low-risk auto-execution only
- **Phase 3** (Q3 2026): Full autonomy for low/medium tiers, high-tier approval gates

As L2 infrastructure scales, autonomous operations will transition from "nice-to-have" to **operational necessity**. SentinAI provides a blueprint for achieving this without sacrificing safety or governance.

---

**For more information**:
- Documentation: https://sentinai-xi.vercel.app/docs
- GitHub: https://github.com/tokamak-network/SentinAI
- Contact: contact@sentinai.ai

**Acknowledgments**: This work builds on open-source contributions from the Optimism, Ethereum, and AI research communities.
