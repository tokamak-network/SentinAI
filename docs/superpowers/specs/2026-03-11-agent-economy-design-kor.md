# SentinAI Agent Economy 설계 문서

> 원본: `2026-03-11-agent-economy-design.md`

## 개요

SentinAI에 에이전트 간 경제(agent-to-agent economy)를 도입해, AI 에이전트가 롤업 운영자의 고가치 운영 신호를 직접 구매할 수 있도록 합니다. SentinAI는 유료 읽기 전용 모니터링 서비스를 x402로 노출하고, ERC-8004 온체인 신원 레지스트리를 통해 발견되게 합니다.

Phase 1은 의도적으로 보수적으로 설계합니다. 수익성과 에이전트 효용을 유지하면서도, MEV나 order-flow 악용으로 전용되기 쉬운 데이터는 피합니다. 이 기준에 따라 `txpool`은 마켓플레이스 표면에서 제거하고, 대신 에이전트가 바로 의사결정에 사용할 수 있는 `sequencer-health`를 도입합니다.

## 설계 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 상호작용 방향 | 생산자 (Phase 1) | SentinAI가 모니터링 데이터를 판매하고, 소비자 역할은 이후 단계로 연기 |
| 결제 수단 | L1 TON via x402 | HTTP 네이티브 결제 흐름으로 통합 마찰이 낮음 |
| 거래 단위 | 요청 단위 | 에이전트 요청/응답 패턴에 적합하고 가격 책정이 단순함 |
| 신원/발견 | ERC-8004 Identity Registry | 에이전트 발견과 capability 광고에 적합 |
| 서비스 범위 | 읽기 전용 운영 신호 | 실행 엔드포인트는 외부 노출 금지 |
| 악용 방지 기조 | order-flow 신호보다 safety-gating 신호 우선 | DeFi 수요를 유지하면서 MEV 악용 가능성 축소 |
| 활성화 방식 | `MARKETPLACE_ENABLED=true` 옵트인 | 기존 배포 기본 동작에 영향 없음 |
| 기존 코드 영향 | 없음 | `/api/marketplace/*` 신규 라우트만 추가 |

## 사용 표준

- **ERC-8004**: 온체인 에이전트 신원 레지스트리
- **x402**: HTTP 402 기반 머신 결제 프로토콜
- **EIP-3009**: `transferWithAuthorization` 기반 가스리스 결제 승인

## 아키텍처

```
                    ERC-8004 Identity Registry (Ethereum L1)
                           ↑ register()    ↓ discover()
                           │               │
          ┌────────────────┴───────────────┴────────────────┐
          │              SentinAI Instance                  │
          │                                                  │
          │  ┌──────────────┐    ┌───────────────────────┐  │
          │  │ Marketplace  │    │  x402 Middleware       │  │
          │  │ Catalog API  │←───│  (HTTP 402 → TON pay)  │  │
          │  └──────────────┘    └───────────────────────┘  │
          │         │                       │                │
          │         ↓                       ↓                │
          │  ┌──────────────────────────────────────────┐    │
          │  │ 기존 SentinAI 서비스 + 저장소            │    │
          │  │ RCA | Anomaly | Metrics | EOA | K8s      │    │
          │  └──────────────────────────────────────────┘    │
          └─────────────────────────────────────────────────┘
                           ↑
                 외부 에이전트 HTTP 요청
                 (ERC-8004를 통해 발견)
```

## 판매 서비스

### Tier 1 — 에이전트 친화 운영 신호

| 엔드포인트 | 내용 | 가격 |
|------------|------|------|
| `GET /api/marketplace/sequencer-health` | 트레이드/출금 전 게이팅에 바로 쓰는 실행 건강도 스냅샷 | 0.1 TON |
| `GET /api/marketplace/anomalies` | 최신 4계층 이상 탐지 결과 | 0.2 TON |
| `GET /api/marketplace/incident-summary` | 활성 인시던트와 최근 신뢰도를 요약한 에이전트 친화 응답 | 0.15 TON |
| `GET /api/marketplace/rca/:id` | 특정 이상 이벤트의 RCA 리포트 | 0.5 TON |
| `GET /api/marketplace/eoa` | batcher/proposer EOA 잔액과 고갈 예측 | 0.2 TON |
| `GET /api/marketplace/resources` | K8s 파드 CPU/메모리 사용량 | 0.1 TON |
| `GET /api/marketplace/batch-submission-status` | 최근 batch 제출 상태, 지연, settlement 리스크 | 0.15 TON |

### Tier 2 — 집계 컨텍스트 데이터

| 엔드포인트 | 내용 | 가격 |
|------------|------|------|
| `GET /api/marketplace/metrics` | 최근 이력 기반 블록 인터벌 평균/표준편차/트렌드 | 0.05 TON |
| `GET /api/marketplace/scaling-history` | 스케일링 이벤트의 시점과 이유 | 0.1 TON |
| `GET /api/marketplace/sync-trend` | L2 sync gap 추세와 단기 방향 | 0.1 TON |

### 무료

| 엔드포인트 | 내용 |
|------------|------|
| `GET /api/marketplace/catalog` | 서비스 목록, 가격, SentinAI 신원 |
| `GET /api/marketplace/agent.json` | ERC-8004 agentURI 등록 파일 |

## Sequencer Health 응답 형태

`GET /api/marketplace/sequencer-health`는 raw metric dump가 아니라, 에이전트가 정책 판단에 바로 넣는 입력으로 정의합니다.

```json
{
  "status": "healthy",
  "healthScore": 84,
  "action": "proceed",
  "reasons": [
    "block interval stable",
    "no active critical incidents"
  ],
  "window": {
    "lookbackMinutes": 15,
    "sampleCount": 15
  },
  "blockProduction": {
    "latestBlockIntervalSec": 2.1,
    "avgBlockIntervalSec": 2.3,
    "stdDevBlockIntervalSec": 0.4,
    "trend": "stable",
    "stalled": false
  },
  "sync": {
    "lagBlocks": 0,
    "lagTrend": "stable",
    "catchingUp": false
  },
  "incident": {
    "activeCount": 0,
    "highestSeverity": "none",
    "lastIncidentAt": "2026-03-11T09:00:00Z"
  },
  "resources": {
    "cpuPressure": "normal",
    "memoryPressure": "normal"
  },
  "updatedAt": "2026-03-11T09:05:00Z"
}
```

필드 의도:
- `status`: `healthy | degraded | critical`
- `healthScore`: 0-100 종합 점수
- `action`: `proceed | caution | delay | halt`
- `reasons`: 짧고 기계 친화적인 설명
- `blockProduction`: 최근 실행 안정성 요약
- `sync`: lag/catch-up 상태
- `incident`: 현재 인시던트 문맥
- `resources`: 파드 상세가 아닌 coarse pressure 신호만 노출

## 데이터 흐름

### 외부 에이전트가 Sequencer Health 데이터를 구매하는 경우

```
1. 발견 (Discovery)
   에이전트 → ERC-8004 Registry: "l2ChainId=55004 AND capability=sequencer_health" 쿼리
   ← NFT #N: SentinAI @ Thanos, endpoint: https://sentinai.example.com

2. 카탈로그 조회 (무료)
   에이전트 → GET /api/marketplace/catalog
   ← { sequencer_health: "0.1 TON", incident_summary: "0.15 TON", rca: "0.5 TON", ... }

3. 첫 요청 (결제 없음)
   에이전트 → GET /api/marketplace/sequencer-health
   ← 402 Payment Required
     { "accepts": [{ "scheme": "exact", "network": "eip155:1",
                     "token": "<TON contract>", "amount": "100000000000000000" }] }

4. 결제 후 재시도
   에이전트가 0.1 TON에 대한 EIP-3009 transferWithAuthorization 서명
   에이전트 → GET /api/marketplace/sequencer-health
              X-PAYMENT: <base64 PaymentPayload>

5. 검증 후 응답
   payment-verifier.ts가 서명 검증, facilitator를 통해 TON 정산 요청
   ← 200 OK { status: "healthy", healthScore: 84, action: "proceed", ... }
```

### ERC-8004 자기 등록 (부트스트랩 시)

```
MARKETPLACE_ENABLED=true AND MARKETPLACE_WALLET_KEY 설정 시:

first-run-bootstrap.ts:
  1. agentURI JSON 생성 (체인 정보, 서비스 목록, 가격)
  2. /api/marketplace/agent.json에 호스팅 (또는 IPFS 업로드)
  3. ERC-8004 Identity Registry에서 register(agentURI) 호출
  4. 반환된 agentId를 Redis/로컬 스토리지에 저장
  5. 재시작 시 기존 agentId 재사용
```

## 신규 파일

```
src/lib/marketplace/
  agent-registry.ts     — ERC-8004 등록 및 조회 클라이언트
  x402-middleware.ts    — HTTP 402 응답 빌더 + 결제 헤더 파서
  catalog.ts            — 서비스 정의, 가격, 기능 목록
  payment-verifier.ts   — TON EIP-3009 서명 검증 + facilitator 호출

src/app/api/marketplace/
  catalog/route.ts                  — GET: 서비스 카탈로그 (무료)
  agent.json/route.ts               — GET: ERC-8004 agentURI 파일 (무료)
  sequencer-health/route.ts         — GET: sequencer 실행 건강도 스냅샷 (x402 보호)
  anomalies/route.ts                — GET: 이상 탐지 결과 (x402 보호)
  incident-summary/route.ts         — GET: 활성 인시던트 요약 (x402 보호)
  rca/[id]/route.ts                 — GET: RCA 리포트 (x402 보호)
  eoa/route.ts                      — GET: EOA 잔액 + 예측 (x402 보호)
  resources/route.ts                — GET: K8s 리소스 사용량 (x402 보호)
  batch-submission-status/route.ts  — GET: batch 제출 상태 (x402 보호)
  metrics/route.ts                  — GET: 블록 메트릭 이력 (x402 보호)
  scaling-history/route.ts          — GET: 스케일링 이벤트 이력 (x402 보호)
  sync-trend/route.ts               — GET: 싱크 갭 트렌드 (x402 보호)
```

## 수정 파일

```
src/lib/first-run-bootstrap.ts   — MARKETPLACE_ENABLED 시 ERC-8004 등록 추가
```

## 환경 변수

```bash
# Marketplace activation
MARKETPLACE_ENABLED=false

# Identity + payment wallet
MARKETPLACE_WALLET_KEY=
MARKETPLACE_TON_ADDRESS=

# x402 configuration
X402_FACILITATOR_URL=
X402_NETWORK=eip155:1

# ERC-8004 configuration
ERC8004_REGISTRY_ADDRESS=
MARKETPLACE_AGENT_URI_BASE=

# Pricing (TON in wei, 18 decimals)
MARKETPLACE_PRICE_SEQUENCER_HEALTH=100000000000000000
MARKETPLACE_PRICE_ANOMALY=200000000000000000
MARKETPLACE_PRICE_INCIDENT_SUMMARY=150000000000000000
MARKETPLACE_PRICE_RCA=500000000000000000
MARKETPLACE_PRICE_EOA=200000000000000000
MARKETPLACE_PRICE_RESOURCES=100000000000000000
MARKETPLACE_PRICE_BATCH_SUBMISSION_STATUS=150000000000000000
MARKETPLACE_PRICE_METRICS=50000000000000000
MARKETPLACE_PRICE_SCALING_HISTORY=100000000000000000
MARKETPLACE_PRICE_SYNC_TREND=100000000000000000
```

## 에러 처리

| 시나리오 | 동작 |
|----------|------|
| `MARKETPLACE_ENABLED=false` | 모든 `/api/marketplace/*` 라우트가 404 또는 설정 에러 응답 반환 |
| 결제 서명 유효하지 않음 | 에러 상세와 함께 402 반환 |
| 부트스트랩 시 ERC-8004 등록 실패 | 경고 로그만 남기고 계속 진행 |
| TON facilitator 접근 불가 | 마켓플레이스 라우트만 503 반환 |
| `MARKETPLACE_WALLET_KEY` 미설정 | ERC-8004 등록 건너뜀, 마켓플레이스는 설정 에러 반환 가능 |

## Phase 1 범위 외

- SentinAI의 소비자 역할
- scaling/restart 같은 실행 서비스
- ERC-8004 Reputation Registry 제출
- 구독/스트리밍 가격 모델
- 스마트 컨트랙트 에스크로 배포

## 주요 외부 의존성

- **x402 TON facilitator**: 실제 정산에는 TON 지원 facilitator 필요
- **ERC-8004 Registry 컨트랙트**: 운영자와 소비자 에이전트가 모두 접근 가능한 체인에 필요
