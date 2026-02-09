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

## 2. AI Provider (Required for AI Features)

SentinAI는 다수의 AI 프로바이더를 지원합니다. **하나만 선택**하세요.

### Option 1: Anthropic Direct API (권장)

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

*   **Models**: `claude-haiku-4-5-20251001` (fast), `claude-opus-4-6` (best)
*   **How to Obtain**: [Anthropic Console](https://console.anthropic.com/) → API Keys → Create Key

### Option 2: OpenAI Direct API

```bash
OPENAI_API_KEY=sk-...
```

*   **Models**: `gpt-4.1-mini` (fast), `gpt-4.1` (best)
*   **How to Obtain**: [OpenAI Platform](https://platform.openai.com/) → API Keys → Create new secret key

### Option 3: Google Gemini Direct API

```bash
GEMINI_API_KEY=AIza...
```

*   **Models**: `gemini-2.5-flash-lite` (fast), `gemini-2.5-pro` (best)
*   **How to Obtain**: [Google AI Studio](https://aistudio.google.com/) → Get API Key

### Option 4: LiteLLM Gateway (레거시)

기존 LiteLLM 게이트웨이를 사용하려면 `AI_GATEWAY_URL`을 명시적으로 설정합니다.
이 경우 위 API 키 중 하나와 함께 설정해야 합니다.

```bash
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-litellm-key
```

### Provider 감지 우선순위

| 우선순위 | 조건 | 사용 프로바이더 |
|---------|------|---------------|
| 1 | `AI_GATEWAY_URL` 설정됨 | LiteLLM Gateway |
| 2 | `ANTHROPIC_API_KEY`만 설정 | Anthropic Direct |
| 3 | `OPENAI_API_KEY`만 설정 | OpenAI Direct |
| 4 | `GEMINI_API_KEY`만 설정 | Gemini Direct |

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

---

## 4. Alert (Optional)

### `ALERT_WEBHOOK_URL`
이상 탐지 파이프라인(Layer 3)에서 `high`/`critical` 심각도 이벤트 발생 시 알림을 전송할 웹훅 URL입니다.

*   **Default**: 미설정 (웹훅 알림 비활성화)
*   **Example**: `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`
*   **How to Obtain**:
    1. Slack > Settings & Administration > Manage Apps > Incoming Webhooks
    2. 채널을 선택하고 Webhook URL을 생성
    3. 생성된 URL을 `.env.local`에 설정

---

## 5. Cost Tracking (Optional)

### `COST_TRACKING_ENABLED`
vCPU 사용 패턴 추적을 활성화/비활성화합니다. 활성화 시 최대 7일간의 사용량 데이터를 수집하여 시간대별 프로파일링 및 비용 최적화 분석에 활용합니다.

*   **Default**: `true` (미설정 시 활성화)
*   **Values**: `true` | `false`
*   **비활성화**: `COST_TRACKING_ENABLED=false`로 설정하면 사용량 데이터 수집을 중단합니다.
