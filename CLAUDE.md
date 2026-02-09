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
2. **Layer 2** (`anomaly-ai-analyzer.ts`): AI semantic analysis via ai-client (fast tier)
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
| `ai-client.ts`          | Unified AI client (Anthropic/OpenAI/Gemini/LiteLLM)             |
| `scaling-decision.ts`   | Hybrid scoring algorithm → target vCPU                          |
| `k8s-scaler.ts`         | StatefulSet patch + simulation, cooldown logic                  |
| `k8s-config.ts`         | kubectl connection: token caching (10min), API URL auto-detect  |
| `predictive-scaler.ts`  | AI time-series prediction via ai-client (fast tier)             |
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

## Documentation (`docs/`)

```
docs/
├── README.md                          ← 문서 개요
├── done/                              ← 구현 완료된 제안서
│   ├── proposal-1-predictive-scaling.md
│   ├── proposal-2-anomaly-detection.md
│   ├── proposal-3-rca-engine.md
│   └── proposal-4-cost-optimizer.md
├── spec/                              ← 구현 명세서 (AI 에이전트용)
│   ├── daily-report-spec.md
│   └── zero-downtime-scaling-spec.md
├── todo/                              ← 미구현 제안서
│   ├── proposal-5-nlops.md
│   ├── proposal-6-zero-downtime-scaling.md
│   └── proposal-7-redis-state-store.md
└── verification/                      ← 구현 검증 보고서
    ├── daily-report-verification.md
    ├── predictive-scaling-verification.md
    ├── predictive-scaling-verification-report.md
    ├── proposal-2-3-verification-report.md
    ├── proposal-6-verification-report.md
    ├── seed-ui-verification.md
    └── seed-ui-verification-report.md
```

- **done/**: 구현이 완료된 제안서. 이동 시 `todo/` → `done/`
- **spec/**: 상세 구현 명세서. AI 에이전트가 추가 질문 없이 구현 가능한 수준
- **todo/**: 아직 구현되지 않은 제안서
- **verification/**: 각 구현의 검증 결과 보고서

## Key Patterns

- **Import alias**: `@/*` → `./src/*`
- **Dual-mode**: Real K8s cluster data or mock fallback for development
- **AI Client**: `src/lib/ai-client.ts` — 통합 AI 클라이언트. Anthropic/OpenAI/Gemini 직접 API + LiteLLM Gateway 지원. `chatCompletion()` 단일 함수로 모든 AI 호출 처리. Model tier: `fast` (haiku/gpt-4.1-mini/gemini-flash-lite), `best` (opus/gpt-4.1/gemini-pro)
- **In-memory state**: MetricsStore, scaling state, anomaly events all reset on server restart (no persistence layer yet)
- **Cost basis**: AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- **Simulation mode**: `SCALING_SIMULATION_MODE=true` by default (no real K8s changes)

## Environment Variables

```bash
cp .env.local.sample .env.local   # Then edit, or use: npm run setup
```

### Required

| 변수 | 설명 |
|------|------|
| `L2_RPC_URL` | L2 Chain RPC endpoint |
| AI API Key (택 1) | 아래 AI Provider 섹션 참조 |
| `AWS_CLUSTER_NAME` | EKS cluster (K8S_API_URL & region 자동 감지) |

### AI Provider (택 1)

`ai-client.ts`가 환경변수를 확인하여 프로바이더를 자동 감지한다. API 키만 설정하면 해당 프로바이더의 공식 API 서버로 직접 연결된다.

| 우선순위 | 환경변수 | 프로바이더 | 엔드포인트 | fast 모델 | best 모델 |
|---------|---------|-----------|-----------|----------|----------|
| 1 | `AI_GATEWAY_URL` + API Key | LiteLLM Gateway | 설정된 URL | `claude-haiku-4.5` | `claude-opus-4-6` |
| 2 | `ANTHROPIC_API_KEY` | Anthropic Direct | `api.anthropic.com` | `claude-haiku-4-5-20251001` | `claude-opus-4-6` |
| 3 | `OPENAI_API_KEY` | OpenAI Direct | `api.openai.com` | `gpt-4.1-mini` | `gpt-4.1` |
| 4 | `GEMINI_API_KEY` | Gemini Direct | `generativelanguage.googleapis.com` | `gemini-2.5-flash-lite` | `gemini-2.5-pro` |

```bash
# 예시 1: Anthropic 직접 연결 (권장)
ANTHROPIC_API_KEY=sk-ant-...

# 예시 2: OpenAI 직접 연결
OPENAI_API_KEY=sk-...

# 예시 3: Gemini 직접 연결
GEMINI_API_KEY=AIza...

# 예시 4: LiteLLM Gateway 경유 (레거시)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-litellm-key
```

`AI_GATEWAY_URL`이 설정되면 직접 API보다 우선한다. 미설정 시 API 키 종류에 따라 공식 서버로 자동 연결.

### Optional

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_GATEWAY_URL` | — | LiteLLM Gateway URL (설정 시 직접 API 대신 Gateway 사용) |
| `K8S_NAMESPACE` | `default` | L2 Pod가 배포된 네임스페이스 |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (`app=op-geth`) |
| `K8S_API_URL` | 자동 감지 | K8s API URL 수동 지정 |
| `K8S_INSECURE_TLS` | `false` | TLS 검증 건너뛰기 (개발 전용) |
| `REDIS_URL` | — | Redis 상태 저장소 (미설정 시 인메모리) |
| `ALERT_WEBHOOK_URL` | — | 이상 탐지 알림 Slack/Webhook URL |
| `COST_TRACKING_ENABLED` | `true` | vCPU 사용 패턴 추적 (`false`로 비활성화) |
| `SCALING_SIMULATION_MODE` | `true` | 실제 K8s 변경 없이 시뮬레이션 |

상세 설정 가이드: `ENV_GUIDE.md`

## Deployment

Docker container only — **Vercel/serverless NOT supported** (requires kubectl + aws CLI).

3-stage multi-stage Dockerfile: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`.

See `README.md` for full Docker/K8s/EC2 deployment instructions.

## Tech Stack

Next.js 16, React 19, TypeScript (strict), viem, Recharts, Tailwind CSS 4, Lucide icons, Vitest
