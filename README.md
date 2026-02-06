# SentinAI (Autonomous Node Guardian)

## Overview
A Next.js dashboard for monitoring and auto-scaling Optimism-based L2 networks.

## Setup

```bash
npm install
npm run dev
```

## Features
- **L1/L2 Block Monitoring**: Real-time block height display for both L1 and L2
- **Dynamic Resource Scaling**: Hybrid auto-scaling engine using CPU, TxPool, and AI insights.
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
Copy the sample and configure:
```bash
cp .env.local.sample .env.local
```

```bash
# L2 Chain RPC (Required)
L2_RPC_URL=https://your-l2-rpc-endpoint.com

# AI Configuration (Required for Log Analysis)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key-here

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
