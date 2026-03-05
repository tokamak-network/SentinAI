# Task Contract: Verifiable Accountability Framework (Proposal 29)

## Completion Criteria

- [ ] Standardize SLO gates in `operation-verifier` and verify APIs
- [ ] Persist reason provenance across `agent-loop`, `goal-planner`, and memory flows
- [ ] Add failure liability classification (`policy_defect` vs `execution_defect`)
- [ ] Add dashboard accountability view (24h/7d pass-fail, rollback, liability)

## Verification

- `npx tsc --noEmit` passes
- `npx vitest run` — all related tests pass
- Dashboard accountability view renders correctly (screenshot)
- SLO gates reject operations that violate thresholds

## Constraints

- READ `rules/coding-rules.md` — architecture patterns
- READ `rules/coding-test-rules.md` — verification before done
- Optional modules must degrade gracefully (`rules/blockchain-rules.md`)
