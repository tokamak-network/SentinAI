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

`scripts/verify-e2e.sh` runs against a live EKS + L2 RPC + AI Provider environment.

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

**L1 RPC Failover** (`l1-rpc-failover.ts`) — Detects ≥3 consecutive failures, switches to next endpoint from `L1_RPC_URLS`. 5-minute cooldown. Updates K8s components via `kubectl set env`.

### Core Subsystems

**Scaling Engine** — Hybrid scoring (0–100) = CPU 30% + Gas 30% + TxPool 20% + AI Severity 20%. Four tiers: Idle (<30, 1 vCPU), Normal (30–70, 2 vCPU), High (70–77, 4 vCPU), Emergency (≥77, 8 vCPU). 5-minute cooldown.

Scaling mode priority (`k8s-scaler.ts`): **Simulation** → **In-Place Resize** (kubectl patch pod --subresource resize, K8s 1.27+, ~1-3s, zero downtime) → **Zero-Downtime Pod Swap** → **Docker** → **Legacy kubectl patch**.

**Zero-Downtime Pod Swap** (`zero-downtime-scaler.ts`) — State machine:
```
idle → creating_standby → waiting_ready → [safety gates] → switching_traffic → cleanup → syncing_statefulset → completed
Any failure → rolling_back → failed
```
Safety gates: Block Sync (gap ≤ `ZERO_DOWNTIME_MAX_BLOCK_GAP`, default 2) + TX Drain (`txpool_status` pending+queued → 0, timeout `ZERO_DOWNTIME_TX_DRAIN_TIMEOUT_MS`, default 60s).

**4-Layer Anomaly Detection** — `anomaly-detector.ts` (Z-Score, Z>3.0) → `anomaly-ai-analyzer.ts` (AI semantic) → `alert-dispatcher.ts` (Slack/Webhook) → Auto-remediation (if `AUTO_REMEDIATION_ENABLED=true`).

**RCA Engine** — `rca-engine.ts` traces fault propagation via `ChainPlugin.dependencyGraph`.

**Chain Plugin System** (`src/chains/`) — `getChainPlugin()` returns active plugin (default: Thanos). Supported: `thanos`, `optimism`, `zkstack`, `arbitrum`. Adding new chain = 4 files in `src/chains/<chain>/`.

**NLOps Chat** — `nlops-engine.ts`: 9 AI function-calling tools + 7 intent types. Dangerous actions (scale_node, update_config) require confirmation.

**AI Client** (`ai-client.ts`) — Priority: Gateway > Qwen > Anthropic > OpenAI > Gemini. Two tiers: Fast (anomaly detection, NLOps) / Best (RCA, reports, predictive scaling). All features have non-AI fallback.

**State Management** — InMemory default, Redis optional (`REDIS_URL`). `state-store.ts` abstract interface.

### API Routes (`src/app/api/`)

| Route | Methods | Purpose |
|-------|---------|---------|
| `metrics/route.ts` | GET | L1/L2 blocks, K8s pods, anomaly pipeline |
| `scaler/route.ts` | GET/POST/PATCH | Scaling state + AI prediction / execute / configure |
| `anomalies/route.ts` | GET | Anomaly event list |
| `nlops/route.ts` | GET/POST | NLOps chat |
| `rca/route.ts` | GET/POST | Root cause analysis |
| `remediation/route.ts` | GET/POST/PATCH | Remediation execution and status |
| `agent-loop/route.ts` | GET | Agent loop status and control |
| `eoa-balance/route.ts` | GET/POST | EOA balance status / refill |
| `mcp/route.ts` | GET/POST | MCP tool execution |
| `health/route.ts` | GET | Docker healthcheck |

See `src/app/api/` for full route list (reports, goals, agent-fleet, ai-routing, autonomous ops, v2 multi-instance, oauth, etc.).

### UI

Single-page dashboard (`src/app/page.tsx`, ~2278 lines). All UI inline — no extracted components. Uses `AbortController` for high-frequency polling.

## Key Patterns

- **Import alias**: `@/*` → `./src/*`
- **Dual-mode**: Real K8s cluster data or mock fallback for development
- **Simulation mode**: `SCALING_SIMULATION_MODE=true` by default (no real K8s changes)
- **AI resilience**: Every AI feature has a non-AI fallback path
- **Cost basis**: AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- **Ring buffer**: MetricsStore holds 60 data points with stats (mean, stdDev, trend, slope)
- **AI response parsing**: `ai-response-parser.ts` extracts structured JSON (handles markdown code blocks, partial JSON)

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

| Priority | Env Var | Provider | fast model | best model |
|----------|---------|----------|------------|------------|
| 0 | `AI_GATEWAY_URL` + Key | LiteLLM Gateway | (detected provider) | (detected provider) |
| 1 | `QWEN_API_KEY` | Qwen | `qwen3-80b-next` | `qwen3-80b-next` |
| 2 | `ANTHROPIC_API_KEY` | Anthropic | `claude-haiku-4-5-20251001` | `claude-sonnet-4-5-20250929` |
| 3 | `OPENAI_API_KEY` | OpenAI | `gpt-5.2` | `gpt-5.2-codex` |
| 4 | `GEMINI_API_KEY` | Gemini | `gemini-2.5-flash-lite` | `gemini-2.5-pro` |

### Optional (Core)

| Variable | Default | Description |
|----------|---------|-------------|
| `QWEN_BASE_URL` | DashScope | Qwen API endpoint (any OpenAI-compatible server) |
| `OPENAI_BASE_URL` | api.openai.com | OpenAI-compatible endpoint |
| `OPENAI_MODEL_FAST` / `OPENAI_MODEL_BEST` | auto | Model overrides per tier |
| `AI_GATEWAY_URL` | — | LiteLLM Gateway URL |
| `K8S_NAMESPACE` | `default` | Namespace where L2 pods are deployed |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (`app=op-geth`) |
| `REDIS_URL` | — | Redis state store (in-memory if unset) |
| `ALERT_WEBHOOK_URL` | — | Slack/Webhook URL for anomaly alerts |
| `SCALING_SIMULATION_MODE` | `true` | Simulate K8s changes without real patches |
| `SENTINAI_API_KEY` | — | API key for write endpoint auth |
| `NEXT_PUBLIC_NETWORK_NAME` | — | Network name in dashboard header |
| `AGENT_LOOP_ENABLED` | auto | Server-side autonomous loop |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 auto-remediation |
| `BATCHER_EOA_ADDRESS` / `PROPOSER_EOA_ADDRESS` | — | EOA wallets to monitor |
| `L1_RPC_URLS` | — | Comma-separated public L1 RPC endpoints (auto-failover) |
| `SENTINAI_L1_RPC_URL` | publicnode.com | Single public L1 RPC (fallback) |
| `SCALING_COOLDOWN_SECONDS` | `300` | Cooldown between scaling events |
| `ZERO_DOWNTIME_MAX_BLOCK_GAP` | `2` | Safety gate: max block height gap |
| `ZERO_DOWNTIME_TX_DRAIN_TIMEOUT_MS` | `60000` | Safety gate: txpool drain timeout |
| `L1_PROXYD_ENABLED` | `false` | Update Proxyd ConfigMap on L1 failover |

Full env guide: `ENV_GUIDE.md`

## Deployment

Docker container only — **Vercel/serverless NOT supported** (requires kubectl + aws CLI).

3-stage Dockerfile: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`.

See `README.md` for Docker/K8s/EC2/Cloudflare Tunnel instructions. Docs index: `docs/README.md`.

## Tech Stack

Next.js 16, React 19, TypeScript (strict), viem, Recharts, Tailwind CSS 4, Lucide icons, Vitest, ioredis
