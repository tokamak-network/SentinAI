# Agent Economy: EVM 운영자를 위한 수익 시나리오

> 원본: `2026-03-11-agent-economy-scenarios.md`

> SentinAI는 모니터링 인프라를 비용 센터에서 수익원으로 전환합니다.
> 이 문서는 외부 AI 에이전트가 운영 신호를 소비함으로써
> 노드 운영자에게 추가 수익을 만드는 방식을 설명합니다.

---

## 전제

EVM 노드 운영자는 이미 내부 모니터링을 위해 SentinAI를 운영합니다. `MARKETPLACE_ENABLED=true`를 켜면, 동일한 인프라가 DeFi, 브리지, 보험, 공유 인프라 에이전트가 구매하는 유료 운영 데이터 API가 됩니다.

마켓플레이스는 두 가지를 동시에 만족해야 합니다.
- 강한 구매 수요
- 낮은 악용 가능성

이 기준 때문에 `txpool`은 제외합니다. Phase 1은 order-flow 인접 데이터 대신 `sequencer-health`, `incident-summary`, `batch-submission-status` 같은 의사결정형 운영 신호를 판매합니다.

**운영자의 한계 비용은 거의 0입니다.**
데이터는 이미 수집되고 있고, HTTP 서빙 부하는 미미합니다.

---

## Tier 기준표

| Tier | 엔드포인트 | 가격 | 고유성 |
|------|-----------|------|--------|
| 1 | `/marketplace/sequencer-health` | 0.1 TON | 트레이드/출금 전 게이팅용 실행 건강도 스냅샷 |
| 1 | `/marketplace/anomalies` | 0.2 TON | 4계층 이상 탐지 결과 |
| 1 | `/marketplace/incident-summary` | 0.15 TON | 현재 위험 상태와 최근 신뢰도를 요약한 에이전트 친화 응답 |
| 1 | `/marketplace/rca/:id` | 0.5 TON | 근본 원인 분석 리포트 |
| 1 | `/marketplace/eoa` | 0.2 TON | Batcher/Proposer 잔액과 고갈 예측 |
| 1 | `/marketplace/resources` | 0.1 TON | K8s 파드 CPU/메모리 실제 사용량 |
| 1 | `/marketplace/batch-submission-status` | 0.15 TON | 최근 batch 제출 상태와 지연 |
| 2 | `/marketplace/metrics` | 0.05 TON | 블록 인터벌 이력 (60분 통계) |
| 2 | `/marketplace/scaling-history` | 0.1 TON | 스케일링 이벤트 로그와 이유 |
| 2 | `/marketplace/sync-trend` | 0.1 TON | 블록 생성 트렌드와 지연 감지 |

---

## 허용 사용 정책 (Acceptable Use Policy)

### 허용 용도

- **실행 안전성 게이팅**: 스왑, 청산, settlement, 출금 전에 체인이 충분히 건강한지 판단
- **인프라 안전 게이팅**: 노드가 비정상 상태면 작업을 일시 중단 또는 지연
- **리스크 모델링**: 보험료, 브리지 파라미터, 프로토콜 임계값 조정
- **운영 자동화**: 집계 health signal로 알림, 스케일링, 운영 워크플로우 실행

### 금지 용도

- **지연 민감 실행 알파 추출**: 마켓플레이스 데이터를 이용한 프런트런, 샌드위치, 개별 사용자 타겟팅
- **트랜잭션 순서 조작**: health/timing 데이터를 이용한 사용자 희생형 ordering 개입
- **원본 데이터 재판매**: 의미 있는 가공 없이 마켓플레이스 출력을 그대로 제3자 피드로 제공
- **공개 전파 지연 악용 차익거래**: operator-grade 상태와 공개 propagation 사이의 시차를 이용해 부당한 거래 우위 확보

### Sequencer Health 데이터 제약

`/marketplace/sequencer-health`는 **거친 운영 건강도만** 노출하고, 트랜잭션 레벨 또는 order-flow 데이터는 제공하지 않습니다.

```json
{
  "status": "healthy",
  "healthScore": 84,
  "action": "proceed",
  "updatedAt": "2026-03-11T09:00:00Z"
}
```

**미노출 정보:**
- 개별 트랜잭션 해시, 발신자, 수신자
- 가스 가격 또는 pending transaction 구성
- 컨트랙트 호출 데이터 또는 디코딩 시그니처
- 특정 대기 트랜잭션이나 order-flow 패턴을 식별할 수 있는 신호

이 설계는 상품을 **실행 안전성 게이팅**에 유용하게 유지하면서도, **트랜잭션 타겟 MEV**에 실질적으로 덜 유용하게 만듭니다.

### 집행 메커니즘

| 메커니즘 | 방법 |
|----------|------|
| 등록 claim | 에이전트가 ERC-8004 등록 시 목적 payload 서명 |
| 속도 제한 | 정책 임계치를 넘는 요청을 agent ID 단위로 제한 |
| 이상 탐지 | SentinAI가 마켓플레이스 사용 패턴 자체를 감시 |
| 접근 취소 | capability claim 무효화로 접근 회수 |

---

## 시나리오 1: DeFi 프로토콜 에이전트 — 트레이드 전 실행 안전성 확인

**대상:** Thanos L2 위 DeFi 프로토콜의 자동 거래 에이전트
**문제:** 대규모 스왑·청산 전에 실행 환경이 비정상인지 알아야 합니다. 장애 상태에서의 실패한 거래는 0.1 TON을 훨씬 넘는 손실을 만들 수 있습니다.

**사용 패턴:**
- 중요 트랜잭션(≥$10k)마다 `/marketplace/sequencer-health` 조회
- 하루 약 200건 실행

**수익 계산:**
```
200 쿼리/일 × 0.1 TON × 30일 = 600 TON/월
```

**에이전트가 받는 데이터:**
```json
{
  "status": "degraded",
  "healthScore": 61,
  "action": "delay",
  "reasons": [
    "block interval variance elevated",
    "recent high severity incident still active"
  ],
  "blockProduction": {
    "avgBlockIntervalSec": 4.8,
    "stdDevBlockIntervalSec": 1.7,
    "trend": "rising",
    "stalled": false
  },
  "updatedAt": "2026-03-11T09:00:00Z"
}
```

`action = "delay"`이면 30초 대기합니다.
`action = "proceed"`이면 더 공격적인 슬리피지 설정으로 즉시 진행합니다.

**운영자 관점:**
> "내 노드는 이미 이 health score의 기반 신호들을 수집하고 있었습니다.
> 이제 이걸 온디맨드로 서빙해 월 600 TON을 벌 수 있습니다."

---

## 시나리오 2: 브리지 프로토콜 에이전트 — 출금 전 안전 게이트

**대상:** L2→L1 출금을 관리하는 자동화 브리지 에이전트
**문제:** batcher EOA가 고갈 직전이거나 batch posting 상태가 나쁘면 출금이 지연되거나 멈출 수 있습니다.

**사용 패턴:**
- 출금 시작 전마다 `/marketplace/eoa` 조회
- 출금량이 많은 구간에는 `/marketplace/batch-submission-status`도 조회

**수익 계산:**
```
50 × 0.2 TON + 50 × 0.15 TON = 10 + 7.5 = 17.5 TON/일
17.5 TON/일 × 30일 = 525 TON/월
```

**에이전트가 `/marketplace/batch-submission-status`에서 받는 데이터:**
```json
{
  "status": "warning",
  "lastSuccessfulSubmissionAt": "2026-03-11T08:42:00Z",
  "submissionLagSec": 540,
  "riskLevel": "elevated",
  "reasons": [
    "batch posting delayed",
    "settlement pipeline slower than baseline"
  ]
}
```

`riskLevel = "elevated"` 또는 `estimatedHoursRemaining < 24`이면 출금을 일시 중단하고 운영팀에 알립니다.

---

## 시나리오 3: 공유 인프라 에이전트 — 멀티 프로토콜 Health Routing

**대상:** 여러 DeFi 프로토콜이 공동으로 사용하는 인프라 에이전트
**문제:** 롤업이 비정상일 때 각 프로토콜을 정상 모드, 보수 모드, 일시 정지 중 어디로 둘지 결정해야 합니다.

**사용 패턴:**
- `/marketplace/incident-summary`를 10분마다 조회 (하루 144회)
- 고가치 실행 구간에는 `/marketplace/sequencer-health`도 조회 (하루 60회)

**수익 계산:**
```
144 × 0.15 TON + 60 × 0.1 TON = 21.6 + 6 = 27.6 TON/일
27.6 TON/일 × 30일 = 828 TON/월
```

**에이전트가 `/marketplace/incident-summary`에서 받는 데이터:**
```json
{
  "status": "degraded",
  "activeCount": 1,
  "highestSeverity": "high",
  "unresolvedCount": 1,
  "lastIncidentAt": "2026-03-11T08:42:00Z",
  "rollingWindow": {
    "lookbackHours": 24,
    "incidentCount": 3,
    "mttrMinutes": 18
  }
}
```

`status = "degraded"`이고 `highestSeverity = "high"`이면 연결된 프로토콜 전체를 보수 모드로 전환합니다.

---

## 시나리오 4: 보험 프로토콜 — 업타임 증명

**대상:** L2 인프라 리스크를 다루는 탈중앙 보험 프로토콜
**문제:** 보험료와 청구 판단을 위해 이상 빈도, 인시던트 심각도, 복구 속도의 이력 증거가 필요합니다.

**사용 패턴:**
- 월간 감사 시 anomaly history + active incident context 수집
- `/marketplace/anomalies` 약 10회
- `/marketplace/incident-summary` 약 4회
- `/marketplace/rca/:id` 월평균 3회

**수익 계산:**
```
10 × 0.2 TON + 4 × 0.15 TON + 3 × 0.5 TON = 2 + 0.6 + 1.5 = 4.1 TON/월
```

---

## 시나리오 5: 크로스 프로토콜 모니터링 에이전트 — 스케일링 인텔리전스

**대상:** 여러 프로토콜이 공유하는 모니터링 에이전트
**문제:** 여러 L2의 scaling event, resource pressure, health degradation을 상관 분석해 시스템 리스크를 감지해야 합니다.

**사용 패턴:**
- `/marketplace/scaling-history` 주간 조회
- 고부하 이벤트 구간에는 `/marketplace/resources` 일간 조회

**수익 계산:**
```
4 × 0.1 TON + 30 × 0.1 TON = 0.4 + 3 = 3.4 TON/월
```

---

## 합산 수익 전망

| 에이전트 | 월 수익 | AUP 상태 |
|----------|---------|---------|
| DeFi 프로토콜 에이전트 | 600 TON | ✅ 허용 |
| 브리지 에이전트 | 525 TON | ✅ 허용 |
| 공유 인프라 에이전트 | 828 TON | ✅ 허용 |
| 보험 프로토콜 | 4.1 TON | ✅ 허용 |
| 크로스 프로토콜 모니터 | 3.4 TON | ✅ 허용 |
| **합계** | **~1,960.5 TON/월** | ✅ |

TON 가격을 보수적으로 $2로 잡으면:
```
1,960.5 TON × $2 = 월 약 $3,921 추가 수익
```

---

## 발견: 에이전트들이 이 운영자를 찾는 방법

```
에이전트가 ERC-8004 Identity Registry에 쿼리:
  "l2ChainId=55004 AND capability=sequencer_health"

레지스트리 반환:
  SentinAI @ Thanos-Mainnet
  NFT ID: #4521
  Endpoint: https://sentinai.operator.xyz/api/marketplace
  x402Support: true
  Capabilities: [sequencer_health, incident_summary, anomalies, rca, eoa, resources, ...]

에이전트가 GET /api/marketplace/catalog 호출
← 가격 목록 확인

에이전트가 GET /api/marketplace/sequencer-health 호출
← 402 Payment Required

에이전트가 EIP-3009 authorization에 서명 후 재시도
← 200 OK: { status: "healthy", healthScore: 84, action: "proceed" }
```

---

## 핵심 인사이트

> SentinAI는 이미 일을 하고 있습니다.
> 마켓플레이스는 이미 수행 중인 작업 위에 얹는 수익화 레이어입니다.

운영자가 이미 수집하는 데이터인 sequencer health, anomaly history, EOA balance, batch submission health, K8s resource usage는 외부 에이전트가 실패한 실행과 인프라 리스크를 줄이는 데 직접 도움이 되기 때문에 충분히 판매 가능한 상품이 됩니다.
