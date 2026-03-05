# Test Failure & Bug Fix Rules

> IF 테스트 실패 → READ this file

## Autonomous Bug Fixing

- When receiving a bug report, fix it immediately. Do not ask the user step-by-step.
- Check logs, errors, and failing tests directly to identify the cause and resolve it.
- Resolve issues without requiring user context switches.
- Fix failing CI tests without being told to.

## Task Completion Criteria

- Never finish with stub implementations.
- A task is only done when user-defined completion criteria (test pass, screenshot verification, etc.) are met.

## Test Integrity

- If tests are defined, the task is NOT complete until **all tests pass**.
- Do NOT modify tests arbitrarily (unless the user explicitly allows it).

## Task Contract Protocol

When a task contract (`{TASK}_CONTRACT.md`) exists:
1. Fulfill all items in the contract.
2. Run and pass all tests.
3. Verify with screenshots if required.
4. Do not end the session until all conditions are met.
