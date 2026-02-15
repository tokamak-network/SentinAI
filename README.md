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
- **Model Benchmarking** (New!): Compare AI model performance (Qwen, Claude, GPT, Gemini) using 5 production prompts. Generate CSV/Markdown reports with latency, cost, and accuracy metrics.
- **Automatic Tier-Based Model Selection**: Fast Tier (qwen3-80b-next, 1.8s) and Best Tier (qwen3-235b, 11s) auto-selected based on operation needs.

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
Uses **Tier-based AI models** via LiteLLM AI Gateway to analyze time-series metrics and predict optimal resource allocation.

1.  **Data Collection**: In-memory ring buffer (60 data points) stores CPU, TxPool, Gas ratio, and block interval metrics.
2.  **AI Analysis**: Sends statistical summary + recent 15 data points to AI for prediction.
   - **Fast Tier**: `qwen3-80b-next` (1.8s response) — Real-time analysis
   - **Best Tier**: `qwen3-235b` (11s response) — Complex pattern recognition
3.  **Output**: Predicted vCPU (1/2/4), confidence score, trend direction, key factors, and reasoning.
4.  **Seed Testing**: Dev-only UI for injecting mock scenarios (`stable`, `rising`, `spike`, `falling`) or using live accumulated data (`live`).

## AI Log Analysis Engine
SentinAI uses **tier-based AI models** via a custom AI Gateway to audit network health in real-time.
- **Fast Tier**: `qwen3-80b-next` for real-time anomaly detection
- **Best Tier**: `qwen3-235b` for deep-dive analysis

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

**L1 RPC Configuration (Important Architecture Note):**
- **SentinAI monitoring**: Uses **public L1 RPC** (e.g., `publicnode.com`)
  - Set via `L1_RPC_URL` or `L1_RPC_URLS` for automatic failover
  - Rate limit optimized: 95% reduction via caching + polling adjustment
- **L2 nodes** (op-node, op-batcher, op-proposer): Use **Proxyd with paid L1 RPC endpoints**
  - Configured separately via Proxyd ConfigMap (not SentinAI env)
  - See `docs/guide/proxyd-failover-setup.md` for details

> `K8S_API_URL` and `AWS_REGION` are auto-detected at runtime from `AWS_CLUSTER_NAME`.
> AWS credentials use the standard chain: env vars, `~/.aws/credentials`, or IAM Role.

## Deployment

### Quick Install (Ubuntu / Amazon Linux)

Two scripts automate the entire setup:

```bash
# Step 1: Server prerequisites (system packages, firewall, AWS CLI, kubectl)
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/setup-server.sh | bash

# Step 2: SentinAI install (Docker, clone, .env.local, Caddy HTTPS, start)
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

The installer prompts for:
1. **L2 RPC URL** (required)
2. **AI Provider + API Key** (required)
3. **AWS EKS Cluster Name** (optional — skip for simulation mode)
4. **Public Domain** for HTTPS (optional — Caddy auto-issues Let's Encrypt cert)
5. **Slack Webhook URL** (optional)

#### Non-interactive mode (CI/CD, EC2 User Data)

```bash
SENTINAI_L2_RPC_URL=https://your-l2-rpc.example.com \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY=sk-ant-... \
SENTINAI_CLUSTER_NAME=your-cluster \
SENTINAI_DOMAIN=sentinai.yourdomain.com \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

#### What `setup-server.sh` installs

| Item | Description |
|------|-------------|
| System update | `apt update && upgrade` |
| Essential packages | curl, jq, unzip, ca-certificates |
| Firewall (ufw) | Ports 22, 80, 443 |
| AWS CLI v2 | For `aws eks update-kubeconfig` |
| kubectl | For EKS cluster access |
| Swap (2GB) | Auto-created if RAM < 4GB |

Each item can be skipped via `SKIP_FIREWALL=true`, `SKIP_AWS_CLI=true`, etc.

#### What `install.sh` installs

| Item | Description |
|------|-------------|
| Docker + Compose | Container runtime |
| Git | Source code management |
| SentinAI source | Cloned to `/opt/sentinai` |
| `.env.local` | Interactive or env-var based configuration |
| Caddyfile | Auto-generated if domain is provided |
| Services | `docker compose [--profile production] up -d` |

### HTTPS with Caddy (Production)

When a domain is provided during install, Caddy runs as a reverse proxy with automatic HTTPS:

```
User → Caddy (ports 80/443, auto Let's Encrypt)
         ↓ (Docker internal network)
       sentinai:8080
```

- Certificates are auto-issued and renewed (no cron needed)
- HTTP automatically redirects to HTTPS
- Activated via Docker Compose `production` profile

**DNS setup (Route 53 or any DNS provider):**
- Record type: **A**
- Name: `sentinai` (or your subdomain)
- Value: Server public IP
- TTL: 300

### EC2 Prerequisites (EKS Monitoring)

Required only if monitoring an EKS cluster:

#### IAM Policy (Minimum)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["eks:DescribeCluster", "eks:ListClusters"],
      "Resource": "arn:aws:eks:REGION:ACCOUNT:cluster/CLUSTER_NAME"
    },
    {
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
```

#### EKS RBAC Mapping

```bash
kubectl edit configmap aws-auth -n kube-system
```

```yaml
mapRoles:
  - rolearn: arn:aws:iam::ACCOUNT:role/EC2_ROLE_NAME
    username: sentinai
    groups:
      - system:masters
```

> **Note**: For production, create a dedicated ClusterRole with minimum permissions (get/list pods, patch statefulsets) instead of `system:masters`.

#### IMDSv2 Hop Limit (EC2 only)

Docker containers need hop-limit >= 2 to access EC2 IAM Role:

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-XXXXX \
  --http-put-response-hop-limit 2 \
  --http-tokens required
```

### Operations

```bash
cd /opt/sentinai

# View logs
docker compose --profile production logs -f

# Update to latest version
git pull origin main
docker compose --profile production build
docker compose --profile production up -d

# Stop services
docker compose --profile production down

# Stop and remove all data (Redis, reports)
docker compose --profile production down -v

# Without Caddy (local dev)
docker compose up -d
docker compose logs -f sentinai
```

### Local Docker Test

```bash
docker build -t sentinai:local .

docker run -p 8080:8080 \
  -e L2_RPC_URL="https://..." \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  sentinai:local
```
