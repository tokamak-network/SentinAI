# Task Contract: Client Auto-Customization Completion (Proposal 31)

## Completion Criteria

- [ ] Implement instance registration/validation/capability mapping API v2
- [ ] Add onboarding wizard for `Connect Your Node` end-to-end flow
- [ ] Add dashboard bootstrap auto-connection after registration
- [ ] Add onboarding verification scenarios for L1 + L2 combinations

## Verification

- `npx tsc --noEmit` passes
- `npx vitest run` — all related tests pass
- E2E: onboarding wizard completes successfully (Playwright screenshot)
- API v2 instance registration returns valid capability map
- Dashboard auto-connects after registration (screenshot)

## Constraints

- READ `rules/coding-rules.md` — chain capability metadata as single source of truth
- READ `rules/blockchain-rules.md` — chain plugin contracts
- READ `rules/coding-test-rules.md` — mock contracts for IStateStore
