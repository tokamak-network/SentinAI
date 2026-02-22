# Lessons Learned

## 2026-02-22

- 인프라 확장 문서는 추상 목표만 나열하면 구현 단계에서 의사결정 공백이 생긴다.
- Rule: L1/L2 운영 보완 제안서는 모든 갭 항목에 `현재 코드 근거 파일`, `우선순위`, `DoD`를 함께 고정해 구현자가 추가 결정을 하지 않도록 작성한다.
- Full-autonomy requests become actionable only when decomposed into capability backlog + single focused proposal.
- Rule: For autonomous-agent roadmap work, keep one proposal per core capability (goal generation, orchestration, policy, learning) and attach file-level deliverables before implementation.
- Goal signal fusion across metrics/anomaly/failover/cost/memory is fragile if one source failure aborts the entire snapshot.
- Rule: Autonomous signal collectors must apply per-source fallback defaults and still emit a schema-complete snapshot for deterministic downstream scoring.
- Changing core planner APIs from sync to async can leave route/MCP tests green in some paths but fail on hidden mock contracts.
- Rule: When changing function sync/async signatures, run a repo-wide reference search and update both direct callsites and vi-mock return shapes in the same patch.
- Post-condition verification based on a single keyword (`ready`) is brittle across action executors and test doubles.
- Rule: Health verification predicates should reject explicit failure markers first, then accept a broader success vocabulary (`ready|running|ok|success|restart`).
- Deterministic autonomy evaluation must not depend on external LLM/runtime state by default.
- Rule: Evaluation scripts run in CI default to offline deterministic mode, with explicit opt-in flag (e.g., `--with-execution`) for heavier runtime replay.
- When adding persistent decision artifacts to the agent loop, unit-test mocks of `getStore()` can silently miss new methods and only fail at runtime logs.
- Rule: If `IStateStore` interface is extended, update all major `getStore` test mocks (`agent-loop`, integration-style unit tests) in the same commit.
- Route-level write guards are still required even when middleware already enforces read-only mode.
- Rule: For APIs that are read-only exceptions in middleware (e.g., MCP), enforce tool-level write restrictions again in handler logic.
- `vi.clearAllMocks()` only resets call history and does not restore overridden return values, which can leak state between tests and hide regressions.
- Rule: When a test mutates mock behavior (e.g., enabling/disabling autoscaling), explicitly re-assign required mock return values per test or use reset semantics.
- Adaptive routing should fail-open when all providers are circuit-blocked, otherwise transient outages can create total inference blackout.
- Rule: Circuit-breaker filtering keeps provider order, but if all candidates are blocked it must return the original order and rely on per-attempt failure recording.
- For routing fallback analytics, a single request can generate multiple provider attempts and must be correlated to avoid misleading counters.
- Rule: Attach `requestId` and `attempt` to each routing decision, then compute fallback-recovered/failed counts on grouped attempts.
- Unit test mocks can silently drift from runtime contracts when return values are loosely typed (e.g., RCA shape), which surfaces only during execution paths.
- Rule: When changing consumed fields of a domain result, update test mocks to a minimal full contract and run the affected execution-path test cases.
- Protocol dual support (legacy + standard MCP) can diverge on authorization behavior if handlers branch early.
- Rule: Normalize all tool invocations into one guard/execution function so approval token and read-only checks are identical across protocol variants.
- For stdio MCP transport, any stdout log corrupts frame parsing because stdout must carry only `Content-Length` framed payloads.
- Rule: MCP bridge diagnostics always go to stderr, and stdout writes must be limited to encoded protocol frames.
- Content-Length frame parsing can silently desync on malformed headers if rest-buffer handling is lax.
- Rule: Keep framed parser isolated as a pure utility with unit tests for multi-frame, partial-frame, and malformed-header paths.
- Authorization rules duplicated across route and tool handlers drift quickly and create inconsistent denial reasons.
- Rule: Centralize guard evaluation in a policy engine and return machine-readable reason codes from a single decision path.
- Approval token logic (hashing, expiry, consume-once) is easy to fork incorrectly when implemented inline in handlers.
- Rule: Keep approval ticket issue/validate/consume in a dedicated engine and call it from handlers instead of re-implementing.

## 2026-02-21

- A quarterly roadmap request becomes implementable only when each epic is split into file-level interface, env, and test contracts.
- Rule: For strategy-to-execution docs, always create one proposal file per epic and include `scope`, `public interface changes`, `test plan`, and `assumptions/defaults`.
- A roadmap document without timeline ownership causes ambiguous execution order.
- Rule: Q1 roadmap docs must include week-by-week milestones (12-week mapping) and explicit rollout/rollback checkpoints.
- Adding a write-capable API to read-only exceptions can accidentally bypass global safety policies.
- Rule: If a route is exempted in middleware for read-only compatibility, enforce write restrictions again in the route handler based on tool-level policy.

## 2026-02-20

- Tier 3 bundle gate fails excessively when looking only at the raw sum, so it is best to look at the transmission standard (gzip) figures together to determine the correct operation.
- Rule: First Load JS limit is measured based on the sum of `rootMain + polyfill` gzip, and raw/gzip figures are also output.
- Lighthouse gate is easy to miss responsive quality regression if mobile/desktop are not separated.
- Rule: Tier2 separates mobile (360px) and desktop (1920px) settings and forces assertions for each.
- If samples/external repo are mixed in the production gate, build/ts/lint will be broken regardless of feature quality.
- Rule: `external/**`, test, and document paths are separated from the operational build/type check target and fixedly verified with Tier1 gate script.
- New automation (scheduled scaling) can conflict with real-time load, which can be counterproductive without a CPU-based override.
- Rule: cron-based scale-down is always skipped if the recent real-time CPU is above the threshold, and the reason is left in the execution results.
- Even if you expand the EOA based on the chain plugin, the new role will not appear on the screen unless you also increase the API response/dashboard type.
- Rule: When a role is added to `eoaRoles`, `eoa-balance-monitor` → `/api/metrics` → `page.tsx` type/rendering is synchronized in one change set.
- The container tags in the create-l2-rollup example may be inconsistent with the latest op-deployer output.
- Rule: When L2 bootstrap fails, check the `op-node/op-geth` version and `rollup-rpc` port (8547 vs 9545) consistency first, and when changing genesis, initialize the data volume with `docker-compose down -v`.
- Even if a chain plugin is added, if the registry does not make selections based on environment variables, the new plugin will never be activated in actual operation.
- Rule: When adding a new plugin, include the optional branch of `registry` (`CHAIN_TYPE`) and corresponding tests in the same change set.
- OP Stack series chains have mostly the same components/dependencies/playbooks.
- Rule: Differences by chain focus on `chain metadata (l1/l2 chain, display name, chain id)`, and common topologies are reused to reduce duplication.
- In complex API routes, the actual HTTP smoke route catches regression faster than unit mocking.
- Rule: `/api/*` At least one core endpoint starts the server + maintains the actual curl verification script.
- If the installation script does not know the new feature, the operator cannot set it up even if there is runtime support.
- Rule: When a parent option such as chain/orchestrator is added, the `install.sh` prompt, non-interactive env validation, and `.env.local` output are updated together.

## 2026-02-19

- When list-type data accumulates on a dashboard card, the card itself expands and the layout collapses.
- Rule: Like logs/components, incremental data fixes the card height and applies `overflow-y-auto` only to the inner area.
- In a flex layout, if the right text area does not use up all the remaining space, lines will wrap faster than expected.
- Rule: The detailed text area specifies `flex-1 min-w-0`, and the surrounding badge separates `shrink-0`/`min-w-0` to maximize the actual usable width.
- If there are many left fixed-width columns in a single-line log, the right-side analysis text is structurally compressed.
- Rule: If it is necessary to secure the right area, reduce the width of the left column first, and merge auxiliary icons into the right meta area instead of a separate column.
- If space utilization is a priority in the log UI, floating rows based on `flex-wrap` are more stable than fixed column sorting.
- Rule: When readability and information density are more important than alignment consistency, select line-by-line fluid layout as the default.
- If the seed scenario TTL is shorter than the agent-loop period, the injection load may not be reflected in the scaling loop.
- Rule: The seed TTL for verification is maintained beyond the agent-loop cycle, and the seed API TTL and state storage TTL are set to be the same.
- `currentVcpu` in the seed data may be for observation purposes only, so using it as is for execution decisions will result in misjudgments.
- Rule: `currentVcpu` for auto-scaling execution judgment is calculated based on the actual runtime state (k8s/scaler state).

## 2026-02-16

- Reinitialization of common variables in branching logic easily overwrites the parent branch value.
- Rule: Paths with different meanings, such as `seed/live`, separate calculation functions and minimize reallocation of shared variables.
- Reducing the runtime contract with type assertions (`as`) hides the defect.
- Rule: For core domains such as scaling tier, create a common type alias and use the same type in all sections.
- The same external RPC call pattern must have a unified timeout/retry policy.
- Rule: Forces a common fetch utility or the same timeout policy for both API/agent-loop.
- The metadata (`source`) of the observation API must match the actual data path (seed/live).
- Rule: Do not hardcode the response field, and set the value derived from the branch result as a single variable.
- For authentication-exempted paths, exact path matching is safer than prefix matching.
- Rule: Sensitive middleware exceptions use exact allowlist as the default instead of `startsWith`.

## 2026-02-20

- Reproducible verification is difficult with just the expression “executed” in the local chain guide.
- Rule: The chain execution document must specify the `eth_chainId`, `eth_blockNumber`, `eth_syncing`, `zks_L1BatchNumber` commands and the passing criteria (expected value/range).
- The speed of responding to a problem largely depends on whether the confirmation sequence for each symptom is documented.
- Rule: Troubleshooting in the execution/operation guide is written in a four-stage structure: ‘Symptom -> Check command -> Cause -> Action.’
- If network call failure is left to the original error in the verification script, user readability is reduced.
- Rule: `curl` failure is caught in the wrapper function, standardized and output in the form of `FAIL + call target (url/method)`.
- When expanding the chain, if the API returns OP-only fields as default, the UI isolation principle is immediately broken.
- Rule: `/api/metrics` conditionally creates fields based on `plugin.capabilities`, and the dashboard renders sections only with the same capabilities.
- In a topology where multiple components are embedded in a single container, such as `server-v2`, status collection fails if there is no service name mapping.
- Rule: If the plug-in component and runtime service are different, leave a `dockerServiceName` mapping field and enable overriding with an environment variable.
- If you directly reference an external reference repo through the runtime path, reproducibility and deployment stability will be poor.
- Rule: `external/*` is only for analysis/reference purposes, and the actual interconnection contract is extracted and managed with the `examples/*` template.
