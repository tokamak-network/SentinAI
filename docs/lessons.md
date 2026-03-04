# Lessons Learned (Active Rules)

> Last Updated: 2026-03-04

## Scope Policy (Hot vs Cold)

- Keep this file as a compact, reusable rulebook.
- Keep only high-reuse rules that directly affect implementation quality.
- Move long incident narratives and older details to monthly archives.
- Target: keep active lessons concise and quickly scannable.

## Active Rules

### Architecture and Contracts
- Rule: For dashboard observability features, compute KPIs in a pure shared module first, test it independently, then reuse it from API routes and UI polling layers.
- Rule: Chain capability metadata must be the single source of truth for dashboard/API/MCP exposure.
- Rule: Separate `SentinAI internal L1 RPC` and `L2 failover L1 RPC` through different env/function paths.
- Rule: Optional autonomy modules must degrade gracefully and never break the core scaling loop.

### API and Runtime Safety
- Rule: APIs that allow read-only compatibility in middleware must still enforce write guards at route/tool handler level.
- Rule: For prefixed network dashboards, all client API calls must be generated from one base-path resolver.
- Rule: Heartbeat guardrails should include in-process watchdog (`detect -> alert -> recovery attempt`) in addition to external scheduling.
- Rule: Watchdog alerting and auto-recovery paths must enforce independent cooldown windows.

### Testing and Verification
- Rule: Runtime smoke must include `health + agent-loop + goal-manager + fleet` payload checks.
- Rule: When changing sync/async function signatures, update callsites and mock contracts in the same patch.
- Rule: If `IStateStore` is extended, update major `getStore()` mocks in the same commit.
- Rule: Health verification should reject explicit failure markers before broader success vocabulary checks.

### Operations and Docs
- Rule: For multi-stack ops docs, separate `common dashboard surface` and `chain-specific capabilities/actions` with a comparison table.
- Rule: Include deployment-environment axis (`orchestrator`, `simulation`, `production restrictions`, `auth guard`) alongside chain differences.
- Rule: Every env-based operational decision guide should have an executable checker script.
- Rule: Keep one canonical operator guide for setup + operations + troubleshooting, and keep old docs as redirect stubs.

### Context Hygiene
- Rule: Keep `docs/todo.md` focused on active execution only (max 5 active items).
- Rule: Archive completed/parked TODO items monthly into `docs/archive/todo-YYYY-MM.md`.
- Rule: Keep this lessons file focused on reusable rules; archive long-form history monthly into `docs/archive/lessons-YYYY-MM.md`.

## Review (2026-03-04)

- [x] Introduced hot/cold split for lessons management.
- [x] Archived full historical lessons snapshot to monthly file.
- [x] Reduced root lessons file to active reusable rules.

## Archive

- Full historical lessons snapshot: `docs/archive/lessons-2026-03.md`
- Older archived docs: `docs/archive/`
