# SentinAI Overview

## What is SentinAI?

SentinAI is an **Autonomous Node Guardian** — a Next.js dashboard for monitoring and auto-scaling Optimism-based L2 networks.

## Key Features

### Real-Time Monitoring
- **L2 Block Monitoring**: Real-time block height display and network metrics
- **K8s Integration**: AWS EKS connection with cached dynamic token generation (10-minute expiry) for low-latency polling

### Intelligent Scaling
- **Dynamic Resource Scaling**: Hybrid auto-scaling engine using CPU, TxPool, and AI insights
- **Predictive Scaling**: AI-powered time-series analysis (Claude Haiku 4.5) predicts optimal vCPU/MEM allocation 5 minutes ahead
- **Adaptive Tiers**: Idle (<30) → 1 vCPU | Normal (30-70) → 2 vCPU | High (>70) → 4 vCPU

### AI-Powered Analysis
- **Log Anomaly Detection**: Claude-based analysis for Optimism Rollup components (op-geth, op-node, op-batcher, op-proposer)
- **Model Benchmarking**: Compare AI model performance (Qwen, Claude, GPT, Gemini) with latency, cost, and accuracy metrics
- **Tier-Based Model Selection**: Fast Tier (qwen3-80b-next, 1.8s) and Best Tier (qwen3-235b, 11s)

### Testing & Simulation
- **Stress Test Simulation**: Simulate peak load scenarios (8 vCPU / 16 GiB)
- **Safety Mechanisms**: Cooldown periods and simulation mode by default

## Architecture Highlights

### Hybrid Scoring Logic (0-100)
- **CPU & Gas (60%)**: Real-time load indicators
- **TxPool (20%)**: Pending transaction bottleneck detection
- **AI Severity (20%)**: Proactive scaling based on log anomaly risks

### AI Log Analysis Engine
1. **Holistic Context Window**: Aggregates logs from 4 core components to detect complex cross-component issues
2. **Senior Engineer Persona**: Prompted to check for security, consensus, and liveness issues
3. **Actionable Intelligence**: Structured JSON output with severity, summary, and action items grounded in official Optimism documentation

### Safety First
- **Cooldown**: 5-minute freeze after scaling to prevent flapping
- **Simulation Mode**: Dry-run execution by default for safety
- **AWS Integration**: Standard AWS credential chain (env vars, ~/.aws/credentials, or IAM Role)

## Supported Networks
- Optimism / OP Stack
- Thanos (Tokamak Network)

---

For setup instructions, see [Setup Guide](setup.md).  
For hands-on demos, see [Demo Scenarios](demo-scenarios.md).
