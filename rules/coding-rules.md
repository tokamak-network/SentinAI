# Coding Rules

> IF 코딩 작업 → READ this file

## Code Quality

- Type safety is the top priority.
- Write error handling explicitly.
- Keep code simple and intuitive.
- Analyze root causes, not symptoms, when errors occur.

## Elegance

- Before non-trivial changes, pause and ask: **"Is there a more elegant approach?"**
- If it feels hacky: "Given everything I know, what is the true solution?"
- Do NOT apply to simple/obvious fixes (avoid over-engineering).
- Challenge your own work before presenting results.

## Core Principles

- **Simplicity First**: Every change should be as simple as possible. Minimize code impact.
- **No Laziness**: Fix root causes. No band-aids. Maintain senior engineer standards.
- **Minimal Impact**: Only change what's necessary. Prevent introducing new bugs.

## Architecture Patterns

- For dashboard observability features, compute KPIs in a pure shared module first, test it independently, then reuse it from API routes and UI polling layers.
- Chain capability metadata must be the single source of truth for dashboard/API/MCP exposure.
- Separate `SentinAI internal L1 RPC` and `L2 failover L1 RPC` through different env/function paths.
- Optional autonomy modules must degrade gracefully and never break the core scaling loop.

## API and Runtime Safety

- APIs that allow read-only compatibility in middleware must still enforce write guards at route/tool handler level.
- For prefixed network dashboards, all client API calls must be generated from one base-path resolver.
- Heartbeat guardrails should include in-process watchdog (`detect -> alert -> recovery attempt`) in addition to external scheduling.
- Watchdog alerting and auto-recovery paths must enforce independent cooldown windows.
