# SentinAI Docs IA (v2, Journey-first)

## A. Start Here
1. What is SentinAI (value, scope, non-goals)
2. 10-minute quickstart (local demo)
3. Core concepts (Incident, ActionPlan, Approval, Rollback)

## B. Setup & Deployment
4. Local setup (Docker / OP Stack / ZK Stack)
5. Infrastructure deployment (EC2 / EKS)
6. Environment & policy configuration

## C. Operate in Production
7. Daily operations runbook
8. Incident lifecycle and approval workflow
9. Playbooks by failure type

## D. Integrate & Extend
10. API / MCP guide
11. Integrations and chain-specific examples
12. Contracts/spec references

## E. Verify & Improve
13. Testing and verification guide
14. Benchmarks, stress tests, and validation reports
15. Lessons learned and quality gates

## F. Project Governance
16. Proposals (todo/done)
17. Changelog and release notes
18. Contributing workflow

---

## Design Principles
- **Journey-first:** New operator can go from zero to first successful run without context switching.
- **Task-first labels:** Titles should describe operator intent (e.g., “Recover sequencer stall”).
- **Progressive depth:** Guide pages first, deep spec pages second.
- **Evidence-linked:** Every major claim links to verification/report artifacts.
