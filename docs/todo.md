# TODO: SentinAI Implementation

> Last Updated: 2026-03-04

## Scope Policy (Hot vs Cold)

- Keep this file focused on active execution only.
- Keep `Active` at 5 items or fewer.
- Move completed or parked items to monthly archive files.
- Review and archive at least once per week or on major merge.

## Active (Max 5)

### 1) Verifiable Accountability Framework (proposal-29)
- [ ] Standardize SLO gates in `operation-verifier` and verify APIs.
- [ ] Persist reason provenance across `agent-loop`, `goal-planner`, and memory flows.
- [ ] Add failure liability classification (`policy_defect` vs `execution_defect`).
- [ ] Add dashboard accountability view (24h/7d pass-fail, rollback, liability).

### 2) Deployment Readiness and Hardening (proposal-30)
- [ ] Patch quickstart/setup consistency against runtime behavior.
- [ ] Extend post-install smoke for `health + agent-loop + goal-manager`.
- [ ] Add deploy version pin option (`SENTINAI_REF`).
- [ ] Add preflight checks and rollback automation scripts.

### 3) Client Auto-Customization Completion (proposal-31)
- [ ] Implement instance registration/validation/capability mapping API v2.
- [ ] Add onboarding wizard for `Connect Your Node` end-to-end flow.
- [ ] Add dashboard bootstrap auto-connection after registration.
- [ ] Add onboarding verification scenarios for L1 + L2 combinations.

### 4) Runtime Verification Stability
- [ ] Keep smoke script coverage on `health + agent-loop + goal-manager + agent-fleet`.
- [ ] Keep `verify-e2e` phase checks aligned with active runtime APIs.

### 5) Docs Context Hygiene
- [ ] Keep this file under ~200 lines.
- [ ] Keep `docs/lessons.md` under ~120 lines of active rules.
- [ ] Archive monthly snapshots under `docs/archive/`.

## Review (2026-03-04)

- [x] Introduced hot/cold split for TODO tracking.
- [x] Archived full historical TODO log to monthly snapshot.
- [x] Reduced root TODO to active execution checklist.

## Archive

- Full historical TODO snapshot: `docs/archive/todo-2026-03.md`
- Older archived docs: `docs/archive/`
