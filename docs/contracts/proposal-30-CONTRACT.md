# Task Contract: Deployment Readiness and Hardening (Proposal 30)

## Completion Criteria

- [ ] Patch quickstart/setup consistency against runtime behavior
- [ ] Extend post-install smoke for `health + agent-loop + goal-manager`
- [ ] Add deploy version pin option (`SENTINAI_REF`)
- [ ] Add preflight checks and rollback automation scripts

## Verification

- `npx tsc --noEmit` passes
- `npx vitest run` — all related tests pass
- `npm run verify` — full 6-phase cluster verification passes
- `scripts/verify-e2e.sh --phase 2` — smoke test passes with new checks
- Docker build succeeds: `docker compose build`

## Constraints

- READ `rules/coding-rules.md` — simplicity first
- READ `rules/docs-rules.md` — one canonical operator guide
- Every env-based operational decision should have executable checker script
