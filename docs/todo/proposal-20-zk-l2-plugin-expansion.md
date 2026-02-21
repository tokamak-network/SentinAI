# Proposal 20: ZK Stack / ZK-based L2 plugin expansion plan

> **Created date**: 2026-02-20
> **Status**: Planning
> **Prerequisite**: Maintain `src/chains` plugin system (Thanos/Optimism)

---

## 1. Goal

SentinAI's chain plugin system has been expanded to support the following categories of networks:

- **ZK Stack series**: ZKsync Stack based chain
- **General ZK L2 series**: ZK rollup, not OP Stack, such as Scroll, Linea, Polygon zkEVM, etc.

The core goal is to “extend the support chain by simply adding plugins without forking code.”

### 1.1 Operating Principle: Strict Chain Isolation

Operator experience is completely separated by chain.

- OP-only information is not exposed on the ZK operator screen.
- ZK-specific information is not exposed on the OP operator screen.
- Instead of overusing “Unsupported items N/A”, the section itself is not rendered.
- Integration is performed only at the backend plug-in architecture level, and the UI is provided through a chain-specific console.

### 1.2 Reflection of ZKsync official document analysis (2026-02-20)

Based on the ZKsync document, the following facts are reflected in Proposal 20.

- ZK Stack main components: `ZKsync OS`, `ZKsync OS Server(Sequencer)`, `Airbender Prover`, `Explorer`, `Portal`, `Fee Withdrawer`
- ZKsync OS architecture: separation of execution/proving + compilation of a single Rust codebase to `x86 (execution)` / `RISC-V (proof)`
- OS Server core subsystem: `Sequencer`, `RPC API`, `Batcher (batch/proof/L1 submission path)`
- Gateway: settlement/aggregation layer optionally used in the ZKsync chain (rollup/validium)
- Current note in the document: `zkstack` CLI quickstart has a path called "ZKsync OS not reflected (legacy EraVM chain)"

Therefore, when implemented, the `zkstack` plugin does not have a single mode, but sets **`legacy-era` / `os-preview` operating mode separation** as the default policy.

---

## 2. Scope

### 2.1 In Scope

- `ChainPlugin` interface extension (minimum items required)
- Definition of ZK series common meta/probe model
- Implement one type of `zkstack` plugin first
- Added ZK universal template plugin (`zkl2-generic`)
- Verification of `/api/metrics`, `/api/health`, `/api/scaler` compatibility
- Dynamic dashboard network notation/component display

### 2.2 Out of Scope (Excluding Phase 1)

- Supports all advanced sequencer internal metrics for each chain
- Fully differentiated automatic remediation playbook for each chain
- Multi-chain simultaneous collection orchestrator

---

## 3. Current structure and gap

Current strengths:

- Existence of plugin registry based on `src/chains`
- `CHAIN_TYPE` based loading possible
- Common path verification completed on Thanos/Optimism

Current Gap:

- Lack of standardization of ZK chain-specific metrics (proof delay, batch posting delay, finality signal)
- Modules with remaining OP Stack assumptions may exist
- Document/environment variable templates focus on OP series

---

## 4. Target architecture

### 4.1 Plugin layer

```text
src/chains/
  types.ts
  registry.ts
  thanos/
  optimism/
zkstack/ # New: ZK Stack only (legacy-era / os-preview mode)
zkl2-generic/ # New: ZK L2 common template
```

### 4.2 Metric Profile

Unify chain plugins to declare the profile below.

- `execution`: block height, block time, txpool
- `settlement`: L1 posting lag, finalized/verified status
- `proof`: proof generation lag, proof queue depth (only available chains)

Unsupported items allow `null` + render `N/A` in the UI.

`zkstack` plugin addition rules:

- `execution` is basic required
- `settlement` is active when the batcher/L1 submission path is confirmed.
- `proof` is active only when prover integration is confirmed

### 4.3 UI rendering rules (required)

- The UI renders only the sections declared in `plugin.capabilities`.
- Hide sections without capabilities (prohibit inactive/N/A cards).
- The API returns only schemas that fit the chain type (ZK return of OP-only fields is prohibited).
- Action buttons (`scale`, `restart`, `failover`) are exposed only when both capability + chain guard are satisfied.

---

## 5. Implementation Phase (Phase Plan)

### Phase 1: Interface reinforcement (0.5~1 day)

1. Add capability declaration to `ChainPlugin`
2. Addition of optional probe contract exclusively for ZK
3. Add `chainMode` field (`legacy-era` | `os-preview` | `generic`)
3. Fixed regression in existing Thanos/Optimism plugin

Output:

- Updated `src/chains/types.ts`
- `src/chains/*` compile/test passed

### Phase 2: `zkstack` plugin implementation (1-2 days)

1. `src/chains/zkstack/index.ts` 생성
2. Define env mapping rules (`CHAIN_TYPE=zkstack`)
3. Add mode branch:
- `ZKSTACK_MODE=legacy-era` (default)
   - `ZKSTACK_MODE=os-preview`
4. Connect metrics adapter (maintain `/api/metrics` path)
5. Reflection of ZK capability in health calculation

Output:

- `src/chains/zkstack/*`
- `src/chains/__tests__/zkstack-plugin.test.ts`

### Phase 3: `zkl2-generic` template implementation (1 day)

1. Common plugins compatible with Scroll/Linea/Polygon zkEVM
2. Separate minimum required env and optional env
3. Specify override points for each chain

Output:

- `src/chains/zkl2-generic/*`
- Updated sample env document

### Phase 4: API/UI integration inspection (1 day)

1. Check `/api/metrics`, `/api/health`, `/api/scaler` chain independence
2. Dashboard label/component name capability-based rendering arrangement
3. Strict Chain Isolation Verification (No other chain information exposed)

Output:

- Regression testing + snapshot updates

### Phase 5: Reflection of dashboard UI basic design (1 day)

1. Definition of dedicated IA (Information Architecture) for each chain
2. Confirm the boundaries of common components + chain-specific components
3. Unification of operator action flow (confirmation/guard/execution/audit log)

Output:

- `Dashboard UI Basic Design` section confirmed
- List/priority of components to be implemented

### Phase 6: Verification of operational path (0.5 days)

1. Check local execution in `legacy-era` mode (`zkstack` CLI quickstart path)
2. Check `os-preview` mode metric mapping (only support fields are exposed)
3. Verification of settlement card exposure depending on whether gateway is used (`on`/`off`)

Output:

- Compatibility matrix document for each mode

---

## 6. Environmental variable design

commonness:

- `CHAIN_TYPE=zkstack | zkl2-generic`
- `L2_RPC_URL=...`
- `L1_RPC_URLS=...`

ZK selection:

- `ZKSTACK_MODE=legacy-era|os-preview` (default: `legacy-era`)
- `ZK_PROOF_RPC_URL=...` (optional)
- `ZK_BATCHER_STATUS_URL=...` (optional)
- `ZK_FINALITY_MODE=confirmed|finalized|verified`
- `ZK_SETTLEMENT_LAYER=l1|gateway` (default: `l1`)

principle:

- Start with at least 2 required (`CHAIN_TYPE`, `L2_RPC_URL`)
- The server/dashboard should not fail even if the rest is empty.
- `CHAIN_TYPE` is fixed per workspace (runtime user toggle prohibited)
- Even if `ZKSTACK_MODE` is `os-preview`, unsupported probes are automatically disabled.

---

## 7. Dashboard UI basic design (Strict Chain Isolation)

### 7.1 Information Architecture (IA)

Common Frames:

1. `Overview` tab: Chain common core status
2. `Execution` tab: Execution layer status
3. `Settlement` tab: L1 settlement/posting status
4. `Incidents` tab: Anomaly detection/RCA timeline
5. `Actions` tab: Executable operational actions + recent execution history

Branch by chain:

- OP Stack: `Sequencer / Batcher / Proposer` central panel
- ZK L2s: `Sequencer / Prover / Proof Queue / Verification` center panel

### 7.2 Screen components

Common components:

- `NetworkHeader`: chain name, health, latest block, sync
- `HealthScoreCard`: 0-100 score + change trend
- `IncidentTimeline`: severity, domain(execution/settlement/proof), ack 상태
- `ActionPanel`: Only exposed actions allowed by chain

OP-only components:

- `BatchSubmissionStatusCard`
- `ProposerWindowCard`

ZK-specific components:

- `ProofGenerationLagCard`
- `ProofQueueDepthCard`
- `VerificationFinalityCard`
- `BatcherToSettlementCard` (L1/Gateway submission status)

### 7.3 User flow

1. Check `CHAIN_TYPE` of workspace when logging in/connecting.
2. Mount only chain-specific navigation/components
3. When an abnormality occurs, check the cause/effect range in ‘Incidents’
4. In `Actions`, only actions that pass the chain-guard are executed.
5. All actions are recorded in the audit log (`who/when/what/result`)

### 7.4 Availability/Usability Guard

- Apply schema-level validation to prevent incorrect chain field parsing
- In case of probe failure, only the relevant card is degraded (prohibiting failure from propagating to the entire page)
- Preflight check (permissions, cooldown, state consistency) required before executing action
- On mobile (360px), 3 key status/incident/action areas are exposed first
- Warning banner when detecting mode mismatch (`legacy-era` vs `os-preview`) + automatic readonly

---

## 8. Test/Gate

### Unit

- Plugin loading/metadata testing
- Capability matrix test
- Fallback/null metric processing test

### Integration

- `CHAIN_TYPE=zkstack`로 `/api/metrics` smoke
- `CHAIN_TYPE=zkl2-generic`로 `/api/health` smoke
- `CHAIN_TYPE=zkstack,ZKSTACK_MODE=legacy-era` smoke
- `CHAIN_TYPE=zkstack,ZKSTACK_MODE=os-preview` smoke
- ZK-only field unexposed verification in OP mode
- Non-exposed verification of OP-only fields in ZK mode

### Reflection on Production Gate

- Tier 1: lint/type/build
- Tier 2: Lighthouse (existing)
- Tier 3: coverage/e2e/bundle/cwv (existing)

New plugin merge conditions:

- Plugin test 90%+ pass
- 0 existing OP chain regressions

---

## 9. Risk and response

- Risk: RPC specification deviation by chain
- Response: Remove strict dependency with capability + optional probe
- Risk: Fields for each mode change rapidly due to changes in ZKsync documentation/release.
- Correspondence: plugin version tag + weekly compatibility test
- Risk: UI strongly assumes OP metrics
- Response: Branching of display conditions + N/A strategy unification
- Risk: operator oversetting/omitting env
- Response: Provide config validation summary log at boot time

---

## 10. Task checklist

- [ ] `ChainPlugin` capability expansion
- [ ] Added `chainMode` (`legacy-era`/`os-preview`/`generic`) contract.
- [ ] `zkstack` plugin implementation
- [ ] `zkl2-generic` plugin implementation
- [ ] API path compatibility verification (`metrics/health/scaler`)
- [ ] `ZK_SETTLEMENT_LAYER` (`l1`/`gateway`) branch reflection
- [ ] Strict Chain Isolation UI applied (other chain information not exposed)
- [ ] `.env.local.sample` + `docs/guide/ENV_GUIDE.md` 갱신
- [ ] Add plugin unit/integration tests
- [ ] Pass through Tier 1~3 gates

---

## 11. Definition of Done

- Local operation with `CHAIN_TYPE=zkstack` + Normal response from major APIs
- Local operation with `CHAIN_TYPE=zkl2-generic` + Normal response from major APIs
- `legacy-era` / `os-preview` modes of `zkstack` each passed smoke
- No regression on existing `thanos` and `optimism`
- ZK information is not exposed to UI/API in OP mode
- OP information is not exposed to UI/API in ZK mode
- Operational documentation (environmental variables/test guide) updated completed
- Pass CI gate (Tier 1~3)
