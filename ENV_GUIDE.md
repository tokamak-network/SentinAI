# SentinAI Environment Configuration Guide (`.env.local`)

Recommended: use the interactive setup wizard.

```bash
npm run setup
```

Or copy the sample and configure manually:

```bash
cp .env.local.sample .env.local
```

---

## Quick Start (3 variables)

For full functionality, you only need these 3 variables:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=your-api-key-here
AWS_CLUSTER_NAME=my-cluster-name
```

`K8S_API_URL` and `AWS_REGION` are **auto-detected** at runtime from `AWS_CLUSTER_NAME`.

---

## 1. L2 Chain RPC (Required)

### `L2_RPC_URL`
RPC endpoint for communicating with the Optimism-based L2 network.

*   **Example Value**: `https://rpc.titok.tokamak.network` or `http://localhost:8545`
*   **How to Obtain**:
    *   **Public Network**: Check the "Network Information" section in the official documentation of the L2 project.
    *   **Private/Local Network**: Use the IP and Port (default 8545) of your `op-geth` node if running locally.
    *   **Node Providers**: Issue from dashboards of providers like Alchemy, Infura, QuickNode, etc.

---

## 2. AI Configuration (Required for Log Analysis)

### `AI_GATEWAY_URL`
The address of the internal AI Gateway or external LLM API.
*   **Default**: `https://api.ai.tokamak.network` (When using Tokamak Network API Server)
*   **Self-hosted**: Enter your custom AI Gateway address.

### `ANTHROPIC_API_KEY`
API Key for using the Anthropic Claude model (via LiteLLM).
*   **How to Obtain**:
    1. Go to [LiteLLM dashboard](https://api.ai.tokamak.network/ui/) and log in (ask administrator for account).
    2. Click on "Create New Key".
    3. Enter "Key name", select "Model", and click "Create Key".
    4. Copy the generated key and paste it into your `.env.local` file.

---

## 3. AWS EKS / Kubernetes (Required for Infrastructure Monitoring)

### `AWS_CLUSTER_NAME`
Name of the EKS Cluster. This is the **only required variable** for K8s monitoring — the rest is auto-detected.
*   **How to Obtain**:
    *   **AWS Console**: Go to EKS > Clusters list.
    *   **CLI**: `aws eks list-clusters`
    *   **`npm run setup`**: Automatically lists clusters for selection.

### Auto-Detected Variables

The following are resolved automatically at runtime:

| Variable | Auto-Detection Method | Manual Override |
|----------|----------------------|-----------------|
| `K8S_API_URL` | `aws eks describe-cluster --name <cluster>` | Set `K8S_API_URL` env var |
| `AWS_REGION` | `AWS_REGION` env > `aws configure get region` | Set `AWS_REGION` env var |
| Auth Token | `aws eks get-token --cluster-name <cluster>` | Set `K8S_TOKEN` env var |

### AWS Authentication

No need to put AWS credentials in `.env.local`. SentinAI uses the standard AWS credential chain:

1. **`aws configure`** (recommended for local development)
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Access Key, Region, Output format
   ```
2. **Environment Variables** (for Docker/CI)
   ```bash
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   ```
3. **IAM Role** (for EKS/EC2/Fargate deployments — no config needed)

**Required Permissions**: `eks:DescribeCluster`, `eks:ListClusters`, and cluster RBAC mapping (e.g., `system:masters` or `view` role).

### Optional K8s Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `K8S_NAMESPACE` | `default` | Namespace where L2 pods are deployed |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (e.g., `app=op-geth`) |
| `KUBECONFIG` | — | Path to kubeconfig file (alternative to EKS auto-detection) |
