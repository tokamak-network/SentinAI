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
- **Pass rate**: 898 tests passed 100% (59 files, based on execution on 2026-02-22)
- **Coverage**:
- Total (lines): 62.22% (as of execution on 2026-02-22)
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
| [환경 변수 샘플](../.env.local.sample) | Developer/Operator | 필수/선택 환경 변수 템플릿 (`.env.local` 작성 기준) |
| [LLM Stress Test 환경 가이드](guide/LLM_STRESS_TEST_ENV_GUIDE.md) | Developer/QA | LLM 부하 테스트 환경 변수/실행 전 준비 |
| [모델 벤치마크 가이드](guide/MODEL_BENCHMARK_GUIDE.md) | Developer/QA | 모델 성능/비용 벤치마크 실행 및 해석 방법 |
| [Redis setup](guide/redis-setup.md) | Developer | InMemory vs Redis selection, setup/removal method |
| [EC2 Installation Guide](guide/ec2-setup-guide.md) | Non-developer/operator | AWS EC2 + Docker Compose + Caddy HTTPS(DNS) 배포 |
| [Optimism L2 로컬 설정](guide/optimism-l2-sentinai-local-setup.md) | Developer/Operator | OP Stack 기반 로컬 L2 + SentinAI 연동 절차 |
| [L1 Proxyd Failover](guide/proxyd-failover-setup.md) | operator | **[Required]** L2 block generation protection: Automatic failover when Paid L1 RPC quota is exceeded |
| [L1 클라이언트 운영 자동화](guide/l1-client-operations-automation-guide.md) | 운영/플랫폼 팀 | L1 운영 자동화를 위한 필수 기술 요소, DoD, 4주 MVP 기준 |
| [Agentic Q1 운영 런북](guide/agentic-q1-operations-runbook.md) | Operator | Guardian v2, Memory/Trace, Adaptive Routing 운영 절차 |
| [Autonomy Cockpit 사용자 가이드](guide/autonomy-cockpit-user-guide.md) | Operator/Demo | 자율 패널 상태 해석, 레벨 제어, 데모 액션, 장애 대응 절차 |
| [SentinAI MCP 사용자 가이드](guide/sentinai-mcp-user-guide.md) | Developer/Operator | Claude Code 연동 설정부터 MCP 운영/장애 대응까지 통합 절차 |
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
| 8 | **Auto-Remediation Engine** — RCA-based auto-remediation loop and playbook system | Implementation complete | [Details](done/proposal-8-auto-remediation.md) |
| — | **Universal Blockchain Platform** — Optimism and other L2/L1 chain expansions (Arbitrum, zkSync, etc.) | Planning | [Details](todo/universal-blockchain-platform.md) |
