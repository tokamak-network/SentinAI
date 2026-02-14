# SentinAI 환경변수 설정 가이드

## Quick Start — 3개면 끝

```bash
cp .env.local.sample .env.local
```

```bash
# 1. L2 체인 RPC (필수)
L2_RPC_URL=https://your-l2-rpc-endpoint.com

# 2. AI Provider — 하나만 고르세요
ANTHROPIC_API_KEY=sk-ant-...     # 권장

# 3. K8s 클러스터 (인프라 모니터링 필요 시)
AWS_CLUSTER_NAME=my-cluster-name
```

이 3개만 설정하면 SentinAI가 동작합니다. 나머지는 전부 선택사항이고 합리적인 기본값이 있습니다.

---

## 1. L2 Chain RPC (필수)

| 변수 | 예시 |
|---|---|
| `L2_RPC_URL` | `https://rpc.titok.tokamak.network` 또는 `http://localhost:8545` |

**어디서 얻나요?**
- **퍼블릭 네트워크**: L2 프로젝트 공식 문서의 "Network Info" 참조
- **로컬 노드**: op-geth 노드의 IP:8545
- **노드 프로바이더**: Alchemy, Infura, QuickNode 등에서 발급

---

## 2. AI Provider (AI 기능 필수)

**하나만 선택하세요.** 여러 개를 설정하면 아래 우선순위로 동작합니다.

| 우선순위 | Provider | 환경변수 | 모델 (fast / best) |
|:---:|---|---|---|
| 1 | Qwen | `QWEN_API_KEY` | qwen-turbo / qwen-max |
| 2 | **Anthropic** (권장) | `ANTHROPIC_API_KEY` | claude-haiku-4.5 / claude-sonnet-4.5 |
| 3 | OpenAI | `OPENAI_API_KEY` | gpt-4.1-mini / gpt-4.1 |
| 4 | Gemini | `GEMINI_API_KEY` | gemini-2.5-flash-lite / gemini-2.5-pro |

### API 키 발급 방법

| Provider | 발급 페이지 |
|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) → API Keys |
| OpenAI | [platform.openai.com](https://platform.openai.com/) → API Keys |
| Gemini | [aistudio.google.com](https://aistudio.google.com/) → Get API Key |
| Qwen | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) → API Keys |

### AI Gateway (선택)

LiteLLM 같은 프록시를 통해 모든 AI 요청을 라우팅하려면:

```bash
AI_GATEWAY_URL=https://your-gateway.com
ANTHROPIC_API_KEY=your-key   # 게이트웨이용 키
```

---

## 3. K8s 모니터링 (선택)

Kubernetes 인프라 모니터링이 필요할 때만 설정하세요. 설정하지 않으면 K8s 관련 기능이 자동으로 비활성화됩니다.

### 필수 (1개)

| 변수 | 설명 |
|---|---|
| `AWS_CLUSTER_NAME` | EKS 클러스터 이름. 이것만 설정하면 API URL, 리전, 인증 토큰이 자동 감지됩니다. |

```bash
# 클러스터 이름 확인
aws eks list-clusters
```

### 자동 감지되는 값들

| 항목 | 자동 감지 방법 | 수동 오버라이드 |
|---|---|---|
| API URL | `aws eks describe-cluster` | `K8S_API_URL` |
| 리전 | `AWS_REGION` > `aws configure` | `AWS_REGION` |
| 인증 토큰 | `aws eks get-token` | `K8S_TOKEN` |

### AWS 인증

`.env.local`에 AWS 자격증명을 넣을 필요 없습니다. 표준 AWS 인증 체인을 사용합니다:

1. **`aws configure`** — 로컬 개발 시 권장
2. **환경변수** — Docker/CI용 (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`)
3. **IAM Role** — EC2/EKS 배포 시 (설정 불필요)

**필요 권한**: `eks:DescribeCluster`, `eks:ListClusters`, 클러스터 RBAC (`system:masters` 또는 `view`)

### 선택 설정

| 변수 | 기본값 | 설명 |
|---|---|---|
| `K8S_NAMESPACE` | `default` | L2 Pod가 배포된 네임스페이스 |
| `K8S_APP_PREFIX` | `op` | Pod 라벨 접두사 (`app=op-geth`) 및 StatefulSet/ConfigMap 이름 접두사 |
| `AWS_REGION` | 자동감지 | EKS 리전 |
| `KUBECONFIG` | — | kubeconfig 파일 경로 (EKS 자동감지 대신 사용) |
| `K8S_INSECURE_TLS` | `false` | TLS 검증 스킵 (자체 서명 인증서, dev only) |

---

## 4. L1 RPC (선택)

SentinAI가 L1 체인 모니터링에 사용하는 RPC입니다. 설정하지 않으면 publicnode.com 퍼블릭 엔드포인트를 사용합니다.

```bash
# 콤마로 여러 URL 지정 → 자동 failover
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org
```

> ⚠️ `L1_RPC_URL` (단수)은 deprecated입니다. `L1_RPC_URLS`를 사용하세요.

### L1 Proxyd 연동 (선택)

op-node/batcher/proposer가 Proxyd를 통해 L1에 연결되는 경우:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `L1_PROXYD_ENABLED` | `false` | Proxyd 모드 활성화 |
| `L1_PROXYD_CONFIGMAP_NAME` | `proxyd-config` | Proxyd ConfigMap 이름 |
| `L1_PROXYD_DATA_KEY` | `proxyd.toml` | ConfigMap 내 TOML 키 |
| `L1_PROXYD_UPSTREAM_GROUP` | `main` | 업데이트할 upstream 그룹 |
| `L1_PROXYD_UPDATE_MODE` | `replace` | `replace` 또는 `append` |
| `L1_PROXYD_SPARE_URLS` | — | 429 에러 시 교체용 예비 RPC URL (콤마 구분) |

자세한 설정은 [proxyd-failover-setup.md](./proxyd-failover-setup.md) 참조.

---

## 5. EOA 잔액 모니터링 (선택)

Batcher/Proposer의 L1 ETH 잔액을 모니터링하고, 부족 시 자동으로 충전합니다.

### EOA 주소 설정 (우선순위)

```bash
# 방법 1: 주소 직접 입력
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...

# 방법 2: 프라이빗 키에서 자동 파생
BATCHER_PRIVATE_KEY=0x...
PROPOSER_PRIVATE_KEY=0x...
```

둘 다 설정하지 않으면 L1 트랜잭션 분석을 통해 자동 감지를 시도합니다.

### 임계치

| 변수 | 기본값 | 설명 |
|---|---|---|
| `EOA_BALANCE_WARNING_ETH` | `0.5` | 경고 알림 발생 |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | 자동 충전 + 운영자 에스컬레이션 |

### 자동 충전 (선택)

Treasury 지갑을 설정하면 critical 시 자동 충전합니다. 생략하면 모니터링만 합니다.

```bash
TREASURY_PRIVATE_KEY=0x...   # Treasury 지갑 프라이빗 키
```

<details>
<summary>고급 충전 설정 (기본값이면 충분합니다)</summary>

| 변수 | 기본값 | 설명 |
|---|---|---|
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | 1회 충전량 (ETH) |
| `EOA_REFILL_MAX_DAILY_ETH` | `5.0` | 일일 충전 상한 (ETH) |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | 같은 EOA 재충전 대기 시간 (분) |
| `EOA_GAS_GUARD_GWEI` | `100` | L1 가스비가 이 이상이면 충전 보류 (gwei) |
| `EOA_TREASURY_MIN_ETH` | `1.0` | Treasury 최소 잔액 — 이하면 충전 거부 (ETH) |

</details>

---

## 6. 알림 (선택)

```bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

이상 탐지 시 `high`/`critical` 이벤트를 웹훅으로 전송합니다. Slack Incoming Webhook, Discord Webhook 등 사용 가능.

---

## 7. 기타 선택 설정

| 변수 | 기본값 | 설명 |
|---|---|---|
| `REDIS_URL` | — | Redis 상태 저장소. 미설정 시 인메모리 (재시작 시 초기화) |
| `COST_TRACKING_ENABLED` | `true` | vCPU 사용량 추적 |
| `AGENT_LOOP_ENABLED` | `true` | 자율 모니터링 루프 (L2_RPC_URL 설정 시 자동 활성화) |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 자동 복구 (신중하게 활성화) |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel로 대시보드 HTTPS 공개 |

---

## 전체 변수 요약

### 필수 (1개)
| 변수 | 설명 |
|---|---|
| `L2_RPC_URL` | L2 체인 RPC 엔드포인트 |

### AI (1개 필수)
| 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (권장) |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `GEMINI_API_KEY` | Google Gemini API 키 |
| `QWEN_API_KEY` | Qwen (DashScope) API 키 |
| `AI_GATEWAY_URL` | AI Gateway/프록시 URL |

### K8s (선택)
| 변수 | 설명 |
|---|---|
| `AWS_CLUSTER_NAME` | EKS 클러스터 이름 |
| `K8S_NAMESPACE` | K8s 네임스페이스 |
| `K8S_APP_PREFIX` | 앱 접두사 |
| `AWS_REGION` | AWS 리전 |

### L1 RPC (선택)
| 변수 | 설명 |
|---|---|
| `L1_RPC_URLS` | L1 RPC 엔드포인트 (콤마 구분) |

### EOA (선택)
| 변수 | 설명 |
|---|---|
| `BATCHER_EOA_ADDRESS` | Batcher EOA 주소 |
| `PROPOSER_EOA_ADDRESS` | Proposer EOA 주소 |
| `TREASURY_PRIVATE_KEY` | 자동 충전용 Treasury 키 |
| `EOA_BALANCE_WARNING_ETH` | 경고 임계치 |
| `EOA_BALANCE_CRITICAL_ETH` | 위험 임계치 |

### 기타 (선택)
| 변수 | 설명 |
|---|---|
| `ALERT_WEBHOOK_URL` | 알림 웹훅 URL |
| `REDIS_URL` | Redis 상태 저장소 |
| `COST_TRACKING_ENABLED` | 비용 추적 |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel |
