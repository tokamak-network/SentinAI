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

### AWS EC2 + Docker Compose (Recommended)

#### Prerequisites

| Item | Description |
|------|-------------|
| EC2 Instance | t3.medium or larger (2 vCPU, 4 GiB RAM) |
| IAM Role | EC2 Instance Profile with EKS permissions |
| Security Group | Inbound: 3002/tcp, Outbound: 443/tcp + L2 RPC port |
| EKS RBAC | EC2 IAM Role mapped in `aws-auth` ConfigMap |
| IMDSv2 | `http-put-response-hop-limit` must be 2 or higher |

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

Add EC2 IAM Role to the EKS `aws-auth` ConfigMap:

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

#### IMDSv2 Hop Limit

Docker containers need hop-limit >= 2 to access EC2 IAM Role:

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-XXXXX \
  --http-put-response-hop-limit 2 \
  --http-tokens required
```

#### Quick Install

```bash
# SSH into EC2
ssh ec2-user@<ec2-ip>

# One-line install (Docker + Git + SentinAI)
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

The script automatically installs Docker, Docker Compose, Git, clones the repository, and guides you through environment configuration.

#### Manual Install

```bash
# 1. Install Docker (Amazon Linux 2023)
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Re-login for group change to take effect

# 2. Install Docker Compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
COMPOSE_VER=$(curl -sL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
sudo curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 3. Clone and configure
git clone https://github.com/tokamak-network/SentinAI.git /opt/sentinai
cd /opt/sentinai
cp .env.local.sample .env.local
# Edit .env.local: set L2_RPC_URL, ANTHROPIC_API_KEY, AWS_CLUSTER_NAME

# 4. Start (builds Docker image with aws-cli + kubectl included)
docker compose up -d

# 5. Verify
curl http://localhost:3002/api/health
```

#### Operations

```bash
cd /opt/sentinai

# View logs
docker compose logs -f sentinai

# Update to latest version
git pull origin main && docker compose build && docker compose up -d

# Stop services
docker compose down

# Stop and remove all data (Redis, reports)
docker compose down -v
```

### Public Access with Cloudflare Tunnel (HTTPS + Auth)

SentinAI has no built-in authentication. Use Cloudflare Tunnel + Access to expose the dashboard securely with HTTPS and email-based login.

```
User → Cloudflare Edge (HTTPS + Access auth)
         ↓ (encrypted tunnel)
       cloudflared container (EC2)
         ↓ (Docker internal network)
       sentinai:8080
```

#### 1. Create Tunnel on Cloudflare

1. Sign up at [Cloudflare Zero Trust](https://one.dash.cloudflare.com) (free)
2. Add a domain to Cloudflare (or register one, e.g. `.xyz` ~$2/year)
3. Go to **Networks → Tunnels → Create a Tunnel**
4. Name: `sentinai`, copy the **Tunnel Token**
5. Add **Public Hostname**:
   - Subdomain: `sentinai` (e.g. `sentinai.yourdomain.com`)
   - Service: `http://sentinai:8080`
6. Go to **Access → Applications → Add Application**
   - Domain: `sentinai.yourdomain.com`
   - Policy: Allow specific email addresses

#### 2. Add Token to .env.local

```bash
# Add to .env.local
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYWJj...
```

#### 3. Start with Tunnel

```bash
# Start with tunnel profile
docker compose --profile tunnel up -d

# Verify tunnel is running
docker compose logs cloudflared
```

The dashboard is now accessible at `https://sentinai.yourdomain.com` with Cloudflare Access authentication.

#### Security Group Update

With Cloudflare Tunnel, inbound port 3002 is no longer needed:

| Direction | Port | Source | Purpose |
|-----------|------|--------|---------|
| Inbound | 22 | Admin IP | SSH only |
| Outbound | 443 | 0.0.0.0/0 | AI API + AWS API + Cloudflare |

### Google Cloud Run

#### Prerequisites
1. Google Cloud SDK installed: `gcloud --version`
2. Docker installed: `docker --version`
3. Authenticated to GCP: `gcloud auth login`
4. GCP project created

#### Quick Deploy

```bash
# 1. Set your GCP project
gcloud config set project YOUR_PROJECT_ID

# 2. Enable required APIs
gcloud services enable run.googleapis.com containerregistry.googleapis.com

# 3. Edit deploy script
nano deploy-cloudrun.sh  # Change PROJECT_ID

# 4. Deploy
./deploy-cloudrun.sh
```

#### Environment Variables

See [CLOUDRUN_ENV_SETUP.md](./CLOUDRUN_ENV_SETUP.md) for detailed instructions.

Quick setup:
```bash
gcloud run services update sentinai \
  --region asia-northeast3 \
  --set-env-vars "L2_RPC_URL=https://your-rpc.com,AWS_REGION=ap-northeast-2"
```

### Local Docker Test

```bash
# Build image
docker build -t sentinai:local .

# Run locally
docker run -p 8080:8080 \
  -e L2_RPC_URL="https://..." \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  sentinai:local
```
