# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SentinAI (Autonomous Node Guardian)** — Monitoring and auto-scaling dashboard for L2 networks via modular chain plugins (default: Thanos).

Real-time web UI with L1/L2 block monitoring, K8s integration, AI-powered log analysis, anomaly detection, root cause analysis, NLOps chat interface, and hybrid auto-scaling engine.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3002
npm run build        # Production build (Turbopack)
npm run start        # Production server
npm run lint         # ESLint check

```

### Testing (Vitest)

```bash
npm run test                          # Watch mode
npm run test:run                      # Single run (CI)
npm run test:coverage                 # Coverage report (src/lib/**)
npx vitest run src/lib/__tests__/k8s-scaler.test.ts   # Run single test file
npx vitest run -t "test name"         # Run specific test by name
```

Tests: `src/lib/__tests__/*.test.ts` (51+ files). Coverage scoped to `src/lib/**/*.ts`.

### E2E Verification (Cluster)

```bash
npm run verify                       # Full 6-phase cluster verification
bash scripts/verify-e2e.sh --phase 2 # Run specific phase only
```

`scripts/verify-e2e.sh` runs against a live EKS + L2 RPC + AI Provider environment. Auto-starts dev server if not running.

### Model Benchmarking

```bash
npm run benchmark                                          # Run all providers, 3 iterations
npm run benchmark -- --providers qwen,anthropic           # Test specific providers
npm run benchmark -- --providers qwen --iterations 1      # Single iteration for quick test
npm run benchmark -- --output ./my-results                # Custom output directory
npm run benchmark -- --help                               # Show detailed help
```

Compares AI model performance using 5 real-world prompts (Predictive Scaler, Anomaly Analyzer, RCA Engine, Daily Report, NLOps). Generates Markdown reports in `benchmark-results/`. Requires at least one AI API key set (QWEN_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).

## Architecture

### Data Flow

```
                    ┌─────── Agent Loop (60s cron) ───────┐
                    │                                     │
L1/L2 RPC (viem) ──┼──→ /api/metrics ──→ MetricsStore    │
                    │        │              (ring buffer)  │
                    │        ▼                    │        │
                    │  page.tsx (UI)      /api/scaler      │
                    │        │              │              │
                    │        ▼              ▼              │
                    │  DetectionPipeline  ScalingDecision  │
                    │   (L1→L2→L3→L4)     │              │
                    │        │              ▼              │
                    │        ▼         K8sScaler ←────────┘
                    │   RCA Engine       (auto-execute)
                    │        │
                    │        ▼
                    │  RemediationEngine
                    └─────────────────────────────────────┘
```

**Agent Loop** (`agent-loop.ts`) — Server-side autonomous cycle every 60 seconds:
1. **Observe**: Collect L1/L2 metrics directly from RPC (no browser needed)
2. **Detect**: Run 4-layer anomaly detection pipeline (`detection-pipeline.ts`)
3. **Decide**: Calculate scaling score + predictive override
4. **Act**: Auto-execute scaling if conditions met (auto-scaling enabled, not in cooldown)

Enabled automatically when `L2_RPC_URL` is set. Override with `AGENT_LOOP_ENABLED=true|false`.

**L1 RPC Failover** (`l1-rpc-failover.ts`) — Automatic endpoint switching when L1 RPC quota is exhausted:
- Detects consecutive failures (≥3) in agent loop L1 calls
- Switches to next healthy endpoint from `L1_RPC_URLS` list
- Updates K8s components via `kubectl set env` (components determined by active ChainPlugin)
- 5-minute cooldown between failovers, URL masking in logs

### Core Subsystems

**Scaling Engine** — Hybrid scoring (0–100) = CPU 30% + Gas 30% + TxPool 20% + AI Severity 20%. Four tiers: Idle (<30, 1 vCPU), Normal (30–70, 2 vCPU), High (70–77, 4 vCPU), Emergency (≥77, 8 vCPU). 5-minute cooldown. Stress mode simulates 8 vCPU.
- `scaling-decision.ts` → `k8s-scaler.ts` (mode selection) → execution
- Scaling mode priority: **In-Place Resize** → Zero-Downtime Pod Swap → Legacy kubectl patch
- `predictive-scaler.ts`: AI time-series prediction via Fast Tier

**4-Layer Anomaly Detection** — Statistical → AI → Alert → Remediation pipeline:
1. `anomaly-detector.ts`: Z-Score detection (threshold: Z > 3.0)
2. `anomaly-ai-analyzer.ts`: AI semantic analysis (async)
3. `alert-dispatcher.ts`: Slack/Webhook dispatch. Events in `anomaly-event-store.ts` (in-memory).
4. Auto-remediation: Triggered when `AUTO_REMEDIATION_ENABLED=true`

**RCA Engine** — `rca-engine.ts` traces fault propagation using chain-specific dependency graph (from `ChainPlugin.dependencyGraph`). Example for Thanos:
```
L1 → op-node → op-geth
           → op-batcher → L1
           → op-proposer → L1
```

**Chain Plugin System** — Modular abstraction for multi-chain L2 support (`src/chains/`):
- `ChainPlugin` interface encapsulates all chain-specific knowledge
- `getChainPlugin()` returns the active plugin (defaults to Thanos)
- Components, dependency graphs, AI prompts, playbooks, K8s configs, EOA roles — all from plugin
- Supported chains: `thanos` (OP Stack, default), `optimism` / `op-stack` / `my-l2` (OP Stack alias), `zkstack` / `zksync` / `zk-stack` (ZK Stack), `arbitrum` / `arbitrum-orbit` / `nitro` (Arbitrum Orbit Nitro), `zkl2-generic` / `zkl2` / `scroll` / `linea` / `polygon-zkevm` / `zkevm` (Generic ZK L2)
- Adding new chain = 4 files in `src/chains/<chain>/` (index, components, prompts, playbooks)

**NLOps Chat** — Natural language operations interface:
- `nlops-engine.ts`: 9 AI function-calling tools (get_system_status, get_metrics, get_cost_report, get_anomalies, analyze_logs, run_rca, get_prediction, scale_node, update_config) + 7 intent types (query, analyze, rca, scale, config, explain, unknown)
- `nlops-responder.ts`: AI response generation via function-calling
- Dangerous actions (scale_node, update_config) require confirmation flow

**Cost & Reporting** — `cost-optimizer.ts` + `usage-tracker.ts` for vCPU cost tracking (AWS Fargate Seoul pricing). `daily-report-generator.ts` + `daily-accumulator.ts` for scheduled reports via `scheduler.ts`.

**AI Client** (`ai-client.ts`) — Unified AI interface. `chatCompletion()` single function for all AI calls.
- **Model tiers (auto-selected per provider):**
  - Fast Tier — Real-time anomaly detection, NLOps responses
  - Best Tier — RCA, daily reports, predictive scaling
- Priority: Module Override > Gateway (with fallback) > Qwen > Anthropic > OpenAI > Gemini
- Gateway 400/401 errors auto-fallback to Anthropic Direct
- All AI features have graceful degradation (service continues if AI fails)

**State Management** — InMemory default, Redis optional (`REDIS_URL`). `state-store.ts` abstract interface, `redis-store.ts` implementation. MetricsStore, scaling state, anomaly events reset on restart unless Redis configured.

### Scaling Modes

Execution priority in `k8s-scaler.ts` (first enabled mode wins):

1. **Simulation** — State-only, no K8s changes (`SCALING_SIMULATION_MODE=true`)
2. **In-Place Resize** (`k8s-scaler.ts`) — `kubectl patch pod --subresource resize`. Zero downtime, zero data loss, ~1-3s. Requires K8s 1.27+. Enabled by default; auto-disables if cluster doesn't support it.
3. **Zero-Downtime Pod Swap** (`zero-downtime-scaler.ts`) — Parallel Pod Swap with safety gates. Requires `updateStrategy: OnDelete`.
4. **Docker** — `docker update` for local dev
5. **Legacy** — `kubectl patch statefulset` rolling update

### Zero-Downtime Pod Swap

`zero-downtime-scaler.ts` — Parallel Pod Swap state machine:
```
idle → creating_standby → waiting_ready → [safety gates] → switching_traffic → cleanup → syncing_statefulset → completed
Any failure → rolling_back → failed
```

**Safety Gates** (between Phase 2 and Phase 3):
- **Block Sync Gate**: Compares `eth_blockNumber` of old vs standby pod. Aborts if gap > `ZERO_DOWNTIME_MAX_BLOCK_GAP` (default: 2 blocks).
- **TX Drain Gate**: Waits for old pod's `txpool_status` pending+queued to reach 0 before traffic switch. Non-blocking timeout (`ZERO_DOWNTIME_TX_DRAIN_TIMEOUT_MS`, default: 60s).
- **Rollback Retry**: On failure, retries rollback up to 3 times with exponential backoff.

### API Routes (`src/app/api/`)

| Route                            | Methods        | Purpose                                                |
|----------------------------------|----------------|--------------------------------------------------------|
| `metrics/route.ts`               | GET            | L1/L2 blocks, K8s pods, anomaly pipeline. `stress=true` → fast path |
| `metrics/seed/route.ts`          | POST           | Dev-only: inject mock data (stable/rising/spike/falling/live) |
| `scaler/route.ts`                | GET/POST/PATCH | Scaling state + AI prediction / execute / configure |
| `anomalies/route.ts`             | GET            | Anomaly event list                                     |
| `anomalies/config/route.ts`      | GET/POST       | Alert configuration                                    |
| `nlops/route.ts`                 | GET/POST       | NLOps chat (natural language operations)               |
| `rca/route.ts`                   | GET/POST       | Root cause analysis execution                          |
| `cost-report/route.ts`           | GET            | Cost optimization report                               |
| `reports/daily/route.ts`         | GET/POST       | Daily report generation and retrieval                  |
| `reports/daily/send/route.ts`    | GET/POST       | Send daily report via email/webhook                    |
| `reports/daily/view/route.ts`    | GET            | View daily report (HTML)                               |
| `eoa-balance/route.ts`           | GET/POST       | EOA balance status / manual refill trigger             |
| `health/route.ts`                | GET            | Docker healthcheck                                     |
| `mcp/route.ts`                   | GET/POST       | MCP tool execution endpoint                            |
| `l1-failover/route.ts`           | GET            | L1 RPC failover status                                 |
| `remediation/route.ts`           | GET/POST/PATCH | Remediation action execution and status                |
| `agent-loop/route.ts`            | GET            | Agent loop status and control                          |
| `agent-decisions/route.ts`       | GET            | Agent decision history                                 |
| `agent-memory/route.ts`          | GET            | Agent memory store                                     |
| `goal-manager/route.ts`          | GET            | Goal manager state                                     |
| `goal-manager/dispatch/route.ts` | POST           | Dispatch a new goal                                    |
| `goal-manager/replay/route.ts`   | POST           | Replay a past goal                                     |
| `goal-manager/tick/route.ts`     | POST           | Trigger goal manager tick                              |
| `goals/route.ts`                 | GET/POST       | Goal CRUD                                              |
| `ai-routing/policy/route.ts`     | GET/POST       | AI routing policy configuration                        |
| `ai-routing/status/route.ts`     | GET            | AI routing status                                      |
| `policy/autonomy-level/route.ts` | GET/POST       | Autonomy level configuration                           |
| `savings-advisor/route.ts`       | GET            | Savings advisor recommendations                        |
| `agent-fleet/route.ts`           | GET            | Agent fleet status (multi-instance)                    |
| `approval/route.ts`             | GET/POST       | Approval workflow for guarded actions                  |
| `auth/config/route.ts`          | GET            | Auth configuration                                     |
| `autonomous/*/route.ts`         | POST           | Autonomous ops (execute, plan, rollback, verify)       |
| `experience/route.ts`           | GET/POST       | Experience transfer store                              |
| `metrics/history/route.ts`      | GET            | Historical metrics                                     |
| `oauth/*/route.ts`              | GET/POST       | OAuth2 endpoints (authorize, register, token)          |
| `public/status/route.ts`        | GET            | Public status endpoint (no auth)                       |
| `subscription/route.ts`         | GET/POST       | Subscription management                                |
| `v2/*/route.ts`                 | Various        | V2 multi-instance API (instances, playbooks, fleet)    |

### Types (`src/types/`)

- `scaling.ts`: `ScalingMetrics`, `ScalingDecision`, `ScalingConfig`, `TargetVcpu` (1|2|4|8), `TargetMemoryGiB` (2|4|8|16), `AISeverity`
- `prediction.ts`: `PredictionResult`, `PredictionConfig`, `MetricDataPoint`
- `anomaly.ts`: `AnomalyResult`, `DeepAnalysisResult`, `AlertConfig`, `AnomalyEvent`
- `rca.ts`: `RCAResult`, `RCAEvent`, `RCAComponent`, `RemediationAdvice`
- `zero-downtime.ts`: `SwapPhase` (9 phases incl. `rolling_back`/`failed`), `SwapState`, `ZeroDowntimeResult`, `BlockSyncResult`, `TxDrainResult`
- `nlops.ts`: `NLOpsIntent`, `NLOpsResult`, `ChatMessage`
- `cost.ts`: Cost optimization types
- `daily-report.ts`: Daily report types
- `redis.ts`: `IStateStore` interface, Redis/InMemory implementations
- `eoa-balance.ts`: `EOARole`, `BalanceLevel`, `EOABalanceConfig`, `RefillResult`, `EOABalanceStatus`
- `l1-failover.ts`: L1 RPC failover types (endpoint, event, state)
- `remediation.ts`: Remediation action types
- `policy.ts`: Autonomy policy types
- `agent-cycle.ts`, `agent-memory.ts`, `agent-resume.ts`: Agent loop cycle/memory/replay types
- `goal-manager.ts`, `goal-planner.ts`, `goal-orchestrator.ts`, `goal-learning.ts`: Goal system types
- `autonomous-ops.ts`, `operation-control.ts`: Autonomous operations types
- `ai-routing.ts`: AI routing policy types
- `scheduled-scaling.ts`: Scheduled scaling types
- `notification.ts`: Notification routing types
- `mcp.ts`: MCP protocol types
- `pattern.ts`, `experience.ts`: Pattern mining and experience transfer types
- `billing.ts`, `subscription.ts`: Billing/subscription types
- `derivation.ts`: L2 derivation lag types

### UI

Single-page dashboard (`src/app/page.tsx`, ~2278 lines). All UI is inline — no components extracted to `src/components/`. Uses `AbortController` for high-frequency polling. NLOps chat panel integrated with `data-testid` attributes for test automation.

Browser UI testing guide: `docs/verification/dashboard-ui-testing-guide.md`

## Key Patterns

- **Import alias**: `@/*` → `./src/*`
- **Dual-mode**: Real K8s cluster data or mock fallback for development
- **Simulation mode**: `SCALING_SIMULATION_MODE=true` by default (no real K8s changes)
- **AI resilience**: Every AI feature has a non-AI fallback path (e.g., daily reports generate data-based fallback if AI fails)
- **Cost basis**: AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- **Ring buffer**: MetricsStore holds 60 data points with stats (mean, stdDev, trend, slope)
- **AI response parsing**: `ai-response-parser.ts` extracts structured JSON from AI text responses (handles markdown code blocks, partial JSON)

## Environment Variables

```bash
cp .env.local.sample .env.local   # Then edit
```

### Required

| Variable | Description |
|----------|-------------|
| `L2_RPC_URL` | L2 Chain RPC endpoint |
| AI API Key (one of) | `QWEN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` |
| `AWS_CLUSTER_NAME` | EKS cluster name (auto-detects K8S_API_URL & region) |

### AI Provider Priority

`ai-client.ts` auto-detects provider from env vars. Set only the API key — it connects to the official API server directly.

| Priority | Env Var | Provider | fast model | best model |
|----------|---------|----------|------------|------------|
| 0 | `AI_GATEWAY_URL` + Key | LiteLLM Gateway | (uses detected provider's model) | (uses detected provider's model) |
| 1 | `QWEN_API_KEY` | Qwen (OpenAI compatible) | `qwen3-80b-next` | `qwen3-80b-next` |
| 2 | `ANTHROPIC_API_KEY` | Anthropic Direct | `claude-haiku-4-5-20251001` | `claude-sonnet-4-5-20250929` |
| 3 | `OPENAI_API_KEY` | OpenAI Direct | `gpt-5.2` | `gpt-5.2-codex` |
| 4 | `GEMINI_API_KEY` | Gemini Direct | `gemini-2.5-flash-lite` | `gemini-2.5-pro` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `QWEN_BASE_URL` | DashScope | Qwen API endpoint (any OpenAI-compatible server) |
| `QWEN_MODEL` | auto | Override Qwen model name (e.g., `qwen3-235b-a22b`) |
| `OPENAI_BASE_URL` | api.openai.com | OpenAI-compatible endpoint (e.g., LiteLLM proxy) |
| `OPENAI_MODEL` | auto | Override OpenAI model name for both tiers (e.g., `qwen/qwen-turbo-latest`) |
| `OPENAI_MODEL_FAST` | — | Fast tier model override (takes priority over `OPENAI_MODEL`) |
| `OPENAI_MODEL_BEST` | — | Best tier model override (takes priority over `OPENAI_MODEL`) |
| `AI_GATEWAY_URL` | — | LiteLLM Gateway URL (overrides direct API when set) |
| `AWS_PROFILE` | — | AWS CLI profile for multi-account setups |
| `K8S_NAMESPACE` | `default` | Namespace where L2 pods are deployed |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (`app=op-geth`) |
| `K8S_API_URL` | auto-detect | Manual K8s API URL override |
| `K8S_INSECURE_TLS` | `false` | Skip TLS verification (dev only) |
| `REDIS_URL` | — | Redis state store (in-memory if unset) |
| `ALERT_WEBHOOK_URL` | — | Slack/Webhook URL for anomaly alerts |
| `COST_TRACKING_ENABLED` | `true` | vCPU usage pattern tracking |
| `SCALING_SIMULATION_MODE` | `true` | Simulate K8s changes without real patches |
| `SENTINAI_API_KEY` | — | API key for write endpoint auth (`x-api-key` header). Unset = no auth |
| `NEXT_PUBLIC_SENTINAI_API_KEY` | — | Client-side API key (must match `SENTINAI_API_KEY` for dashboard writes) |
| `NEXT_PUBLIC_NETWORK_NAME` | — | Network name shown in dashboard header (e.g., `Thanos Sepolia`) |
| `AGENT_LOOP_ENABLED` | auto | Server-side autonomous loop (auto-enabled if L2_RPC_URL set) |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 auto-remediation trigger |
| `BATCHER_EOA_ADDRESS` | — | Batcher EOA address to monitor |
| `PROPOSER_EOA_ADDRESS` | — | Proposer EOA address to monitor |
| `TREASURY_PRIVATE_KEY` | — | Treasury wallet private key for auto-refill (omit for monitor-only) |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | Critical threshold — triggers auto-refill |
| `EOA_REFILL_AMOUNT_ETH` | `0.5` | ETH amount per refill |
| **L1 RPC for SentinAI (Public)** | — | — |
| `L1_RPC_URLS` | — | Comma-separated **public** L1 RPC endpoints for SentinAI (auto-failover, priority order) |
| `SENTINAI_L1_RPC_URL` | publicnode.com | Single **public** L1 RPC endpoint for SentinAI monitoring (fallback if `L1_RPC_URLS` not set) |
| **L1 RPC for L2 Nodes (via Proxyd)** | — | — |
| `L1_PROXYD_ENABLED` | `false` | Enable Proxyd ConfigMap update for L1 failover (L2 nodes: op-node, op-batcher, op-proposer) |
| `L1_PROXYD_CONFIGMAP_NAME` | `proxyd-config` | ConfigMap name containing Proxyd config (for L2 nodes) |
| `L1_PROXYD_DATA_KEY` | `proxyd.toml` | Data key in ConfigMap holding TOML config |
| `L1_PROXYD_UPSTREAM_GROUP` | `main` | Upstream group name to update in TOML |
| `L1_PROXYD_UPDATE_MODE` | `replace` | Update strategy: `replace` (update URL) or `append` (add new upstream) |
| `L1_PROXYD_SPARE_URLS` | — | Comma-separated spare RPC URLs for 429 backend auto-replacement |
| `K8S_STATEFULSET_PREFIX` | `sepolia-thanos-stack` | StatefulSet name prefix for L1 failover kubectl updates (for L2 nodes) |
| **Scaling Modes** | — | — |
| `SCALING_COOLDOWN_SECONDS` | `300` (dev: `10`) | Cooldown between scaling events |
| `ZERO_DOWNTIME_MAX_BLOCK_GAP` | `2` | Max block height gap for zero-downtime safety gate |
| `ZERO_DOWNTIME_TX_DRAIN_TIMEOUT_MS` | `60000` | Max wait for txpool drain before traffic switch |
| `ZERO_DOWNTIME_MAX_PENDING_TX` | `0` | Max pending TXs allowed before traffic switch |
| `ZERO_DOWNTIME_READY_TIMEOUT_MS` | `300000` | Standby pod readiness timeout |
| `ZERO_DOWNTIME_POD_CLEANUP_SLEEP_MS` | `30000` | Drain wait before old pod deletion |
| **Agent & Autonomy** | — | — |
| `AGENT_V2` | `false` | Enable V2 agent orchestrator |
| `GOAL_AUTONOMY_LEVEL` | — | Agent autonomy level (0-5) |
| **AI Routing** | — | — |
| `AI_ROUTING_ENABLED` | `false` | Enable AI model routing |
| `AI_ROUTING_POLICY` | — | Routing policy (cost, latency, quality) |
| `AI_ROUTING_BUDGET_USD_DAILY` | — | Daily AI budget cap |
| **Notifications** | — | — |
| `DISCORD_WEBHOOK_URL` | — | Discord notification webhook |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID |
| **ZK Stack Specific** | — | — |
| `ZKSTACK_MODE` | — | ZK Stack mode (zkstack/zksync) |
| `ZK_PROOF_RPC_URL` | — | ZK proof generation RPC |
| `ZK_FINALITY_MODE` | — | Finality mode for ZK chains |
| **Fault Proof / Derivation** | — | — |
| `FAULT_PROOF_ENABLED` | `false` | Enable fault proof monitoring |
| `CHALLENGER_EOA_ADDRESS` | — | Challenger EOA to monitor |
| **Scheduled Scaling** | — | — |
| `SCHEDULED_SCALING_ENABLED` | `false` | Enable time-based scheduled scaling |

Full env guide: `ENV_GUIDE.md`

## Documentation

- `docs/README.md`: Documentation index with all guides and proposals
- **`docs/guide/`**: Practical guides (Redis setup, EC2 deployment, demo scenarios, load testing)
  - `redis-setup.md`: Redis optional configuration (InMemory vs Redis)
  - `ec2-setup-guide.md`: AWS EC2 deployment with Cloudflare Tunnel
  - `demo-scenarios.md`: Simulation scenarios for testing
  - `production-load-testing-guide.md`: EKS cluster verification
- `docs/done/`: Completed proposals (1–10, implementation details)
- `docs/spec/`: Implementation specs for AI agent consumption
- `docs/plans/proposals/`: Unimplemented proposals
- `docs/verification/`: Test and verification reports
- `FEATURES.md`: Complete feature inventory
- `ARCHITECTURE.md`: System architecture with diagrams

## Deployment

Docker container only — **Vercel/serverless NOT supported** (requires kubectl + aws CLI).

3-stage multi-stage Dockerfile: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`.

See `README.md` for Docker/K8s/EC2/Cloudflare Tunnel deployment instructions.

## Tech Stack

Next.js 16, React 19, TypeScript (strict), viem, Recharts, Tailwind CSS 4, Lucide icons, Vitest, ioredis
