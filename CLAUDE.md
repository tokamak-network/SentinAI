# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SentinAI (Autonomous Node Guardian)** - A monitoring and auto-scaling dashboard for Optimism-based L2 networks.

Real-time web UI with L1/L2 block monitoring, K8s integration, AI-powered log analysis, and hybrid auto-scaling engine.

## Deployment

> **Note**: This application requires `kubectl` and `aws` CLI for K8s monitoring features.
> **Vercel/serverless deployment is NOT supported.** Use Docker container deployment.

### Docker Deployment (Recommended)

3-stage multi-stage build: deps → builder → runner (node:20-alpine). kubectl and aws-cli pre-installed.
Healthcheck: `GET /api/health` (30s interval). Output: `standalone` mode.

```bash
# Build image
docker build -t sentinai:latest .

# Run container (minimum - L2 RPC only, K8s features disabled)
docker run -d \
  --name sentinai \
  -p 3000:3000 \
  -e L2_RPC_URL=https://your-l2-rpc-endpoint.com \
  sentinai:latest

# Run container (full - with K8s and AI features)
docker run -d \
  --name sentinai \
  -p 3000:3000 \
  -e L2_RPC_URL=https://your-l2-rpc-endpoint.com \
  -e AI_GATEWAY_URL=https://api.ai.tokamak.network \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e K8S_NAMESPACE=default \
  -e K8S_APP_PREFIX=op \
  -e K8S_API_URL=https://your-eks-cluster.amazonaws.com \
  -e AWS_CLUSTER_NAME=my-cluster-name \
  -e AWS_REGION=ap-northeast-2 \
  -e AWS_ACCESS_KEY_ID=your-access-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret-key \
  sentinai:latest
```

### Alternative: K8s Pod
Deploy as a Pod with ServiceAccount for native kubectl access. Use K8s CronJob for periodic scaling triggers.

### Alternative: EC2/VM
Install kubectl and aws CLI manually, run with PM2 or systemd.

## Commands

```bash
npm install
npm run dev      # Starts on port 3002
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint check
```

## Architecture

### API Routes (`src/app/api/`)

- **`metrics/route.ts`**: Core metrics API - fetches L1/L2 block heights via viem, K8s pod resources via kubectl.
  - **Token Caching**: AWS EKS tokens cached globally (10 min) to reduce latency (0.6s vs 3s).
  - **Fast Path**: When `stress=true`, returns simulated 8 vCPU peak data immediately (no K8s/RPC calls).

- **`scaler/route.ts`**: Auto-scaling control endpoint.
  - `GET`: Returns current scaling state (vCPU, cooldown, simulation mode).
  - `POST`: Executes manual or auto scaling with metrics collection.
  - `PATCH`: Updates auto-scaling settings (enable/disable, simulation mode).

- **`analyze-logs/route.ts`**: AI log analysis endpoint using Claude via custom AI Gateway.

- **`health/route.ts`**: Lightweight health check endpoint for Docker HEALTHCHECK and load balancer probes.

### Libraries (`src/lib/`)

- **`scaling-decision.ts`**: Hybrid scoring algorithm (0-100) combining CPU (30%), Gas (30%), TxPool (20%), AI Severity (20%). Maps score to target vCPU: <30 → 1 vCPU, <70 → 2 vCPU, ≥70 → 4 vCPU.

- **`k8s-scaler.ts`**: StatefulSet patching and simulation logic. Maintains in-memory state for safe dry-run testing with 5-minute cooldown between scaling operations.

- **`ai-analyzer.ts`**: Claude-based log analysis for Optimism Rollup components (op-geth, op-node, op-batcher, op-proposer).

- **`log-ingester.ts`**: Log collection utilities for K8s pods.

### Types (`src/types/scaling.ts`)

Core type definitions: `ScalingMetrics`, `ScalingDecision`, `ScalingConfig`, `TargetVcpu` (1|2|4), `AISeverity`.

### UI (`src/app/`)

- **`page.tsx`**: Main dashboard with real-time charts (Recharts), L1/L2 block display, stress test simulation, and AI anomaly detection UI. Uses `AbortController` for optimizing high-frequency polling.

### Key Patterns

- L1/L2 block heights fetched in parallel via viem
- K8s commands executed via `kubectl` with optional AWS EKS token (`aws eks get-token`)
- Dual-mode operation: Real cluster data or mock fallback for development
- Cost calculation based on AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- Dynamic scaling range: 1-4 vCPU (memory = vCPU × 2 GiB), stress mode simulates 8 vCPU
- Import alias: `@/*` maps to `./src/*`

## Environment Variables

Copy the sample and configure (see `ENV_GUIDE.md` for detailed setup instructions):
```bash
cp .env.local.sample .env.local
```

**Required:**
```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com    # L2 Chain RPC
```

**Optional (AI Log Analysis):**
```bash
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key-here
```

**Optional (K8s Monitoring & Auto-scaling):**
```bash
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
K8S_API_URL=https://<CLUSTER_ID>.eks.amazonaws.com
AWS_CLUSTER_NAME=my-cluster-name
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

## Tech Stack

- Next.js 16, React 19, TypeScript (strict mode)
- viem (Ethereum client), Recharts, Tailwind CSS 4, Lucide icons
