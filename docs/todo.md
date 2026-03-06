# TODO: SentinAI Implementation

> Last Updated: 2026-03-06

## Scope Policy (Hot vs Cold)

- Keep this file focused on active execution only.
- Keep `Active` at 5 items or fewer.
- Move completed or parked items to monthly archive files.
- Review and archive at least once per week or on major merge.

## Active (Max 5)

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
