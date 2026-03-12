# CLAUDE.md

**SentinAI** — L2 네트워크 모니터링 & 자동 스케일링 (Chain Plugin, K8s 통합, AI 분석)

## Commands
```bash
npm run dev                          # Port 3002
npm run test                         # Watch mode
npm run test:coverage                # src/lib/** 커버리지
npm run verify                       # E2E 검증 (6단계)
```

## Architecture

**Agent Loop** (60초 주기): RPC → metrics API → 4-layer 이상탐지 → Scaling → K8s 자동 실행

**Core**: Scaling Engine (hybrid score 0-100), Zero-Downtime Pod Swap, RCA Engine, Chain Plugin System (thanos/optimism/zkstack/arbitrum), NLOps Chat (9 tools), AI Client (Gateway/Qwen/Anthropic/OpenAI/Gemini, fallback O), State Management (Redis optional)

**API**: `/api/metrics` (L1/L2), `/api/scaler` (스케일링 상태/명령), `/api/anomalies`, `/api/nlops`, `/api/rca`, `/api/remediation`, `/api/agent-loop` 등

**UI**: SPA (`src/app/page.tsx`, ~2278줄), inline components, AbortController 폴링

## Environment
```bash
cp .env.local.sample .env.local
```

**필수**: `L2_RPC_URL`, AI Key 1개 (QWEN/ANTHROPIC/OPENAI/GEMINI), `AWS_CLUSTER_NAME`

**AI 우선순위**: Gateway > Qwen > Anthropic > OpenAI > Gemini (각각 fast/best 모델)

**주요 선택**: `REDIS_URL` (상태저장), `SCALING_SIMULATION_MODE=true` (기본, 실제 K8s 변경 안 함), `AGENT_LOOP_ENABLED`, `AUTO_REMEDIATION_ENABLED` 등

자세한 환경변수: `ENV_GUIDE.md`

## Key Patterns
- Import: `@/*` → `./src/*`
- Dual-mode: 실제 K8s / mock fallback
- AI resilience: 모든 AI 기능 non-AI fallback
- Ring buffer: MetricsStore 60개 포인트 (mean, stdDev, trend, slope)

## Deployment
Docker only (Vercel/serverless 미지원). 3단계: deps → builder → runner (node:20-alpine). Healthcheck: `GET /api/health`. 자세한 사항: `README.md`, `docs/README.md`

## Tech Stack
Next.js 16, React 19, TypeScript, viem, Recharts, Tailwind CSS 4, Vitest, ioredis
