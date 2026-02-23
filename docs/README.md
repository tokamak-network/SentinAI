# SentinAI Documentation

> Autonomous Node Guardian for L2 / Rollup operations

This index follows the IA defined in `docs/brand/docs-ia.md`.

## 1. Introduction
- [What is SentinAI](../README.md#overview)
- [Core concepts](guide/autonomy-cockpit-user-guide.md)

## 2. Quickstart (10 min)
- [Prerequisites + local setup](guide/optimism-l2-sentinai-local-setup.md)
- [Demo scenarios (first incident simulation)](guide/demo-scenarios.md)

## 3. Installation
- [Local Container (Docker Compose)](../README.md#setup)
- [EKS / EC2 deployment path](guide/ec2-setup-guide.md)

## 4. Configuration
- [Environment variables sample](../.env.local.sample)
- [Autonomy/risk policy controls](guide/autonomy-cockpit-user-guide.md)
- [Integration examples (OP Stack / ZK Stack)](guide/opstack-example-runbook.md)

## 5. Operations Runbook
- [Daily operations + lifecycle guidance](guide/agentic-q1-operations-runbook.md)
- [L1 client operations automation](guide/l1-client-operations-automation-guide.md)

## 6. Playbooks
- [Proxyd failover setup](guide/proxyd-failover-setup.md)
- [Minority client migration playbook](guide/minority-client-migration-playbook.md)
- [Partner diversity onboarding](guide/partner-diversity-onboarding.md)

## 7. API & MCP
- [MCP user guide](guide/sentinai-mcp-user-guide.md)
- [Claude Code MCP setup](guide/claude-code-mcp-setup.md)
- [Claude Code MCP operations guide](guide/claude-code-mcp-operations-guide.md)

## 8. Safety Model
- [Autonomy cockpit guardrails](guide/autonomy-cockpit-user-guide.md)
- [Client ops contract](spec/client-ops-contract.md)

## 9. Observability
- [Anomaly detection guide](spec/anomaly-detection-guide.md)
- [RCA engine guide](spec/rca-engine-guide.md)
- [Daily report spec](spec/daily-report-spec.md)

## 10. Troubleshooting
- [Redis troubleshooting/setup](guide/redis-setup.md)
- [Production load testing guide](guide/production-load-testing-guide.md)
- [Scaling accuracy testing guide](guide/scaling-accuracy-testing-guide.md)

## 11. Contributing
- [Repository setup and scripts](../README.md)
- [Verification/testing guide](verification/testing-guide.md)

## 12. Changelog
- [Latest verification snapshots](verification/)
- [Done proposals archive](done/)

---

## Legacy Catalog

### Completed Proposals
- [Proposal 1: Predictive Scaling](done/proposal-1-predictive-scaling.md)
- [Proposal 2: Anomaly Detection](done/proposal-2-anomaly-detection.md)
- [Proposal 3: RCA Engine](done/proposal-3-rca-engine.md)
- [Proposal 4: Cost Optimizer](done/proposal-4-cost-optimizer.md)
- [Proposal 5: NLOps](done/proposal-5-nlops.md)
- [Proposal 6: Zero-Downtime Scaling](done/proposal-6-zero-downtime-scaling.md)
- [Proposal 7: Redis State Store](done/proposal-7-redis-state-store.md)
- [Proposal 8: Auto-Remediation Engine](done/proposal-8-auto-remediation.md)

### Verification
- [Predictive scaling verification](verification/predictive-scaling-verification.md)
- [Predictive scaling result report](verification/predictive-scaling-verification-report.md)
- [Seed UI verification](verification/seed-ui-verification.md)
- [Seed UI verification report](verification/seed-ui-verification-report.md)
