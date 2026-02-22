# SentinAI Environment Configuration Guide

## Quick Start — Just 3 Variables

```bash
# Choose one template by chain type:
cp .env.thanos.example .env.local
# cp .env.optimism.example .env.local
# cp .env.zkstack.example .env.local
```

```bash
# 1. L2 Chain RPC (required)
L2_RPC_URL=https://your-l2-rpc-endpoint.com

# 2. AI Provider — pick one
ANTHROPIC_API_KEY=sk-ant-...     # recommended

# 3. K8s Cluster (if you need infrastructure monitoring)
AWS_CLUSTER_NAME=my-cluster-name
```

These 3 variables are all you need to get SentinAI running. Everything else is optional with sensible defaults.

---

## 1. L2 Chain RPC (Required)

| Variable | Example |
|---|---|
| `L2_RPC_URL` | `https://rpc.titok.tokamak.network` or `http://localhost:8545` |

**Where to get it:**
- **Public network**: Check the "Network Info" section in the L2 project's official docs
- **Local node**: Your op-geth node's IP:8545
- **Node providers**: Alchemy, Infura, QuickNode, etc.

---

## 2. AI Provider (Required for AI Features)

**Pick one.** If multiple keys are set, the priority order below applies.

| Priority | Provider | Variable | Models (fast / best) |
|:---:|---|---|---|
| 1 | Qwen | `QWEN_API_KEY` | qwen3-coder-flash / qwen3-80b-next |
| 2 | **Anthropic** (recommended) | `ANTHROPIC_API_KEY` | claude-haiku-4.5 / claude-sonnet-4.5 |
| 3 | OpenAI | `OPENAI_API_KEY` | gpt-4.1-mini / gpt-4.1 |
| 4 | Gemini | `GEMINI_API_KEY` | gemini-2.5-flash-lite / gemini-2.5-pro |

### Getting API Keys

| Provider | Where to get it |
|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) → API Keys |
| OpenAI | [platform.openai.com](https://platform.openai.com/) → API Keys |
| Gemini | [aistudio.google.com](https://aistudio.google.com/) → Get API Key |
| Qwen | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) → API Keys |

### AI Gateway (Optional)

To route all AI requests through a proxy like LiteLLM:

```bash
AI_GATEWAY_URL=https://your-gateway.com
ANTHROPIC_API_KEY=your-key   # key for the gateway
```

---

## 3. K8s Monitoring (Optional)

Only configure this if you need Kubernetes infrastructure monitoring. Without it, K8s features are automatically disabled.

### Required (1 variable)

| Variable | Description |
|---|---|
| `AWS_CLUSTER_NAME` | EKS cluster name. This is all you need — API URL, region, and auth token are auto-detected. |

```bash
# Find your cluster name
aws eks list-clusters
```

### Auto-Detected Values

| Item | Auto-Detection Method | Manual Override |
|---|---|---|
| API URL | `aws eks describe-cluster` | `K8S_API_URL` |
| Region | `AWS_REGION` > `aws configure` | `AWS_REGION` |
| Auth Token | `aws eks get-token` | `K8S_TOKEN` |

### AWS Authentication

No need to put AWS credentials in `.env.local`. SentinAI uses the standard AWS credential chain:

1. **`aws configure`** — recommended for local development
2. **Environment variables** — for Docker/CI (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`)
3. **IAM Role** — for EC2/EKS deployments (no config needed)

**Required permissions**: `eks:DescribeCluster`, `eks:ListClusters`, and cluster RBAC mapping (e.g., `system:masters` or `view` role).

### Optional K8s Settings

| Variable | Default | Description |
|---|---|---|
| `K8S_NAMESPACE` | `default` | Namespace where L2 pods are deployed |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (e.g., `app=op-geth`) and StatefulSet/ConfigMap name prefix |
| `AWS_REGION` | auto-detected | AWS region |
| `KUBECONFIG` | — | Path to kubeconfig file (alternative to EKS auto-detection) |
| `K8S_INSECURE_TLS` | `false` | Skip TLS verification (self-signed certs, dev only) |

---

## 4. L1 RPC (Optional)

SentinAI separates L1 RPC usage into two paths:

1. **SentinAI internal read/monitoring path**
2. **L2 node failover path (op-node/op-batcher/op-proposer)**

```bash
# SentinAI internal monitoring RPC (optional)
SENTINAI_L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# L2 node failover pool (comma-separated)
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org
```

Notes:
- `SENTINAI_L1_RPC_URL` is optional and defaults to publicnode.com.
- `L1_RPC_URLS` is used for L2 failover target list and Proxyd spare replacement pool.
- `L1_RPC_URL` (singular) is deprecated. Use `SENTINAI_L1_RPC_URL`.

### L1 Proxyd Integration (Optional)

If op-node/batcher/proposer connect to L1 through Proxyd:

| Variable | Default | Description |
|---|---|---|
| `L1_PROXYD_ENABLED` | `false` | Enable Proxyd mode |
| `L1_PROXYD_CONFIGMAP_NAME` | `proxyd-config` | Proxyd ConfigMap name |
| `L1_PROXYD_DATA_KEY` | `proxyd-config.toml` | TOML key in ConfigMap |
| `L1_PROXYD_UPSTREAM_GROUP` | `main` | Upstream group to update |
| `L1_PROXYD_UPDATE_MODE` | `replace` | `replace` or `append` |
| `L1_PROXYD_SPARE_URLS` | — | Spare RPC URLs for 429 auto-replacement (comma-separated) |

See [proxyd-failover-setup.md](./proxyd-failover-setup.md) for details.

---

## 5. EOA Balance Monitoring (Optional)

Monitors batcher/proposer L1 ETH balances and auto-refills when low.

### EOA Address Configuration (priority order)

```bash
# Option 1: Specify addresses directly
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...

# Option 2: Derive from private keys
BATCHER_PRIVATE_KEY=0x...
PROPOSER_PRIVATE_KEY=0x...
```

If neither is set, SentinAI attempts auto-detection via L1 transaction analysis.

### Thresholds

| Variable | Default | Description |
|---|---|---|
| `EOA_BALANCE_WARNING_ETH` | `0.5` | Triggers warning alert |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | Triggers auto-refill + operator escalation |

### Auto-Refill (Optional)

Set a treasury wallet to enable auto-refill at critical level. Omit for monitor-only mode.

```bash
TREASURY_PRIVATE_KEY=0x...   # Treasury wallet private key
```

<details>
<summary>Advanced refill settings (defaults are usually fine)</summary>

| Variable | Default | Description |
|---|---|---|
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | Amount per refill (ETH) |
| `EOA_REFILL_MAX_DAILY_ETH` | `5.0` | Daily refill cap (ETH) |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | Cooldown between refills per EOA (minutes) |
| `EOA_GAS_GUARD_GWEI` | `100` | Skip refill if L1 gas exceeds this (gwei) |
| `EOA_TREASURY_MIN_ETH` | `1.0` | Min treasury balance to allow refill (ETH) |

</details>

---

## 6. Alerts (Optional)

```bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

Sends `high`/`critical` anomaly events via webhook. Compatible with Slack Incoming Webhooks, Discord Webhooks, etc.

---

## 7. Other Optional Settings

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | — | Redis state store. Without it, state is in-memory (resets on restart) |
| `COST_TRACKING_ENABLED` | `true` | Track vCPU usage patterns |
| `AGENT_LOOP_ENABLED` | `true` | Autonomous monitoring loop (auto-enabled when L2_RPC_URL is set) |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 auto-remediation (enable with caution) |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Expose dashboard via Cloudflare Tunnel with HTTPS |

---

## 8. ZK Stack Template (Optional)

When integrating with ZK Stack, do not refer to the `external` path directly but use a template.

- Template dir: `examples/zkstack/`
- Env template: `examples/zkstack/.env.example`
- Core-only compose template: `examples/zkstack/docker-compose.core-only.yml`
- Container secrets template: `examples/zkstack/secrets.container.yaml.example`
- Probe schema: `examples/zkstack/settlement-probe-response.example.json`

Additional variables:

| Variable | Description |
|---|---|
| `CHAIN_TYPE` | `zkstack` |
| `ZKSTACK_MODE` | `legacy-era` or `os-preview` |
| `ZK_BATCHER_STATUS_URL` | Settlement probe endpoint |
| `ZK_PROOF_RPC_URL` | Proof probe endpoint (optional) |
| `ZK_SETTLEMENT_LAYER` | `l1` or `gateway` |
| `ZK_FINALITY_MODE` | `confirmed`, `finalized`, `verified` |
| `ZKSTACK_EXECUTION_SERVICE` | Docker service mapping for execution |
| `ZKSTACK_BATCHER_SERVICE` | Docker service mapping for batcher |
| `ZKSTACK_PROVER_SERVICE` | Docker service mapping for prover (core-only 기본값: `zkstack-core`) |
| `ZKSTACK_COMPONENT_PROFILE` | `core-only` or `full` (docker 모드 기본: `core-only`) |

---

## Variable Summary

### Required (1)
| Variable | Description |
|---|---|
| `L2_RPC_URL` | L2 chain RPC endpoint |

### AI (1 required)
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (recommended) |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `QWEN_API_KEY` | Qwen (DashScope) API key |
| `AI_GATEWAY_URL` | AI gateway/proxy URL |

### K8s (optional)
| Variable | Description |
|---|---|
| `AWS_CLUSTER_NAME` | EKS cluster name |
| `K8S_NAMESPACE` | K8s namespace |
| `K8S_APP_PREFIX` | App prefix |
| `AWS_REGION` | AWS region |

### L1 RPC (optional)
| Variable | Description |
|---|---|
| `SENTINAI_L1_RPC_URL` | SentinAI internal monitoring L1 RPC |
| `L1_RPC_URLS` | L2 node failover endpoint list (comma-separated) |

### EOA (optional)
| Variable | Description |
|---|---|
| `BATCHER_EOA_ADDRESS` | Batcher EOA address |
| `PROPOSER_EOA_ADDRESS` | Proposer EOA address |
| `TREASURY_PRIVATE_KEY` | Treasury key for auto-refill |
| `EOA_BALANCE_WARNING_ETH` | Warning threshold |
| `EOA_BALANCE_CRITICAL_ETH` | Critical threshold |

### Other (optional)
| Variable | Description |
|---|---|
| `ALERT_WEBHOOK_URL` | Alert webhook URL |
| `REDIS_URL` | Redis state store |
| `COST_TRACKING_ENABLED` | Cost tracking |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel |
