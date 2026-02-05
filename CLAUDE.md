# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SentinAI (Autonomous Node Guardian)** - A monitoring and auto-scaling dashboard for Optimism-based L2 networks.
- **Next.js Dashboard**: Real-time web UI with L1/L2 block monitoring, K8s integration, and AI-powered log analysis
- **Python Scripts**: Prometheus metrics collector and rule engine for auto-scaling decisions

## Deployment

> **Note**: This application requires `kubectl` and `aws` CLI for K8s monitoring features.
> **Vercel/serverless deployment is NOT supported.** Deploy on K8s cluster or EC2 instead.

### Recommended Deployment Options
1. **K8s Cluster (Recommended)**: Deploy as a Pod with ServiceAccount for native kubectl access
2. **EC2/VM**: Install kubectl and aws CLI, run with PM2 or systemd

## Commands

### Web Dashboard (Primary)
```bash
npm install
npm run dev      # Starts on port 3001
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint check
```

## Architecture

### Next.js Dashboard
- **`src/app/page.tsx`**: Main dashboard component with real-time charts (Recharts), L1/L2 block display, stress test simulation, and AI anomaly detection UI. Uses `AbortController` for optimizing high-frequency polling.
- **`src/app/api/metrics/route.ts`**: Core metrics API - fetches L1 and L2 block heights via viem, K8s pod resources via kubectl.
  - **Optimization**: Implements in-memory caching (10 min) for AWS EKS tokens to reduce latency (0.6s vs 3s).
  - **Fast Path**: Bypasses K8s calls immediately when `stress=true` is enabling, providing instant UI feedback.
- **`src/app/api/k8s/resources/route.ts`**: K8s resource discovery - lists Deployments/StatefulSets, falls back to mock data if cluster unavailable
- **`src/app/api/analyze-logs/route.ts`**: AI log analysis endpoint
- **`src/lib/k8s-scaler.ts`**: Handles StatefulSet patching and simulation logic.
  - Maintains in-memory state for safe simulation (non-destructive).
  - Supports dry-run and cooldown mechanisms.
- **`src/lib/ai-analyzer.ts`**: Gemini-based log analysis for Optimism Rollup components (op-geth, op-node, op-batcher, op-proposer)

### Python Scripts (`src/`)
- **`collector/main.py`**: Prometheus metrics exporter with two modes:
  - `RealMetricCollector`: Connects to L2 RPC via web3.py
  - `MockMetricGenerator`: Simulates quiet/busy/spike scenarios
- **`engine/rule_engine.py`**: Auto-scaling decision engine with CPU/TxPool thresholds and cooldown logic

### Key Patterns
- L1/L2 block height fetched in parallel via viem
- K8s commands executed via `kubectl` with optional AWS EKS token (`aws eks get-token`)
- **Performance**: AWS tokens cached globally (10m) to minimize CLI overhead during polling.
- Dual-mode operation: Real cluster data or mock fallback for development
- Cost calculation based on AWS Fargate Seoul pricing ($0.04656/vCPU-hour, $0.00511/GB-hour)
- Dynamic scaling range: 1-8 vCPU (memory = vCPU × 2 GiB)
- Stress test mode accessible via `?stress=true` query parameter (simulates 8 vCPU peak)

## Environment Variables

Copy the sample and configure:
```bash
cp .env.local.sample .env.local
```

```bash
# L2 Chain RPC (Required)
L2_RPC_URL=https://your-l2-rpc-endpoint.com

# AI Configuration (Required for Log Analysis)
AI_GATEWAY_URL=https://api.ai.tokamak.network
GEMINI_API_KEY=your-api-key-here

# Kubernetes Configuration
K8S_NAMESPACE=default
K8S_APP_PREFIX=op

# AWS EKS Connection
K8S_API_URL=https://<CLUSTER_ID>.eks.amazonaws.com
AWS_CLUSTER_NAME=my-cluster-name
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

## Tech Stack
- Next.js 16, React 19, TypeScript
- viem (Ethereum client), @kubernetes/client-node
- Recharts, Tailwind CSS 4, Lucide icons
- Python: prometheus_client, web3.py
