# Documentation Rules

> IF 문서 작성 → READ this file

## Operations Documentation

- For multi-stack ops docs, separate `common dashboard surface` and `chain-specific capabilities/actions` with a comparison table.
- Include deployment-environment axis (`orchestrator`, `simulation`, `production restrictions`, `auth guard`) alongside chain differences.
- Every env-based operational decision guide should have an executable checker script.
- Keep one canonical operator guide for setup + operations + troubleshooting, and keep old docs as redirect stubs.

## Context Hygiene

- Keep `docs/todo.md` focused on active execution only (max 5 active items).
- Archive completed/parked TODO items monthly into `docs/archive/todo-YYYY-MM.md`.
- Keep lessons focused on reusable rules; archive long-form history monthly into `docs/archive/lessons-YYYY-MM.md`.
- Target: all active tracking files under ~200 lines, quickly scannable.
