# Test Rules

> IF 테스트 작성 → READ this file

## Verification Before Done

- **No task completion without proof of work.**
- Diff changes against main when applicable.
- Ask yourself: **"Would a staff engineer approve this?"**
- Run tests, check logs, prove correctness.

## Test Patterns

- Runtime smoke must include `health + agent-loop + goal-manager + fleet` payload checks.
- When changing sync/async function signatures, update callsites and mock contracts in the same patch.
- If `IStateStore` is extended, update major `getStore()` mocks in the same commit.
- Health verification should reject explicit failure markers before broader success vocabulary checks.
