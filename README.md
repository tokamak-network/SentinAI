# SentinAI (Autonomous Node Guardian)

## Overview
A Next.js dashboard for monitoring and auto-scaling Optimism-based L2 networks.

## Setup

```bash
npm install
npm run setup    # Interactive setup wizard for .env.local
npm run dev
```

## Features
- **L1/L2 Block Monitoring**: Real-time block height display for both L1 and L2
- **Dynamic Resource Scaling**: Hybrid auto-scaling engine using CPU, TxPool, and AI insights.
- **Predictive Scaling**: AI-powered time-series analysis (Claude Haiku 4.5) predicts optimal vCPU/MEM allocation 5 minutes ahead.
- **AI-Powered Log Analysis**: Claude-based anomaly detection for Optimism Rollup components
- **Stress Test Simulation**: Simulate peak load scenarios (8 vCPU / 16 GiB)
- **K8s Integration**: AWS EKS connection with **cached dynamic token generation** (10-minute expiry) for low-latency polling.

## Dynamic Resource Scaling
Combines **Rule-based Metrics** and **AI-driven Insights** to optimize `op-geth` resources automatically.

1.  **Hybrid Scoring Logic (0-100)**:
    *   **CPU & Gas (60%)**: Real-time load indicators.
    *   **TxPool (20%)**: Pending transaction bottleneck detection.
    *   **AI Severity (20%)**: Proactive scaling based on log anomaly risks.

2.  **Adaptive Tiers**:
    *   **Idle (<30)**: 1 vCPU (Cost Saving)
    *   **Normal (30-70)**: 2 vCPU (Standard Operation)
    *   **High (>70)**: 4 vCPU (Peak Performance)

3.  **Safety Mechanisms**:
    *   **Cooldown**: 5-minute freeze after scaling to prevent flapping.
    *   **Simulation Mode**: Dry-run execution by default for safety.

## Predictive Scaling
Uses **Claude Haiku 4.5** via LiteLLM AI Gateway to analyze time-series metrics and predict optimal resource allocation.

1.  **Data Collection**: In-memory ring buffer (60 data points) stores CPU, TxPool, Gas ratio, and block interval metrics.
2.  **AI Analysis**: Sends statistical summary + recent 15 data points to Claude for prediction.
3.  **Output**: Predicted vCPU (1/2/4), confidence score, trend direction, key factors, and reasoning.
4.  **Seed Testing**: Dev-only UI for injecting mock scenarios (`stable`, `rising`, `spike`, `falling`) or using live accumulated data (`live`).

## AI Log Analysis Engine
SentinAI uses **Claude Haiku 4.5** via a custom AI Gateway to audit network health in real-time.

1.  **Holistic Context Window**: Instead of analyzing logs in isolation, it aggregates logs from 4 core components to detect complex cross-component issues:
    *   `op-geth` (Execution Engine)
    *   `op-node` (Consensus Driver)
    *   `op-batcher` (L1 Transaction Submitter)
    *   `op-proposer` (State Root Proposer)

2.  **Senior Engineer Persona**: The AI is prompted with a "Senior Protocol Engineer" system instruction to check for:
    *   **Security**: P2P GossipSub attacks, unauthorized peering.
    *   **Consensus**: Unsafe head divergence, derivation stalls.
    *   **Liveness**: Batch submission failures, sequencer drifts.

3.  **Actionable Intelligence**:
    *   Outputs results in structured JSON: `{ "severity": "critical", "summary": "...", "action_item": "..." }`.
    *   **Suggestions** are grounded in official Optimism documentation (e.g., suggesting `--syncmode snap` or checking specific P2P flags).

## Environment Variables

Interactive setup (recommended):
```bash
npm run setup
```

Or copy the sample and configure manually:
```bash
cp .env.local.sample .env.local
```

**Minimum required (3 variables for full functionality):**
```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com    # L2 Chain RPC
ANTHROPIC_API_KEY=your-api-key-here             # AI features
AWS_CLUSTER_NAME=my-cluster-name                # K8s (auto-detects K8S_API_URL & region)
```

> `K8S_API_URL` and `AWS_REGION` are auto-detected at runtime from `AWS_CLUSTER_NAME`.
> AWS credentials use the standard chain: env vars, `~/.aws/credentials`, or IAM Role.
