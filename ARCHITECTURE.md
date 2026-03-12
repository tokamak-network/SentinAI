# SentinAI Architecture

Last updated: 2026-02-24  
Scope: This document reflects the current implementation in `main` (not historical proposals).

---

## 1. System Overview

SentinAI is a Next.js 16 full-stack control plane for L2 operations:
- HTTP APIs and dashboards (`src/app`, `src/app/api`)
- Background agent orchestration (`src/lib/scheduler.ts`, `src/core/agent-orchestrator.ts`)
- Stateful operations and policy guards (`src/lib/redis-store.ts`, `src/lib/policy-engine.ts`)

Core operational goals:
- Observe L1/L2 + infrastructure health
- Detect anomalies and notify operators
- Decide and execute scaling/remediation safely
- Expose a controlled MCP surface for external AI clients

---

## 2. Runtime Topology

```text
                         ┌─────────────────────────────┐
                         │        Next.js Server       │
                         │ (App Router + API routes)   │
                         └──────────────┬──────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
          ▼                             ▼                             ▼
  HTTP APIs (/api/*)            Scheduler Runtime              Public UI Pages
  - metrics/health/scaler        - agent orchestrator           - dashboard
  - anomalies/remediation         - watchdog (30s)              - status/docs
  - goals/goal-manager            - snapshot (5m)
  - mcp/policy/ai-routing         - report (daily)
                                  - scheduled scaling (hourly)
```

Startup hook:
- `src/instrumentation.ts` calls `initializeScheduler()` on Node runtime startup.

---

## 3. Chain Plugin Layer

Chain-specific behavior is encapsulated by `ChainPlugin`:
- Interface: `src/chains/types.ts`
- Registry: `src/chains/registry.ts`
- Implementations: `src/chains/thanos`, `src/chains/optimism`, `src/chains/zkstack`

Current default:
- `CHAIN_TYPE` unset/unknown -> `ThanosPlugin` (not Optimism by default).

Plugin-provided contracts:
- Component dependency graph
- K8s component naming and EOA role mapping
- L1/L2 viem chain configs
- AI prompt context fragments
- Chain-specific remediation playbooks

---

## 4. Core Execution Paths

### 4.1 On-Demand Metrics Path (`/api/metrics`)

Primary route:
- `src/app/api/metrics/route.ts`

Flow:
1. Collect latest L1/L2/block/mempool/component metrics
2. Persist time-series point via `metrics-store` (`pushMetric`)
3. Run anomaly pipeline (`runDetectionPipeline`)
4. Return composed operational snapshot (metrics + anomaly + component status)

Related modules:
- `src/lib/metrics-store.ts`
- `src/lib/detection-pipeline.ts`
- `src/lib/l1-rpc-failover.ts`
- `src/lib/eoa-balance-monitor.ts`

### 4.2 Agent Orchestrator (V2)

Primary modules:
- `src/core/agent-orchestrator.ts` — orchestrates 12 agents
- `src/core/agents/` — individual agent implementations
- `src/lib/scheduler.ts` — cron jobs + agent startup

**Agent Structure:**

**Pipeline** (sequential execution):
- `CollectorAgent` (5s interval) — collect L1/L2/K8s metrics
- `DetectorAgent` (10s interval) — anomaly detection (Z-score, AI semantic analysis)
- `AnalyzerAgent` (event-driven) — analyze root causes
- `ExecutorAgent` (event-driven) — execute remediation/scaling
- `RCADomainAgent` (event-driven) — domain-specific RCA
- `VerifierAgent` (event-driven) — post-execution verification

**Domain Agents** (parallel, interval-based):
- `ScalingAgent` (30s) — compute scaling decisions + execute K8s changes
- `SecurityAgent` (60s) — security audit + threat detection
- `ReliabilityAgent` (30s) — reliability checks + failover management
- `CostAgent` (5min) — cost optimization analysis
- `RemediationAgent` (event-driven) — execute remediation playbooks
- `NotifierAgent` (event-driven) — send alerts (Slack/webhook)

**Scheduler Cron Jobs** (separate from agents):
- Metrics snapshot: every 5min
- Daily report: `55 23 * * *` KST
- Scheduled scaling: hourly
- Pattern miner: `00 05 * * *` KST

**Enable Rule:**
- Agents auto-start when `L2_RPC_URL` is set.
- Override with `AGENT_LOOP_ENABLED=true|false` (legacy var, now controls orchestrator).
- All agents run in parallel; critical path (anomaly → remediation) completes in ~2s vs. V1's 60s serial cycle.

### 4.3 Heartbeat Watchdog + Auto-Recovery

Implemented in `src/lib/scheduler.ts`:
- Validates heartbeat freshness from Redis/in-memory store
- Detects stale/missing/invalid/read-write heartbeat failures
- Sends Slack/webhook alerts with cooldown
- Triggers recovery cycle attempts with independent cooldown

Health visibility:
- `/api/health` exposes `agentLoop.watchdog*` fields (`src/app/api/health/route.ts`)
- `/api/agent-loop` exposes scheduler/watchdog runtime state (`src/app/api/agent-loop/route.ts`)

### 4.4 Anomaly Pipeline (Layered)

Pipeline orchestrator:
- `src/lib/detection-pipeline.ts`

Layers:
1. Statistical detection: `src/lib/anomaly-detector.ts`
2. AI semantic analysis: `src/lib/anomaly-ai-analyzer.ts`
3. Alert dispatch: `src/lib/alert-dispatcher.ts`
4. Auto-remediation (optional): `src/lib/remediation-engine.ts`

Notes:
- Layer 1 is synchronous in request/cycle path.
- Layers 2-4 run asynchronously (best-effort, non-blocking).
- Remediation executes only when `AUTO_REMEDIATION_ENABLED=true`.

### 4.5 Scaling Pipeline

Decision:
- `src/lib/scaling-decision.ts` computes hybrid score using CPU/Gas/TxPool/AI severity.
- Current tier mapping supports `1/2/4/8 vCPU`.

Predictive assist:
- `src/lib/predictive-scaler.ts` uses AI prediction with rule-based fallback.

Execution:
- `src/lib/k8s-scaler.ts` for K8s or Docker mode
- Simulation mode supported (defaults from `DEFAULT_SIMULATION_CONFIG`)
- Optional zero-downtime orchestration via `src/lib/zero-downtime-scaler.ts`

### 4.6 Goal Management / Autonomous Dispatch

Modules:
- Runtime manager: `src/lib/goal-manager.ts`
- Durable orchestration: `src/lib/goal-orchestrator.ts`
- Planning/execution: `src/lib/goal-planner.ts`

Key properties:
- Signal collection -> candidate generation -> prioritization -> queueing
- Lease + idempotency + checkpoint + retry/backoff + DLQ replay
- Policy-gated execution via autonomy level/risk/confidence checks

### 4.7 MCP Control Plane

API entry:
- `src/app/api/mcp/route.ts`

Core server:
- `src/lib/mcp-server.ts`

Capabilities:
- Tool manifest exposure
- JSON-RPC invocation handling
- Policy enforcement for read/write tools
- API-key and approval-token modes
- Operational tools (metrics/anomalies/rca/plan/scale/restart/l1-rpc/proxyd diagnostics)

---

## 5. State Model and Persistence Boundaries

### 5.1 Unified State Store

Main abstraction:
- Interface: `src/types/redis.ts` (`IStateStore`)
- Implementations: `RedisStateStore` + `InMemoryStateStore` in `src/lib/redis-store.ts`
- Selector: `getStore()` chooses Redis when `REDIS_URL` exists, otherwise in-memory.

Persisted domains in `IStateStore` include:
- Metrics ring buffer
- Scaling state/history/simulation flags
- Prediction cache/records
- Anomaly events + alert config/history
- Usage tracker + daily accumulator
- Agent cycle history + heartbeat
- Agent memory/decision traces
- Goal queue/lease/checkpoint/DLQ/idempotency/learning episodes
- MCP approval tickets

### 5.2 Process-Local State (Non-Redis)

Some subsystems intentionally keep runtime-local state:
- Remediation execution/circuit history: `src/lib/remediation-store.ts`
- AI routing runtime scorecards/circuit states: `src/lib/ai-routing.ts`
- Zero-downtime swap state machine memory: `src/lib/zero-downtime-scaler.ts`

Implication:
- These states reset on process restart unless explicitly persisted elsewhere.

---

## 6. API Surface (Operational Domains)

Representative domain routes under `src/app/api`:
- Health/visibility: `health`, `agent-loop`, `public/status`
- Metrics/scaling: `metrics`, `metrics/seed`, `scaler`, `l1-failover`
- Detection/remediation: `anomalies`, `anomalies/config`, `rca`, `remediation`
- Goal/autonomy: `goals`, `goal-manager/*`, `policy/autonomy-level`
- AI routing + control plane: `ai-routing/*`, `mcp`
- Reporting/ops: `reports/daily/*`, `cost-report`, `savings-advisor`, `nlops`, `eoa-balance`

Middleware guard (`src/middleware.ts`):
- API key requirement for write routes (when configured)
- Read-only mode write blocking with explicit allowlist exceptions

---

## 7. AI Architecture

Unified client:
- `src/lib/ai-client.ts`

Provider strategy:
- Fallback order: Qwen -> Anthropic -> OpenAI -> Gemini
- Optional gateway routing via `AI_GATEWAY_URL`
- Task-class/policy-aware provider selection via `src/lib/ai-routing.ts`

Tier contract:
- `modelTier: 'fast' | 'best'` used by callers
- Actual provider/model may vary by routing policy and available keys

Failure behavior:
- Modules are expected to degrade gracefully on AI call failures (rule-based/default fallback).

---

## 8. Infrastructure Integration

### 8.1 Kubernetes / Docker Dual Execution

Scaler/operator modules support both modes:
- K8s path: `runK8sCommand` and StatefulSet/Pod operations
- Docker path: `docker-orchestrator` helpers

Relevant modules:
- `src/lib/k8s-config.ts`
- `src/lib/k8s-scaler.ts`
- `src/lib/docker-config.ts`
- `src/lib/docker-orchestrator.ts`

### 8.2 L1 RPC Failover and Proxyd

Module:
- `src/lib/l1-rpc-failover.ts`

Responsibilities:
- Health-check active endpoint
- Failover across `L1_RPC_URLS`
- Update L2 component envs after failover
- Optional Proxyd ConfigMap backend replacement + restart workflow

---

## 9. Security and Policy Controls

Primary controls:
- Middleware write-auth/read-only guard: `src/middleware.ts`
- MCP tool + approval policy checks: `src/lib/policy-engine.ts`
- Goal execution policy (autonomy level/risk/confidence): `src/lib/policy-engine.ts`
- Approval ticket issuance/consumption: `src/lib/approval-engine.ts`

Important mode flags:
- `NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE`
- `SENTINAI_API_KEY`
- `MCP_SERVER_ENABLED`, `MCP_AUTH_MODE`, `MCP_APPROVAL_REQUIRED`
- `SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY`

---

## 10. Repository Structure (Integrated)

### 10.1 Repository Tree

```text
SentinAI/
├── .claude/
├── .github/workflows/
├── .lighthouseci/
├── benchmark-results/
├── data/reports/
├── docs/
│   ├── archive/ brand/ done/ guide/ market/ roadmap/ spec/ todo/ verification/
├── e2e/
├── examples/
│   ├── opstack/
│   └── zkstack/
├── public/
├── scripts/
│   └── benchmark/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent-decisions/ agent-loop/ agent-memory/
│   │   │   ├── ai-routing/{policy,status}
│   │   │   ├── anomalies/config/
│   │   │   ├── cost-report/ eoa-balance/
│   │   │   ├── goal-manager/{dispatch,replay,tick}
│   │   │   ├── goals/ health/ l1-failover/ mcp/
│   │   │   ├── metrics/seed/ nlops/ policy/autonomy-level/
│   │   │   ├── public/status/ rca/ remediation/
│   │   │   ├── reports/daily/ savings-advisor/ scaler/
│   │   ├── docs/[[...slug]]/
│   │   ├── status/
│   │   └── v2/
│   ├── chains/{thanos,optimism,zkstack}/
│   ├── components/
│   ├── lib/
│   │   ├── __tests__/
│   │   │   ├── llm-stress-test/
│   │   │   └── scaling-accuracy/
│   │   └── utils/
│   └── types/
├── website/
├── .env.local.sample
├── AGENTS.md
├── ARCHITECTURE.md
├── CLAUDE.md
├── Dockerfile
├── README.md
├── docker-compose.yml
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── vitest.config.ts
```

### 10.2 Runtime/Generated Directories (Normally Excluded from Source Review)

```text
node_modules/
.next/
coverage/
test-results/
.tmp-venv/
```

### 10.3 Major Directories and When to Modify

| Path | Role | Typical Change Trigger |
|---|---|---|
| `src/app` | Next.js App Router entrypoints (pages/layout/routes) | New page, route behavior changes |
| `src/app/api` | Operational and control APIs | Health/scaling/goal/MCP API updates |
| `src/lib` | Core runtime logic | Automation policy, scheduler/agent, failover, safety logic |
| `src/lib/__tests__` | Vitest test suites | Regression coverage for core logic changes |
| `src/components` | Dashboard/UI components | UI layout or interaction changes |
| `src/types` | Shared contracts | API/domain schema changes |
| `src/chains` | Chain plugins | Chain-specific behavior/configuration changes |
| `scripts` | Operations/verification scripts | New operational checks, automation helpers |
| `docs` | Guides/specs/proposals/reports | Runbook/spec/process documentation updates |
| `e2e` | Playwright tests | End-to-end scenario regression checks |
| `examples` | Example setups | OP Stack / ZK Stack example updates |
| `public` | Static assets | Images/icons/static resources |
| `data/reports` | Generated report outputs | Report generation and artifact path checks |

### 10.4 Key Root Files

| File | Role | Note |
|---|---|---|
| `README.md` | Project overview and quick start | First entry for contributors |
| `ARCHITECTURE.md` | Architecture + repository structure source of truth | Update with runtime/structure changes |
| `AGENTS.md` | Repo working rules for coding agents | Task/verification conventions |
| `.env.local.sample` | Environment variable template | Must update when config surface changes |
| `package.json` | Scripts and dependency graph | Runtime/test tooling entrypoints |
| `next.config.ts` | Next.js runtime/build settings | Build/routing/runtime behavior changes |
| `tsconfig.json` | TypeScript compiler policy | Type safety constraints |
| `vitest.config.ts` | Unit test configuration | Test scope/environment changes |
| `playwright.config.ts` | E2E test configuration | Browser test policy/environment |
| `Dockerfile` | Container image build definition | Deployment image changes |
| `docker-compose.yml` | Multi-service local/ops orchestration | Local stack orchestration changes |
| `CLAUDE.md` | Supplemental project operation/dev guide | Internal operational conventions |

---

## 11. Design Tradeoffs (Current)

1. Hybrid persistence model:
- Strong Redis-backed state for core operations
- Some runtime-local stores kept intentionally lightweight

2. Safety over aggressiveness:
- Cooldowns, policy gates, and approval requirements before risky writes
- Best-effort async analysis/remediation to avoid blocking core loops

3. Plugin-first chain abstraction:
- Chain details isolated in plugin modules
- Core pipelines remain chain-agnostic

4. Operational observability:
- Health endpoints expose scheduler/watchdog/agent cycle state
- Public status endpoint provides sanitized SLA-style visibility

---

## 12. Quick File References

- Scheduler + agent orchestrator: `src/lib/scheduler.ts`, `src/core/agent-orchestrator.ts`
- Agent implementations: `src/core/agents/` (Collector, Detector, Analyzer, Executor, Verifier, Scaling, Security, Reliability, Cost, Remediation, Notifier, RCADomain)
- Metrics API: `src/app/api/metrics/route.ts`
- Health API: `src/app/api/health/route.ts`
- Detection pipeline: `src/lib/detection-pipeline.ts`
- Scaling execution: `src/lib/k8s-scaler.ts`
- State store: `src/lib/redis-store.ts`, `src/types/redis.ts`
- Goal orchestration: `src/lib/goal-manager.ts`, `src/lib/goal-orchestrator.ts`
- MCP server: `src/lib/mcp-server.ts`, `src/app/api/mcp/route.ts`
- Policy guards: `src/lib/policy-engine.ts`, `src/middleware.ts`
