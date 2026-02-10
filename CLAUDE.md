# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SentinAI (Autonomous Node Guardian)** — Monitoring and auto-scaling dashboard for Optimism-based L2 networks.

Real-time web UI with L1/L2 block monitoring, K8s integration, AI-powered log analysis, anomaly detection, root cause analysis, NLOps chat interface, and hybrid auto-scaling engine.

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

Tests: `src/lib/__tests__/*.test.ts` (23 files, 541+ tests). Coverage scoped to `src/lib/**/*.ts`.

### E2E Verification (Cluster)

```bash
npm run verify                       # Full 6-phase cluster verification
bash scripts/verify-e2e.sh --phase 2 # Run specific phase only
```

`scripts/verify-e2e.sh` runs against a live EKS + L2 RPC + AI Provider environment. Auto-starts dev server if not running.

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

### Core Subsystems

**Scaling Engine** — Hybrid scoring (0–100) = CPU 30% + Gas 30% + TxPool 20% + AI Severity 20%. Three tiers: Idle (<30, 1 vCPU), Normal (30–70, 2 vCPU), High (≥70, 4 vCPU). 5-minute cooldown. Stress mode simulates 8 vCPU.
- `scaling-decision.ts` → `k8s-scaler.ts` → `zero-downtime-scaler.ts`
- `predictive-scaler.ts`: AI time-series prediction via fast tier model

**3-Layer Anomaly Detection** — Statistical → AI → Alert pipeline:
1. `anomaly-detector.ts`: Z-Score detection (threshold: Z > 2.5)
2. `anomaly-ai-analyzer.ts`: AI semantic analysis (fast tier)
3. `alert-dispatcher.ts`: Slack/Webhook dispatch. Events in `anomaly-event-store.ts` (in-memory).

**RCA Engine** — `rca-engine.ts` traces fault propagation using Optimism component dependency graph:
```
L1 → op-node → op-geth
           → op-batcher → L1
           → op-proposer → L1
```

**NLOps Chat** — Natural language operations interface:
- `nlops-engine.ts`: 7 intents (query, scale, analyze, config, explain, rca, unknown)
- `nlops-responder.ts`: AI response generation (fast tier)
- Dangerous actions (scale, config) require confirmation flow

**Cost & Reporting** — `cost-optimizer.ts` + `usage-tracker.ts` for vCPU cost tracking (AWS Fargate Seoul pricing). `daily-report-generator.ts` + `daily-accumulator.ts` for scheduled reports via `scheduler.ts`.

**AI Client** (`ai-client.ts`) — Unified AI interface. `chatCompletion()` single function for all AI calls.
- Model tiers: `fast` (haiku/gpt-4.1-mini/gemini-flash-lite), `best` (sonnet-4.5/gpt-4.1/gemini-pro)
- Priority: Module Override > Gateway (with fallback) > Anthropic > OpenAI > Gemini
- Gateway 400/401 errors auto-fallback to Anthropic Direct
- All AI features have graceful degradation (service continues if AI fails)

**State Management** — InMemory default, Redis optional (`REDIS_URL`). `state-store.ts` abstract interface, `redis-store.ts` implementation. MetricsStore, scaling state, anomaly events reset on restart unless Redis configured.

### Zero-Downtime Scaling

`zero-downtime-scaler.ts` — Parallel Pod Swap state machine:
```
idle → creating_standby → waiting_ready → switching_traffic → cleanup → syncing_statefulset → completed
```

### API Routes (`src/app/api/`)

| Route                       | Methods        | Purpose                                                |
|-----------------------------|----------------|--------------------------------------------------------|
| `metrics/route.ts`          | GET            | L1/L2 blocks, K8s pods, anomaly pipeline. `stress=true` → fast path |
| `metrics/seed/route.ts`     | POST           | Dev-only: inject mock data (stable/rising/spike/falling/live) |
| `scaler/route.ts`           | GET/POST/PATCH | Scaling state + AI prediction / execute / configure |
| `anomalies/route.ts`        | GET            | Anomaly event list                                     |
| `anomalies/config/route.ts` | GET/PUT        | Alert configuration                                    |
| `nlops/route.ts`            | POST           | NLOps chat (natural language operations)               |
| `rca/route.ts`              | POST           | Root cause analysis execution                          |
| `cost-report/route.ts`      | GET            | Cost optimization report                               |
| `reports/daily/route.ts`    | GET/POST       | Daily report generation and retrieval                  |
| `health/route.ts`           | GET            | Docker healthcheck                                     |

### Types (`src/types/`)

- `scaling.ts`: `ScalingMetrics`, `ScalingDecision`, `ScalingConfig`, `TargetVcpu` (1|2|4), `AISeverity`
- `prediction.ts`: `PredictionResult`, `PredictionConfig`, `MetricDataPoint`
- `anomaly.ts`: `AnomalyResult`, `DeepAnalysisResult`, `AlertConfig`, `AnomalyEvent`
- `rca.ts`: `RCAResult`, `RCAEvent`, `RCAComponent`, `RemediationAdvice`
- `zero-downtime.ts`: `SwapPhase`, `SwapState`, `ZeroDowntimeResult`
- `nlops.ts`: `NLOpsIntent`, `NLOpsResult`, `ChatMessage`
- `cost.ts`: Cost optimization types
- `daily-report.ts`: Daily report types
- `redis.ts`: Redis state store types

### UI

Single-page dashboard (`src/app/page.tsx`, ~1186 lines). All UI is inline — no components extracted to `src/components/`. Uses `AbortController` for high-frequency polling. NLOps chat panel integrated with `data-testid` attributes for test automation.

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
cp .env.local.sample .env.local   # Then edit, or use: npm run setup
```

### Required

| Variable | Description |
|----------|-------------|
| `L2_RPC_URL` | L2 Chain RPC endpoint |
| AI API Key (one of) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` |
| `AWS_CLUSTER_NAME` | EKS cluster name (auto-detects K8S_API_URL & region) |

### AI Provider Priority

`ai-client.ts` auto-detects provider from env vars. Set only the API key — it connects to the official API server directly.

| Priority | Env Var | Provider | fast model | best model |
|----------|---------|----------|------------|------------|
| 1 | `AI_GATEWAY_URL` + Key | LiteLLM Gateway | `claude-haiku-4.5` | `claude-sonnet-4-5-20250929` |
| 2 | `ANTHROPIC_API_KEY` | Anthropic Direct | `claude-haiku-4-5-20251001` | `claude-sonnet-4-5-20250929` |
| 3 | `OPENAI_API_KEY` | OpenAI Direct | `gpt-4.1-mini` | `gpt-4.1` |
| 4 | `GEMINI_API_KEY` | Gemini Direct | `gemini-2.5-flash-lite` | `gemini-2.5-pro` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
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

Full env guide: `ENV_GUIDE.md`

## Documentation

- `docs/done/`: Completed proposals (1–7, implementation details)
- `docs/spec/`: Implementation specs for AI agent consumption
- `docs/todo/`: Unimplemented proposals (8: Auto-Remediation, 9: Universal Blockchain Platform)
- `docs/verification/`: Test and verification reports
- `FEATURES.md`: Complete feature inventory
- `ARCHITECTURE.md`: System architecture with diagrams

## Deployment

Docker container only — **Vercel/serverless NOT supported** (requires kubectl + aws CLI).

3-stage multi-stage Dockerfile: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`.

See `README.md` for Docker/K8s/EC2/Cloudflare Tunnel deployment instructions.

## Tech Stack

Next.js 16, React 19, TypeScript (strict), viem, Recharts, Tailwind CSS 4, Lucide icons, Vitest, ioredis
