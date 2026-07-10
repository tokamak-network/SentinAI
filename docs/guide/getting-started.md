# Getting Started — 15분 안에 SentinAI 눈으로 확인하기

SentinAI를 처음 접하는 개발자를 위한 최단 경로 가이드입니다. 각 항목의
전체 옵션·상세 설명은 원본 문서(README.md, ENV_GUIDE.md, ARCHITECTURE.md)로
링크만 걸어두었으니, 여기서는 "무엇을 언제 선택할지"만 판단하세요.

---

## 1. 사전 요구사항 (최소)

아래 3가지만 있으면 시작할 수 있습니다.

| 필요한 것 | 왜 필요한가 |
|---|---|
| Docker (+ Docker Compose) | 상태 저장소(Redis)와 배포 컨테이너 실행 |
| L2 Chain RPC URL | 모니터링할 L2 노드의 RPC 엔드포인트 |
| AI API 키 1개 | Qwen / Anthropic / OpenAI / Gemini 중 아무거나 하나 |

K8s(EKS) 클러스터 접근, 도메인, EOA 주소 같은 나머지는 전부 **선택 사항**이며
없어도 동작합니다. → 전체 옵션은 [ENV_GUIDE.md](../../ENV_GUIDE.md) 참고.

---

## 2. 경로 선택

| 상황 | 선택 | 소요 시간 |
|---|---|---|
| 로컬에서 UI/NLOps 챗을 눈으로만 확인하고 싶다 | **Path A: 로컬 체험** | ~5분 |
| 실제 L2 노드를 모니터링/스케일링하는 인스턴스를 세워야 한다 | **Path B: 프로덕션 배포** | ~15분 |

### Path A — 로컬 체험 (`npm run dev`)

Redis만 Docker로 띄우고, 앱 자체는 로컬 Node.js로 실행합니다.

```bash
docker compose -f docker-compose.dev.yml up -d   # Redis 컨테이너
npm install
cp .env.thanos.example .env.local                # 또는 .env.optimism.example / .env.zkstack.example
# .env.local 에 L2_RPC_URL, AI 키 1개 채우기
npm run dev                                       # http://localhost:3002
```

상세: [README.md § Setup](../../README.md#setup)

### Path B — 프로덕션 배포 (설치 스크립트)

Ubuntu/Amazon Linux 서버에서 스크립트 2개가 Docker, 클론, `.env.local`, HTTPS까지
전부 처리합니다.

```bash
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/setup-server.sh | bash
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

상세: [README.md § Deployment](../../README.md#deployment) (비대화형/CI 설치, IAM 정책, EKS RBAC, IMDSv2 설정 포함)

---

## 3. 필수 환경변수 최소셋

전체 목록은 [ENV_GUIDE.md](../../ENV_GUIDE.md)에 60개 이상 있지만, 아래만 채우면
기본 동작합니다. 나머지는 전부 안전한 기본값을 씁니다.

| 변수 | 필요 시점 | 설명 |
|---|---|---|
| `L2_RPC_URL` | 항상 | 모니터링할 L2 RPC 엔드포인트 |
| `QWEN_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` 중 1개 | 항상 | AI 분석용 (우선순위: Gateway > Qwen > Anthropic > OpenAI > Gemini) |
| `SENTINAI_API_KEY` | Path B (프로덕션) | 32자 이상 랜덤 값. 없으면 쓰기 API가 전부 401로 막힘 (`openssl rand -hex 32`) |
| `AWS_CLUSTER_NAME` | EKS를 모니터링할 때만 | K8S_API_URL/리전을 자동 감지 |

`REDIS_URL`은 Path B(Docker Compose)에서는 `docker-compose.yml`이 자동으로
채워주므로 직접 설정할 필요 없습니다.

---

## 4. 배포 직후 확인 (3단계)

**① 헬스체크**
```bash
curl http://localhost:3002/api/health
```
`"status": "ok"` 와 `chain` 필드에 선택한 체인 타입이 보이면 정상입니다.

**② 대시보드 접속**

브라우저로 `http://localhost:3002` (Path A/B 공통, Path B에서 도메인을
지정했다면 `https://<도메인>`) 접속 — 첫 실행 시 환경변수 기반으로
자동 온보딩되어 `/v2` 인스턴스가 바로 생성됩니다.

**③ NLOps 챗에 테스트 프롬프트 입력**

대시보드 내 NLOps 챗 입력창에 자연어로 질문해봅니다:

```
지금 스케일링 상태 어때?
```

메트릭 기반 응답이 돌아오면 RPC 연결과 AI 키가 모두 정상 작동 중인 것입니다.

---

## 5. 흔한 실패 Top 3

| 증상 | 원인 | 확인 방법 |
|---|---|---|
| `docker compose up` 후 `sentinai` 컨테이너가 계속 대기/재시작 | `sentinai`는 `redis`가 `service_healthy`가 될 때까지 기동하지 않음 (`docker-compose.yml`) | `docker compose logs redis` 로 Redis 기동 여부 확인 |
| `npm run dev`로만 실행했는데 스케일링 쿨다운/메트릭이 재시작할 때마다 초기화됨 | `docker-compose.dev.yml`로 Redis를 안 띄우면 상태 저장소가 InMemory로 폴백 (동작은 하지만 재시작 시 유실) | `docker compose -f docker-compose.dev.yml up -d` 로 Redis 기동 후 재시작 |
| EC2에서 EKS 모니터링이 계속 실패 | IMDSv2 hop-limit이 기본값(1)이라 Docker 컨테이너가 EC2 IAM Role에 접근 못 함 | [README.md § IMDSv2 Hop Limit](../../README.md#imdsv2-hop-limit-ec2-only) 참고해 hop-limit ≥ 2로 설정 |

AI 요청이 계속 실패한다면 우선 [ENV_GUIDE.md § AI Provider](../../ENV_GUIDE.md#ai-provider)의
우선순위 표대로 키를 1개만 설정했는지, `AI_GATEWAY_URL`을 쓰는 경우 게이트웨이
자체가 살아있는지부터 확인하세요.

---

## 6. 외부 L2 노드 운영자가 자기 Claude Code 세션에 SentinAI를 붙이고 싶을 때

SentinAI를 배포/운영하는 사람이 아니라, **그 SentinAI가 관찰하는 L2 노드를
운영하는 사람**이 자신의 Claude Code 세션에서 자연어로 SentinAI 데이터를
조회하고 싶은 경우입니다.

```bash
export SENTINAI_BASE_URL=http://my-sentinai.internal:3002
export SENTINAI_API_KEY=<운영자용 키>
bash <(curl -fsSL ${SENTINAI_BASE_URL}/install-operator-pack.sh)
```

설치 후 `/sentinai-status`를 실행하면 연결이 확인됩니다. 운영자에게 쓰기
권한(재시작/스케일링)까지 주고 싶지 않다면, SentinAI 서버를
`MCP_OPERATOR_PROFILE=readonly`로 구동하세요 — 쓰기 툴이 MCP 매니페스트에서
아예 제거됩니다.

상세: [templates/operator-claude-code/README.md](../../templates/operator-claude-code/README.md), [Operator Claude Code Setup Guide](operator-claude-code-setup.md)

---

## 7. 더 알고 싶다면

- 전체 환경변수 (60개+, 튜닝 파라미터 포함): [ENV_GUIDE.md](../../ENV_GUIDE.md)
- 시스템 아키텍처, 실행 경로, 상태 모델: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- 운영자용 Claude Code 연동 상세: [docs/guide/operator-claude-code-setup.md](operator-claude-code-setup.md)
- NLOps Agent SDK vs Claude Code 서브에이전트 선택 기준: [docs/guide/agent-integration.md](agent-integration.md)
- Slack 알림 포맷 레퍼런스: [docs/guide/slack-alert-reference.md](slack-alert-reference.md)
