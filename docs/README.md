# SentinAI Documentation

> Journey-first docs index (aligned to `docs/archive/brand/docs-ia.md`)

## 0) Start Here
- [What is SentinAI (project overview)](guide/overview.md)
- [📄 Whitepaper](archive/whitepaper.md)
- [**⚡ Quick Start (5 minutes)**](guide/quickstart.md)
- [10-min local quickstart (OP Stack)](guide/optimism-l2-sentinai-local-setup.md)
- [10-min local quickstart (Arbitrum Orbit)](guide/arbitrum-orbit-local-setup.md)
- [First incident simulation](guide/demo-scenarios.md)
- [Core concepts & guardrails](guide/autonomy-cockpit-user-guide.md)
- [🔧 Troubleshooting Guide](guide/troubleshooting.md)

## 1) Setup & Deployment
- [Local setup (Docker / compose)](guide/setup.md)
- [EC2 deployment guide](guide/ec2-setup-guide.md)
- [Environment variables reference](guide/setup.md#environment-variables)
- [OP Stack example runbook](guide/opstack-example-runbook.md)

## 2) Operate in Production
- [Daily operations runbook](guide/agentic-q1-operations-runbook.md)
- [Autonomy cockpit user guide](guide/autonomy-cockpit-user-guide.md)
- [Agent Loop vs Goal Manager hands-on runbook](guide/agent-loop-vs-goal-manager-hands-on-runbook.md)
- [Network stack dashboard/feature differences](guide/network-stack-dashboard-feature-differences.md)
- [Stack × environment operations decision matrix](guide/stack-environment-operations-decision-matrix.md)
- [Env-based operations profile quick decider](guide/env-based-operations-profile-quick-decider.md)

### Playbooks (by failure type)
- [Minority client migration](guide/minority-client-migration-playbook.md)
- [Partner diversity onboarding](guide/partner-diversity-onboarding.md)
- [Redis setup/troubleshooting](guide/redis-setup.md)

## 3) Integrate & Extend
- [🏗️ Architecture Guide](guide/architecture.md)
- [Codebase directory structure](../ARCHITECTURE.md)
- [Arbitrum Orbit example (ETH gas token rollup)](../examples/arbitrum-orbit/create-rollup-eth/README.md)
- [📡 API Reference](guide/api-reference.md)
- [SentinAI MCP user guide](guide/sentinai-mcp-user-guide.md)
- [Claude Code MCP setup](guide/claude-code-mcp-setup.md)
- [Claude Code MCP operations](guide/claude-code-mcp-operations-guide.md)
- [Client ops contract](spec/client-ops-contract.md)
- [Anomaly detection spec](spec/anomaly-detection-guide.md)
- [RCA engine spec](spec/rca-engine-guide.md)
- [Daily report spec](spec/daily-report-spec.md)
- [Zero-downtime scaling spec](spec/zero-downtime-scaling-spec.md)
- [Agent loop vs goal manager](spec/agent-loop-vs-goal-manager.md)
- [Tier comparison: General vs Premium](spec/tier-comparison.md)

## 4) Evaluate & Verify
- [**Algorithm effectiveness evaluation (DevOps audit)**](guide/algorithm-effectiveness-evaluation.md)
- [Testing guide](verification/testing-guide.md)
- [Multi-stack autonomous ops validation](guide/multistack-autonomous-ops-validation.md)
- [Integration test report](verification/integration-test-report.md)
- [Unit test coverage report](verification/unit-test-coverage-report.md)
- [Daily report verification](verification/daily-report-verification.md)
- [Dashboard UI testing guide](verification/dashboard-ui-testing-guide.md)
- [Production load testing guide](guide/production-load-testing-guide.md)
- [Scaling accuracy testing guide](guide/scaling-accuracy-testing-guide.md)
- [Model benchmark guide](guide/MODEL_BENCHMARK_GUIDE.md)
- [LLM stress test env guide](guide/LLM_STRESS_TEST_ENV_GUIDE.md)
- [LLM stress test framework spec](spec/LLM-STRESS-TEST-FRAMEWORK.md)

## 5) Governance & History
- [Todo proposals](todo/)
- [Completed proposals](done/)
- [Verification artifacts](verification/)
- [Project lessons](lessons.md)
- [Project overview](guide/overview.md)

---

## Fast Paths

### I want to run a demo today
1. [**⚡ Quick Start (5 min)**](guide/quickstart.md)
2. [Demo scenarios](guide/demo-scenarios.md)
3. [Autonomy cockpit controls](guide/autonomy-cockpit-user-guide.md)

### I'm stuck / something's broken
1. [🔧 Troubleshooting Guide](guide/troubleshooting.md)
2. [Setup Guide (env vars reference)](guide/setup.md)
3. [Redis setup/troubleshooting](guide/redis-setup.md)

### I need production operations guidance
1. [Daily operations runbook](guide/agentic-q1-operations-runbook.md)
2. [Playbooks section](#playbooks-by-failure-type)

### I need API/MCP integration
1. [MCP user guide](guide/sentinai-mcp-user-guide.md)
2. [Claude MCP setup](guide/claude-code-mcp-setup.md)
3. [Contracts/specs](#3-integrate--extend)
