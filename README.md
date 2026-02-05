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
- **Dynamic Scaling Visualization**: 1-8 vCPU range with cost optimization metrics
- **AI-Powered Log Analysis**: Gemini-based anomaly detection for Optimism Rollup components
- **Stress Test Simulation**: Simulate peak load scenarios (8 vCPU / 16 GiB)
- **K8s Integration**: AWS EKS connection with dynamic token generation

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
