# SentinAI Environment Configuration Guide (`.env.local`)

This document explains how to obtain the necessary environment variables to run the `SentinAI` project.
Copy the `.env.local.sample` file to `.env.local` and fill in the values.

```bash
cp .env.local.sample .env.local
```

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

### `GEMINI_API_KEY`
API Key for using the Google Gemini model (via LiteLLM).
*   **How to Obtain**:
    1. Go to [LiteLLM dashboard](https://api.ai.tokamak.network/ui/) and log in (ask administrator for account).
    2. Click on "Create New Key".
    3. Enter "Key name", select "Model", and click "Create Key".
    4. Copy the generated key and paste it into your `.env.local` file.

---

## 3. Kubernetes Configuration (Required for Infrastructure Monitoring)

### `K8S_NAMESPACE`
The Kubernetes namespace where the target pods are deployed.
*   **Default**: `default`
*   **How to Check**: Run `kubectl get namespaces` or ask your DevOps engineer.

### `K8S_APP_PREFIX`
Prefix for resource identification.
*   **Default**: `op`
*   **Description**: The code monitors resources by looking for labels like `app=${PREFIX}-geth` and `app=${PREFIX}-node`. Follow the labeling convention of your deployed Helm Chart or Manifest.

---

## 4. AWS EKS Connection (Required if using AWS)

This configuration is required when querying pod information from *outside* the K8s cluster (e.g., local development or Docker container). Not needed for In-Cluster deployments with ServiceAccount.

### `AWS_CLUSTER_NAME`
*   **Description**: Name of the EKS Cluster.
*   **How to Obtain**: Check in AWS Console > EKS > Clusters list.

### `K8S_API_URL`
*   **Description**: Endpoint URL of the Kubernetes API server.
*   **How to Obtain**:
    *   **AWS Console**: Select EKS > Cluster > Check "API server endpoint".
    *   **CLI**: `aws eks describe-cluster --name <CLUSTER_NAME> --query "cluster.endpoint"`

### `AWS_REGION`
*   **Description**: AWS Region code where the cluster is located.
*   **Example**: `ap-northeast-2` (Seoul), `us-east-1` (Virginia)

### `AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY`
*   **Description**: Access keys for an IAM user with permission to access the EKS cluster.
*   **How to Obtain**:
    1. Go to AWS Console > IAM > Users.
    2. Click "Add users" > Create user (permissions setup required).
    3. Go to the "Security credentials" tab of the created user.
    4. Click "Create access key" > Select "Local code" and generate the key.
*   **Required Permissions**: Must include at least `eks:DescribeCluster` and be mapped to the cluster's RBAC (e.g., `system:masters` or `view` role).
