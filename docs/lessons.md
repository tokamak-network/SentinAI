# Project Lessons

> Active reusable lessons only. Archive long-form history in `docs/archive/`.

## Active Rules

- Do not track OS/editor metadata such as `.DS_Store`; keep them ignored at the repository root.
- Generated e2e screenshots and temporary test artifacts belong in ignored runtime directories, not in source control.
- Before deleting a path during cleanup, classify it as `source-of-truth`, `reference/history`, or `regenerable artifact` to avoid removing valid project evidence.
- Keep `package.json` script entries synchronized with actual files under `scripts/`; a dead script alias is a broken contract.
- One-off provider diagnostics in `scripts/` must be either documented and wired into a workflow or removed when they become unreferenced.
- When writing repository analysis, separate code-backed runtime behavior from mock or transitional surfaces so the report reflects actual product readiness.
- When localizing technical reports, translate narrative labels consistently but preserve code identifiers, routes, and API names exactly as implemented.
- When a user selects among architectural recommendations, update the report to record the chosen direction explicitly instead of leaving it as an open option.
- Remove misleading UI affordances with a regression test first; a search box that does not search is worse than no search box.
- When an architectural direction is selected but not yet implemented, capture the target design in a dedicated plan/design document before touching runtime code.
