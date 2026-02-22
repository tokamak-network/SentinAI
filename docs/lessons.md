# Lessons Learned

## 2026-02-22

- 자율 에이전트 데모는 실행 알고리즘 설명보다 사용자가 바로 보는 상태 요약(엔진/큐/가드레일)이 먼저 있어야 인지율이 높다.
- Rule: For autonomy dashboard demos, always expose `engine state + queue state + guardrail state + one-click demo actions` in one panel before deep logs.
- 대시보드 사용 가이드는 UI 설명만으로 끝내면 실제 운영에서 인증/모드 제약 때문에 즉시 막히기 쉽다.
- Rule: For dashboard operation docs, always include `UI control -> API endpoint -> auth requirement -> environment mode constraints` mapping in one table.
- 정책 레벨 제어 UI는 상태 반영 지연이나 동시 실행이 있으면 사용자가 변경 실패로 오해하기 쉽다.
- Rule: Runtime policy controls in dashboards must lock concurrent actions, show per-action in-progress state, and expose current thresholds next to level selection.
- 자율 레벨은 버튼 라벨만으로 의미 전달이 어렵고, 운영자마다 해석이 달라진다.
- Rule: For autonomy-level controls, attach level-specific `permission + guardrail` tooltip/help text next to each action button.
- 대시보드 e2e에서 정책 변경 성공 경로를 검증하려면 클라이언트 공개 키와 서버 관리자 키를 같은 테스트 컨텍스트로 주입해야 한다.
- Rule: UI e2e for policy-write flows must provision both `NEXT_PUBLIC_*` and server auth env in the Playwright webServer command to avoid false unauthorized paths.
- 운영 가이드에서 신규 운영 방식만 설명하면 기존 방식 대비 이점/제약이 불명확해 도입 판단이 늦어진다.
- Rule: For operational migration docs, add a side-by-side comparison table of current vs target workflow with safety and scope differences.
- 지원 체인 정책이 모호하면 운영자가 지원 범위를 넘는 환경에서도 같은 절차를 시도해 장애 대응 시간을 낭비하게 된다.
- Rule: In ops guides, pin supported chain policy with explicit status (`recommended`, `disabled`) and a concrete 기준일.
- 운영 프롬프트 예시에 내부 tool 이름을 직접 노출하면 사용자가 기능명을 외워야 해서 실사용 진입 장벽이 높아진다.
- Rule: In user-facing prompt examples, prefer intent-based natural language and reserve tool/method names for protocol/debug sections only.
- 계획 문서에 “향후 작성될 문서 경로”만 남기고 스텁을 만들지 않으면 참조 경로 품질이 빠르게 떨어진다.
- Rule: If a proposal references future docs paths, create draft stub docs immediately (or avoid path-like syntax) to keep reference integrity.
- 설정 가이드와 운영 가이드를 분리 유지하면 신규 사용자가 중간 전환에서 경로를 잃기 쉽다.
- Rule: For operator-facing protocol docs, maintain one canonical guide that covers setup, operations, and troubleshooting; keep old docs as redirect stubs.
- 고권한 자동복구는 실행 가능 여부보다 권한 경계 설계가 먼저 고정되지 않으면 위험하다.
- Rule: `sudo`가 필요한 AI 액션은 직접 셸 실행을 금지하고 `Policy Engine -> Action Broker -> Allowlisted Wrapper -> Post-Verification -> Auto-Rollback` 체인으로만 허용한다.
- 운영 이슈 문서는 “문제 목록”만 있으면 온콜 시 바로 실행하기 어렵다.
- Rule: 운영 이슈 정리 문서는 반드시 `우선순위 + 탐지 신호 + 즉시 대응 + 근본 해결/자동화`를 같은 표에 고정한다.
- 클라이언트 분석 없는 운영 자동화 문서는 공통론에 머물러 실제 구현 우선순위가 흐려진다.
- Rule: 다중 클라이언트 운영 문서는 각 프로젝트의 `최신 릴리즈 스냅샷 + 공식 운영 특성 + 자동화 반영 항목`을 한 표로 연결해 근거 기반으로 작성한다.
- 운영 문서에서 특정 구현체 제외 요청이 들어오면 기존 범위를 유지한 채 추가만 하면 초점이 흐려진다.
- Rule: 특정 클라이언트 제외 요청 시 섹션 제목/매트릭스/체크리스트를 동시에 재작성해 범위와 실행 대상을 명시적으로 재고정한다.
- L1 클라이언트 운영 문서는 공통 자동화 항목만으로는 실제 장애 패턴(포크/동기화 편차/DB 압박)을 충분히 커버하지 못한다.
- Rule: 이더리움 L1 운영 문서는 반드시 `클라이언트 전용 자동화 항목(업그레이드, 교차검증, EL-CL 연계, 복구)`과 `클라이언트별 운영 포인트`를 함께 명시한다.
- L1 RPC 변수를 단일 경로로 재사용하면 모니터링 RPC 장애가 L2 노드 failover 정책에 의도치 않게 전파된다.
- Rule: L1 RPC 설정은 `SentinAI 내부 조회용`과 `L2 노드 failover pool`을 별도 env/함수 경로로 분리하고, 각 호출부에서 목적에 맞는 resolver만 사용한다.
- 운영 자동화 개념 정리는 요소 나열만으로는 구현팀이 바로 착수하기 어렵다.
- Rule: 운영 자동화 문서는 반드시 `기술 요소 + DoD + KPI + 단계별 우선순위`를 한 문서에 함께 고정한다.
- 지표가 풍부한 문서는 실행 방향이 불명확하면 실제 점유율/운영비 개선으로 이어지지 않는다.
- Rule: 시장/운영 전략 문서는 `관측 기능`보다 `행동 파이프라인(전환/검증/롤백/운영가드)`을 먼저 고정하고, 지표는 결과 검증 보조로만 둔다.
- 전략 문서를 구현으로 넘길 때 이슈 단위에 파일/AC/테스트가 없으면 팀마다 해석이 달라진다.
- Rule: 전략 문서의 첫 실행 단계(Phase 0)는 반드시 `Issue ID + 대상 파일 + 의존성 + Acceptance Criteria + 테스트 케이스`까지 고정한 분해 문서를 함께 만든다.
- 전략 문서에서 외부 지표를 재사용할 때 수집 시점이 없으면 실행팀이 최신성 논쟁으로 시간을 소모한다.
- Rule: 외부 네트워크/점유율 지표는 반드시 `출처 + 측정일(YYYY-MM-DD) + 산식(예: top3 합계)`를 함께 남긴다.
- 선언문(메시지) 기반 요구는 제품팀이 바로 실행하기 어렵다.
- Rule: 메시지형 전략 요청은 `명제 -> 기능 백로그 -> KPI 트리 -> 단계별 DoD` 순서로 강제 변환해 문서화한다.
- 인프라 확장 문서는 추상 목표만 나열하면 구현 단계에서 의사결정 공백이 생긴다.
- Rule: L1/L2 운영 보완 제안서는 모든 갭 항목에 `현재 코드 근거 파일`, `우선순위`, `DoD`를 함께 고정해 구현자가 추가 결정을 하지 않도록 작성한다.
- Full-autonomy requests become actionable only when decomposed into capability backlog + single focused proposal.
- Rule: For autonomous-agent roadmap work, keep one proposal per core capability (goal generation, orchestration, policy, learning) and attach file-level deliverables before implementation.
- Goal signal fusion across metrics/anomaly/failover/cost/memory is fragile if one source failure aborts the entire snapshot.
- Rule: Autonomous signal collectors must apply per-source fallback defaults and still emit a schema-complete snapshot for deterministic downstream scoring.
- Optional LLM enhancement on top of deterministic rules can silently degrade if provider/key/JSON parsing fails.
- Rule: Candidate generation always returns rule-based results first, then applies LLM text enhancement as best-effort only (fail-open to rule output).
- Priority queues drift in operator trust when ordering is not deterministic on equal/close scores.
- Rule: Goal queue ordering must use stable tie-breakers (score -> risk -> enqueue time -> id) and suppression reason codes must be persisted for audit.
- New autonomy subsystems must never break the core scaling loop on partial failure.
- Rule: Agent-loop integrations for optional autonomy modules (goal manager, dispatch) run as best-effort and degrade gracefully without failing the main cycle.
- Deterministic autonomy evaluation should include both planning outcomes and pre-planning goal-generation quality checks.
- Rule: Extend replay scorecards with synthetic goal-signal scenarios that validate suppression rules (duplicate, low-confidence, stale) to prevent noisy autonomous dispatch.
- Queue-based autonomy execution becomes unsafe without lease/idempotency/retry boundaries when workers or requests overlap.
- Rule: Autonomous dispatch must enforce lease + idempotency + bounded retry + DLQ, and expose replay as an explicit operator action.
- A single static policy gate is insufficient once autonomy expands into risk-tiered write actions.
- Rule: Goal execution policy should combine autonomy level (A0-A5), risk tier, and confidence thresholds, with runtime-tunable policy state and audited API updates.
- Learning loops should be episode-first to avoid coupling policy tuning directly into hot paths.
- Rule: Record selection/execution episodes online, but run policy-threshold suggestion offline and require explicit operator promotion of suggested values.
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

## 2026-02-20 (추가)

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
