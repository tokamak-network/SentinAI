# Project Lessons

> Active reusable lessons only. Archive long-form history in `docs/archive/`.

## Active Rules

- Do not track OS/editor metadata such as `.DS_Store`; keep them ignored at the repository root.
- Generated e2e screenshots and temporary test artifacts belong in ignored runtime directories, not in source control.
- Before deleting a path during cleanup, classify it as `source-of-truth`, `reference/history`, or `regenerable artifact` to avoid removing valid project evidence.
- Keep `package.json` script entries synchronized with actual files under `scripts/`; a dead script alias is a broken contract.
- One-off provider diagnostics in `scripts/` must be either documented and wired into a workflow or removed when they become unreferenced.
