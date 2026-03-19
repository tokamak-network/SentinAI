# SentinAI Overview

## What is SentinAI?

SentinAI is an **Autonomous Node Guardian** — a Next.js dashboard for monitoring and auto-scaling blockchain nodes. It supports multiple chain types out of the box and is designed to be extended to any EVM-compatible stack.

## Supported Chains

| Chain Type | Plugin | Status |
|------------|--------|--------|
| OP Stack (Optimism, Base, Thanos) | `optimism` | ✅ Stable |
| Arbitrum Orbit / Nitro | `arbitrum` | ✅ Stable |
| ZK Stack (zkSync Era-based) | `zkstack` | ✅ Stable |
| L1 EVM (Ethereum, Ethereum-compatible) | `l1-evm` | ✅ Stable |
| Thanos (Tokamak Network) | `thanos` | ✅ Default |

Set `CHAIN_TYPE` in your `.env.local` to select the active plugin.

## Key Features

### Real-Time Monitoring
- **L1 & L2 Block Monitoring**: Tracks block height, sync lag, and network metrics from both layers
- **K8s Integration**: AWS EKS connection with cached dynamic token generation for low-latency polling
- **Custom Metrics**: Chain plugins expose additional metrics relevant to their stack

### Intelligent Scaling
- **Hybrid Auto-Scaling**: Scoring engine (0–100) using CPU, Gas, TxPool, and AI insights
- **Predictive Scaling**: AI-powered time-series analysis predicts vCPU/MEM needs 5 minutes ahead
- **Adaptive Tiers**: Idle (< 30) → 1 vCPU | Normal (30–70) → 2 vCPU | High (70–77) → 4 vCPU | Emergency (≥77) → 8 vCPU
- **Zero-Downtime Pod Swap**: State-machine-based traffic switchover with block sync and TX drain safety gates

### AI-Powered Analysis
- **Anomaly Detection**: 4-layer pipeline (Z-Score → AI Semantic → Alert → Remediation)
- **Root Cause Analysis**: Traces fault propagation via the chain's dependency graph
- **NLOps Chat**: Natural language interface for operations — 9 function-calling tools, 7 intent types
- **Self-Learning Playbooks**: Pattern miner evolves playbooks from past incident data

### Autonomous Operations
- **Agent Loop**: Server-side 60-second cycle — Observe → Detect → Decide → Act
- **Auto-Remediation**: Executes playbooks automatically when `AUTO_REMEDIATION_ENABLED=true`
- **L1 RPC Failover**: Detects ≥3 consecutive failures and switches to the next endpoint automatically
- **Goal Manager**: High-level goal execution with multi-step planning

## Architecture Highlights

### Hybrid Scoring Logic (0–100)
| Signal | Weight | Description |
|--------|--------|-------------|
| CPU & Gas | 60% | Real-time load indicators |
| TxPool | 20% | Pending transaction bottleneck |
| AI Severity | 20% | Proactive scaling from log anomalies |

### Chain Plugin System
Each chain type is a plugin under `src/chains/<chain>/`:
- **components** — component topology and K8s configs
- **prompts** — AI system prompts tuned for the chain's architecture
- **playbooks** — remediation playbooks for known failure modes

Adding a new chain requires 4 files. The engine modules (RCA, anomaly detection, NLOps) automatically adapt via `getChainPlugin()`.

### Safety First
- **Cooldown**: 5-minute freeze after scaling to prevent flapping
- **Simulation Mode**: Dry-run execution by default (`SCALING_SIMULATION_MODE=true`)
- **Safety Gates**: Zero-downtime swap checks block sync gap and TX drain before traffic switch

---

For setup instructions, see [Setup Guide](setup.md).
For the full architecture diagram, see [Architecture](architecture.md).
