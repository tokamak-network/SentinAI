# Agent Economy 구현 플랜 (한국어)

> 원본: `2026-03-11-agent-economy.md`

> **에이전트 작업자를 위한 안내:** 필수: superpowers:subagent-driven-development 또는 superpowers:executing-plans를 사용해 이 플랜을 구현하세요.

**목표:** `sequencer-health`를 중심 상품으로 삼아, SentinAI의 운영 모니터링 데이터를 x402와 ERC-8004를 통해 외부 AI 에이전트에게 유료로 노출합니다.

**아키텍처:** `/api/marketplace/*` 라우트 그룹을 추가하고, `catalog.ts`가 서비스/가격의 단일 진실 공급원이 됩니다. `x402-middleware.ts`가 결제 게이트를 담당하고, 보호 라우트는 `withX402(request, serviceKey)`를 먼저 호출합니다. Phase 1은 읽기 전용 운영 신호만 판매합니다.

**기술 스택:** Next.js 16 route handlers, TypeScript strict, viem, Vitest

---

## 파일 맵

```
신규:
  src/lib/marketplace/
    catalog.ts
    x402-middleware.ts
    payment-verifier.ts
    agent-registry.ts
    sequencer-health.ts
    incident-summary.ts
    batch-submission-status.ts

  src/app/api/marketplace/
    catalog/route.ts
    identity/route.ts
    sequencer-health/route.ts
    anomalies/route.ts
    incident-summary/route.ts
    rca/[id]/route.ts
    eoa/route.ts
    resources/route.ts
    batch-submission-status/route.ts
    metrics/route.ts
    scaling-history/route.ts
    sync-trend/route.ts

  src/lib/__tests__/marketplace/
    catalog.test.ts
    x402-middleware.test.ts
    payment-verifier.test.ts
    sequencer-health.test.ts
    incident-summary.test.ts
    batch-submission-status.test.ts

수정:
  src/lib/first-run-bootstrap.ts
  .env.local.sample
```

---

## Task 1: 카탈로그 정의

**서비스 키:**
- `sequencer_health`
- `anomalies`
- `incident_summary`
- `rca`
- `eoa`
- `resources`
- `batch_submission_status`
- `metrics`
- `scaling_history`
- `sync_trend`

**기본 가격:**
- `sequencer_health`: `100000000000000000`
- `anomalies`: `200000000000000000`
- `incident_summary`: `150000000000000000`
- `rca`: `500000000000000000`
- `eoa`: `200000000000000000`
- `resources`: `100000000000000000`
- `batch_submission_status`: `150000000000000000`
- `metrics`: `50000000000000000`
- `scaling_history`: `100000000000000000`
- `sync_trend`: `100000000000000000`

**검증:**
- `npx vitest run src/lib/__tests__/marketplace/catalog.test.ts`

---

## Task 2: x402 미들웨어 유지

**요구사항:**
- `withX402()`는 서비스 비종속적으로 유지
- 예시와 테스트는 `txpool` 대신 `sequencer_health` 사용
- 로컬 스모크 테스트용 `MARKETPLACE_PAYMENT_MODE=open` 유지

**검증:**
- `npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts`
- `npx vitest run src/lib/__tests__/marketplace/payment-verifier.test.ts`

---

## Task 3: sequencer health 조합기 구현

**응답 형태:**

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

**구현 메모:**
- `getRecentMetrics()`와 기존 anomaly/event 저장소를 재사용
- `status`, `healthScore`, `action` 계산을 한 곳에 모음
- transaction-level 또는 mempool-level detail은 노출 금지

---

## Task 4: incident summary 구현

**응답 형태:**

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

---

## Task 5: batch submission status 구현

**응답 형태:**

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

**구현 메모:**
- 기존 batcher, derivation lag, settlement probe 신호를 우선 재사용
- 직접 텔레메트리가 부족하면 파생 휴리스틱으로 최소 구현 후 fallback을 문서화

---

## Task 6: 나머지 보호 라우트 구현

**대상 라우트:**
- `anomalies`
- `rca/[id]`
- `eoa`
- `resources`
- `metrics`
- `scaling-history`
- `sync-trend`

**요구사항:**
- 모든 라우트는 `withX402()` 선행 호출
- 기존 SentinAI 서비스 재사용
- 실행 액션은 외부에 노출하지 않음

---

## Task 7: 무료 라우트와 identity 구현

**요구사항:**
- catalog에 새 서비스 키와 가격 반영
- identity capability에 `sequencer_health`, `incident_summary`, `batch_submission_status` 포함

---

## Task 8: 부트스트랩과 환경 변수 반영

**요구사항:**
- ERC-8004 자기 등록 흐름 유지
- `.env.local.sample`에서 `MARKETPLACE_PRICE_TXPOOL` 제거
- 새 가격 env 추가

---

## Task 9: 통합 검증

**검증 항목:**
- `npm run test:run`
- `npm run lint`
- `npm run build`

**수동 스모크 라우트:**
- `/api/marketplace/catalog`
- `/api/marketplace/sequencer-health`
- `/api/marketplace/incident-summary`
- `/api/marketplace/batch-submission-status`
- `/api/marketplace/anomalies`

**기대 결과:**
- 무료 라우트는 200
- `open` 모드에서 보호 라우트는 200
- `verify` 모드에서 `X-PAYMENT` 없이 보호 라우트는 402

---

## 알려진 제한사항

1. 실제 TON 정산에는 facilitator가 여전히 필요합니다.
2. ERC-8004 등록은 여전히 fire-and-forget입니다.
3. batch submission status는 초기에는 파생 휴리스틱 구현일 수 있습니다.
4. Phase 1은 `txpool` 및 order-flow 인접 데이터를 의도적으로 제외합니다.
