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
- For marketplace-style operational data products, prefer decision-ready safety signals over order-flow-adjacent raw signals when both monetization and abuse resistance matter.
- When an ERC-20 payment asset lacks EIP-3009, the least invasive x402-compatible path is usually facilitator-side EIP-712 authorization plus ERC-20 `approve/transferFrom`, not token replacement.
- When a config-driven feature introduces a shared store abstraction, every runtime write/read surface must use that same store path; route-level regression tests should prove the API is not silently using a separate in-memory fallback.
- When a plan introduces async settlement states, it must name the settlement store, write/read owner, and reconciliation trigger explicitly; otherwise route implementation stalls on hidden infrastructure decisions.
- When a prototype marketplace and a production marketplace have different business models, keep them in separate domains instead of trying to reuse names, types, or stores across both.
- When a scheduled reputation batch depends on prior scores, give the job a single read/write score store and test both the fallback path and the post-publish persistence path; otherwise each run silently resets cumulative reputation.
- When a workflow must fail closed on missing Redis, do not route it through a general test-time in-memory fallback; use a dedicated Redis boundary and assert missing-config plus read/write failure paths explicitly.
- When SLA aggregation depends on request audit logs, persist the logs in the same durable store as the downstream reputation job; split durability models create invisible gaps after restarts.
- When a scheduler feeds a stateful daily job, never pass an empty override object for persisted inputs; cron wiring can silently bypass the durable state path even when the job itself is correct.
- When deployed contract ABI assets are missing, harden receipt parsing with a small set of documented alternate event signatures and keep deterministic fallbacks; do not pretend one guessed event shape is canonical.
- When an existing wireframe assumes an older backend, preserve the layout but remap every label, route, and metric to the current source-of-truth before implementation; otherwise UI polish just hardens obsolete assumptions.
- When a legacy route name already has user-facing recognition, prefer replacing its internals with the new source-of-truth surface instead of keeping the old behavior behind a familiar URL; otherwise navigation keeps leading operators to stale workflows.
- When App Router UI needs simple tab interaction but the test environment is node-only, prefer query-driven server-rendered tabs before introducing client state; this keeps deep links and regression tests straightforward.
- When a marketplace browse surface depends on an on-chain registry, do not start the discovery UI before the registry deployment source-of-truth exists; otherwise the UI plan outruns the contract reality.
- When contract-backed product features are already partially wired in app code, freeze the minimal contract spec before deployment work starts; otherwise app ABI guesses become de facto requirements by accident.
- When a repo has no contract toolchain yet but contract work must move forward, add a repository-tracked Solidity draft first and treat compile/deploy verification as a separate explicit phase instead of hand-waving the missing workspace.
