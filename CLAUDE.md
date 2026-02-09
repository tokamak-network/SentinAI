# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SentinAI (Autonomous Node Guardian)** — Monitoring and auto-scaling dashboard for Optimism-based L2 networks.

Real-time web UI with L1/L2 block monitoring, K8s integration, AI-powered log analysis, anomaly detection, root cause analysis, and hybrid auto-scaling engine.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3002
npm run build        # Production build (Turbopack)
npm run start        # Production server
npm run lint         # ESLint check
npm run setup        # Interactive .env.local setup wizard
```

### Testing (Vitest)

```bash
npm run test                          # Watch mode
npm run test:run                      # Single run (CI)
npm run test:coverage                 # Coverage report (src/lib/**)
npx vitest run src/lib/__tests__/k8s-scaler.test.ts   # Run single test file
npx vitest run -t "test name"         # Run specific test by name
```

Tests live in `src/lib/__tests__/*.test.ts`. Coverage is scoped to `src/lib/**/*.ts`.

## Architecture

### Data Flow

```
L1/L2 RPC (viem) ──→ /api/metrics ──→ MetricsStore (ring buffer, 60 capacity)
                          │                    │
                          ▼                    ▼
                    page.tsx (UI)      /api/scaler → PredictiveScaler (AI)
                          │                    │
                          ▼                    ▼
                  AnomalyDetector ──→   ScalingDecision ──→ K8sScaler
                       │                                        │
                       ▼                                        ▼
                  RCA Engine                         StatefulSet patch / simulate
```

### Scaling Decision Logic

Hybrid score (0–100) = CPU (30%) + Gas (30%) + TxPool (20%) + AI Severity (20%).

| Score   | Target vCPU | Memory   |
|---------|-------------|----------|
| < 30    | 1           | 2 GiB   |
| < 70    | 2           | 4 GiB   |
| ≥ 70    | 4           | 8 GiB   |

Stress mode simulates 8 vCPU. 5-minute cooldown between scaling operations.

### 3-Layer Anomaly Detection Pipeline

1. **Layer 1** (`anomaly-detector.ts`): Z-Score statistical detection (threshold: Z > 2.5)
2. **Layer 2** (`anomaly-ai-analyzer.ts`): AI semantic analysis via Claude Haiku
3. **Layer 3** (`alert-dispatcher.ts`): Alert dispatch (Slack, Webhook)

Events stored in `anomaly-event-store.ts` (in-memory).

### Zero-Downtime Scaling

`zero-downtime-scaler.ts` — Parallel Pod Swap orchestration:
```
idle → creating_standby → waiting_ready → switching_traffic → cleanup → syncing_statefulset → completed
```

### Optimism Component Dependency Graph (used by RCA)

```
L1 → op-node → op-geth
           → op-batcher → L1
           → op-proposer → L1
```

`rca-engine.ts` uses this graph to trace fault propagation across components.

### API Routes (`src/app/api/`)

| Route                    | Methods    | Purpose                                                |
|--------------------------|------------|--------------------------------------------------------|
| `metrics/route.ts`       | GET        | L1/L2 blocks, K8s pods, anomaly pipeline. `stress=true` → fast path |
| `metrics/seed/route.ts`  | POST       | Dev-only: inject mock data (stable/rising/spike/falling/live) |
| `scaler/route.ts`        | GET/POST/PATCH | Scaling state + AI prediction / execute / configure |
| `anomalies/route.ts`     | GET        | Anomaly event list                                     |
| `anomalies/config/route.ts` | GET/PUT | Alert configuration                                    |
| `rca/route.ts`           | POST       | Root cause analysis execution                          |
| `health/route.ts`        | GET        | Docker healthcheck                                     |

### Key Libraries (`src/lib/`)

| Module                  | Role                                                            |
|-------------------------|-----------------------------------------------------------------|
| `scaling-decision.ts`   | Hybrid scoring algorithm → target vCPU                          |
| `k8s-scaler.ts`         | StatefulSet patch + simulation, cooldown logic                  |
| `k8s-config.ts`         | kubectl connection: token caching (10min), API URL auto-detect  |
| `predictive-scaler.ts`  | AI time-series prediction (Claude Haiku 4.5 via LiteLLM)       |
| `metrics-store.ts`      | Ring buffer + stats (mean, stdDev, trend, slope)                |
| `anomaly-detector.ts`   | Z-Score anomaly detection                                       |
| `anomaly-ai-analyzer.ts`| AI semantic anomaly analysis                                    |
| `alert-dispatcher.ts`   | Slack/Webhook alert dispatch                                    |
| `rca-engine.ts`         | AI root cause analysis with component dependency graph          |
| `zero-downtime-scaler.ts`| Parallel Pod Swap orchestration                                |
| `ai-analyzer.ts`        | Log chunk analysis (op-geth, op-node, op-batcher, op-proposer) |
| `prediction-tracker.ts` | Prediction accuracy tracking                                    |

### Types (`src/types/`)

- `scaling.ts`: `ScalingMetrics`, `ScalingDecision`, `ScalingConfig`, `TargetVcpu` (1|2|4), `AISeverity`
- `prediction.ts`: `PredictionResult`, `PredictionConfig`, `MetricDataPoint`
- `anomaly.ts`: `AnomalyResult`, `DeepAnalysisResult`, `AlertConfig`, `AnomalyEvent`
- `rca.ts`: `RCAResult`, `RCAEvent`, `RCAComponent`, `RemediationAdvice`
- `zero-downtime.ts`: `SwapPhase`, `SwapState`, `ZeroDowntimeResult`

### UI

Single-page dashboard (`src/app/page.tsx`, ~985 lines). All UI is inline — `src/components/` is currently empty. Uses `AbortController` for high-frequency polling optimization.

## Key Patterns

- **Import alias**: `@/*` → `./src/*`
- **Dual-mode**: Real K8s cluster data or mock fallback for development
- **AI Gateway**: LiteLLM at `https://api.ai.tokamak.network` (OpenAI-compatible `/v1/chat/completions`), model `claude-haiku-4.5`, auth via `ANTHROPIC_API_KEY`
- **In-memory state**: MetricsStore, scaling state, anomaly events all reset on server restart (no persistence layer yet)
- **Cost basis**: AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- **Simulation mode**: `SCALING_SIMULATION_MODE=true` by default (no real K8s changes)

## Environment Variables

```bash
cp .env.local.sample .env.local   # Then edit, or use: npm run setup
```

**Required (3 vars for full functionality):**
- `L2_RPC_URL` — L2 Chain RPC endpoint
- `ANTHROPIC_API_KEY` — AI features
- `AWS_CLUSTER_NAME` — EKS cluster (auto-detects K8S_API_URL & region)

**Optional:** `AI_GATEWAY_URL`, `K8S_NAMESPACE`, `K8S_APP_PREFIX`, `K8S_API_URL` (see `ENV_GUIDE.md`)

## Deployment

Docker container only — **Vercel/serverless NOT supported** (requires kubectl + aws CLI).

3-stage multi-stage Dockerfile: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`.

See `README.md` for full Docker/K8s/EC2 deployment instructions.

## Tech Stack

Next.js 16, React 19, TypeScript (strict), viem, Recharts, Tailwind CSS 4, Lucide icons, Vitest
