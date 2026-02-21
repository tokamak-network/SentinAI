# SentinAI Documentation

> Autonomous Node Guardian for Optimism L2

---

## Proposals

Proposal to strengthen monitoring, scaling, security, prediction, and operational automation using AI models.

| # | offer | status | document |
|---|------|------|------|
| 1 | **Predictive Scaling** — Predictive scaling based on time series analysis | Implementation complete | [Details](done/proposal-1-predictive-scaling.md) |
| 2 | **Anomaly Detection** — Multi-layer anomaly detection pipeline | Implementation complete | [Details](done/proposal-2-anomaly-detection.md) |
| 3 | **Root Cause Analysis** — Automatic analysis of the root cause of failure | Implementation complete | [Details](done/proposal-3-rca-engine.md) |
| 4 | **AI Cost Optimizer** — Fargate cost optimization engine | Implementation complete | [Details](done/proposal-4-cost-optimizer.md) |
| 5 | **Natural Language Ops** — Natural language-based operating interface | Implementation complete | [Details](done/proposal-5-nlops.md) |
| 6 | **Zero-Downtime Scaling** — Non-disruptive vertical scaling strategy | Implementation complete | [Details](done/proposal-6-zero-downtime-scaling.md) |
| 7 | **Redis State Store** — State persistence layer (Redis/InMemory dual implementation) | Implementation complete | [Details](done/proposal-7-redis-state-store.md) |

## Testing

### Unit Tests
- **Pass rate**: 750 tests passed 100% (32 files, based on execution on 2026-02-20)
- **Coverage**:
- Total (lines): 55% (as of execution on 2026-02-20)
- **Run**: `npm run test:run`
- **Coverage Report**: `npm run test:coverage`

### E2E Verification (Cluster)
- **Script**: `scripts/verify-e2e.sh`
- **Target**: Actual EKS + L2 RPC + AI Provider
- **6 Phase Verification**: Metric collection → Anomaly detection → Prediction → Cost → Report → RCA
- **Run**: `npm run verify` or `bash scripts/verify-e2e.sh --phase 2`

---

## Verification

Functional verification plan and execution results report.

| target | Type | document |
|------|------|------|
| Predictive Scaling | Verification Plan | [Details](verification/predictive-scaling-verification.md) |
| Predictive Scaling | execution result | [Details](verification/predictive-scaling-verification-report.md) |
| Seed UI (Mock data verification) | Verification Guide | [Details](verification/seed-ui-verification.md) |
| Seed UI (Mock data verification) | execution result | [Details](verification/seed-ui-verification-report.md) |

---

## Guides

Practical guide and deployment and testing methods.

| Guide | target | Description |
|--------|------|------|
| [Redis setup](guide/redis-setup.md) | Developer | InMemory vs Redis selection, setup/removal method |
| [EC2 Installation Guide](guide/ec2-setup-guide.md) | Non-developer/operator | AWS EC2 + Docker Compose + Cloudflare Tunnel Deployment |
| [L1 Proxyd Failover](guide/proxyd-failover-setup.md) | operator | **[Required]** L2 block generation protection: Automatic failover when Paid L1 RPC quota is exceeded |
| [OP Stack Example Runbook](guide/opstack-example-runbook.md) | Developer/Operator | examples/opstack standard setting/execution/chain verification/termination procedure |
| [ZK Stack local integration](guide/zkstack-local-setup-guide.md) | Developer/Operator | ZK Stack local L2 execution, Probe, SentinAI integration procedure |
| [ZK L2 Example Runbook](guide/zk-l2-example-runbook.md) | Developer/Operator | examples/zkstack standard setting/execution/verification/termination quick procedure |
| [Demo Scenarios](guide/demo-scenarios.md) | Test/Demo | L2 metric simulation for various scenarios |
| [Production Load Testing](guide/production-load-testing-guide.md) | QA/Operations | Load testing and verification in a real EKS environment |
| [Scaling Accuracy Testing](guide/scaling-accuracy-testing-guide.md) | Developer/Operator | Scaling algorithm backtest principle, usage, and how to add scenarios |

Standard integration template:
- Templates for each root chain: `.env.thanos.example`, `.env.optimism.example`, `.env.zkstack.example`
- `examples/zkstack/` (`.env.example`, `docker-compose.core-only.yml`, `secrets.container.yaml.example`)
- `examples/opstack/` (`.env.example`)

---

## Future Work

Future work roadmap and planned proposals.

| # | offer | status | document |
|---|------|------|------|
| 8 | **Auto-Remediation Engine** — RCA-based auto-remediation loop and playbook system | Planning | [Details](../todo/proposal-8-auto-remediation.md) |
| — | **Universal Blockchain Platform** — Optimism and other L2/L1 chain expansions (Arbitrum, zkSync, etc.) | Planning | [Details](../todo/universal-blockchain-platform.md) |
