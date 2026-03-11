# TODO: SentinAI Implementation

> Last Updated: 2026-03-06

## Scope Policy (Hot vs Cold)

- Keep this file focused on active execution only.
- Keep `Active` at 5 items or fewer.
- Move completed or parked items to monthly archive files.
- Review and archive at least once per week or on major merge.

## Active (Max 5)

### 0) Abstract Playbook Layer
→ Plan: `docs/plans/2026-03-11-abstract-playbook-layer.md`
→ Depends on: `feat/l1-evm-plugin` (진행 중), proposal-32 (Self-Evolving Playbook)
→ Phase 1–2는 현재 브랜치와 병행 가능. Phase 3 이후 proposal-32 선행 필요.

### 1) Verifiable Accountability Framework (proposal-29)
→ Contract: `docs/contracts/proposal-29-CONTRACT.md`

### 2) Deployment Readiness and Hardening (proposal-30)
→ Contract: `docs/contracts/proposal-30-CONTRACT.md`

### 3) Client Auto-Customization Completion (proposal-31)
→ Contract: `docs/contracts/proposal-31-CONTRACT.md`

### 4) Runtime Verification Stability
- [ ] Keep smoke script coverage on `health + agent-loop + goal-manager + agent-fleet`.
- [ ] Keep `verify-e2e` phase checks aligned with active runtime APIs.

### 5) Docs Context Hygiene
- [x] Audit repository file hygiene and separate source-of-truth paths from regenerable artifacts.
- [x] Remove stale script entries and unreferenced diagnostic scripts from `scripts/`.
- [ ] Keep this file under ~200 lines.
- [ ] Keep `rules/` files focused on reusable rules.
- [ ] Archive monthly snapshots under `docs/archive/`.

## Archive

- Full historical TODO snapshot: `docs/archive/todo-2026-03.md`
- Older archived docs: `docs/archive/`

## Review (2026-03-06)

- Repository hygiene audit completed: documented keep/archive/remove paths, restored `docs/lessons.md`, and removed tracked junk artifacts.
- Scripts cleanup completed: removed dead `prod:gate:tier2` entry and deleted unused provider-diagnostic utilities.

## Session Checklist (2026-03-09)

### Comprehensive Codebase Analysis Report

- [x] Inventory current docs, app routes, and runtime entry points.
- [x] Analyze landing page, dashboard surfaces, and shared UI components.
- [x] Analyze API routes plus `src/lib` and `src/core` agent/detection/autonomy flows.
- [x] Write a code-based report under `docs/`.
- [x] Review the resulting diff for documentation-only changes.

### Report Localization

- [x] Convert the analysis report narrative and section labels into natural Korean while keeping code identifiers unchanged.

### Follow-up Decisions

- [x] Reflect the chosen follow-up direction in the report: Redis Streams for Agent V2 events, remove docs search, defer chain/plugin convergence.

### Redis Streams Design + Docs Search Removal

- [x] Write an implementation plan covering the Redis Streams EventBus design document and docs search removal.
- [x] Add a failing regression test proving docs pages should not render docs search UI.
- [x] Remove docs search UI/component usage from the docs page and keep docs navigation intact.
- [x] Write the Redis Streams EventBus design document under `docs/plans/`.
- [x] Run focused verification and review the resulting diff.
