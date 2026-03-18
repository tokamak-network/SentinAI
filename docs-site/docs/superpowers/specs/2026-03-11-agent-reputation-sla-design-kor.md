# Agent Reputation System & Data Quality SLA Framework (한글)

**작성일**: 2026-03-11
**상태**: 설계 승인됨
**페이즈**: 1 (신뢰 기반 구축)

---

## 개요

SentinAI의 Agent Economy 마켓플레이스가 성장하려면 **신뢰 기반**이 필수입니다. 이 설계는 두 개의 연결된 시스템을 소개합니다:

1. **Agent Reputation System** — 온체인 신뢰도 점수 (0–100)
2. **Data Quality SLA Framework** — 오프체인 SLA 추적 + 온체인 강제 (Merkle proof)

**하이브리드 모델**: 계산은 오프체인 (비용 효율), 결과는 온체인 기록 (위조 방지), 7일 분쟁 창으로 투명성 보장.

---

## 아키텍처 개요

### 전체 흐름

```
┌──────────────────────────────────────────────────────────────┐
│               Ethereum L1 (신뢰 계층)                        │
│  ReputationRegistry Smart Contract                          │
│  • 신뢰도 점수 (0–100)                                      │
│  • Merkle root 배치 제출                                    │
│  • 분쟁 해결 (7일 윈도우)                                   │
└──────────────────────────────────────────────────────────────┘
                            ↑
                submitMerkleRoot() — 1회/일
                            │
┌──────────────────────────────────────────────────────────────┐
│             SentinAI Instance (오프체인)                      │
│                                                               │
│  1. x402 Middleware                                          │
│     • 모든 요청/응답 → RequestRecord 기록                    │
│     • 기록 항목: agentId, timestamp, latency, success       │
│                                                               │
│  2. 일일 배치 프로세스                                       │
│     • 24시간 로그를 agentId별로 수집                        │
│     • SLA 준수도 계산 (성공률%, 레이턴시)                    │
│     • 신뢰도 변화 계산 (-5, +2, +5 포인트)                  │
│     • Merkle tree 생성 + 증명                               │
│     • 전체 배치 데이터를 IPFS에 업로드                      │
│     • 스마트 컨트랙트에 root + batch hash 제출              │
│                                                               │
│  3. 분쟁 해결 (수동)                                        │
│     • 에이전트는 7일 이내 이의 제기 가능                    │
│     • Merkle tree 공개 → 에이전트가 자신 데이터 검증       │
│     • 관리자가 분쟁 해결                                    │
└──────────────────────────────────────────────────────────────┘
                            ↑
                HTTP 요청 + x402 결제
                            │
┌──────────────────────────────────────────────────────────────┐
│                외부 AI 에이전트들                             │
│  (0xDeFi...A21, 0xMEV...B44, 등)                            │
│                                                               │
│  • 일일 마켓플레이스 API 호출                               │
│  • 결과: 신뢰도 점수, SLA 메트릭                            │
│  • 대시보드: 신뢰도 조회, 공급자 선택                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 시스템 컴포넌트

### 1. 신뢰도 Smart Contract (Ethereum L1)

**위치**: `contracts/ReputationRegistry.sol` (새로 생성)

**핵심 데이터 구조**:

```solidity
struct RepRecord {
  uint8 score;              // 0–100
  uint256 lastUpdate;       // 배치 제출 시간
  bytes32 merkleRoot;       // 현재 배치 root
  string batchHash;         // 전체 데이터 IPFS CID
}

mapping(address => RepRecord) public reputations;
mapping(address => DisputeRecord[]) public disputes;
```

**주요 함수**:

| 함수 | 호출자 | 목적 |
|------|--------|------|
| `submitMerkleRoot(...)` | SentinAI Admin | 일일 배치 제출 |
| `initiateDispute(...)` | 에이전트 (자신만 가능) | 7일 이내 점수 이의 제기 |
| `resolveDispute(...)` | Admin | 분쟁 해결 및 점수 수정 |
| `getReputation(agentId)` | 공개 | 신뢰도 조회 |

**접근 제어 & 속도 제한**:
- `submitMerkleRoot`:
  - 호출자: `msg.sender == SENTINAI_ADMIN` (생성자/역할로 설정)
  - 검증: `agentIds.length == newScores.length`
  - 속도 제한: 하루에 1회 제출만 허용 (`lastBatchTimestamp`로 강제)

- `initiateDispute`:
  - 호출자: **오직 `msg.sender == agentId`만** (에이전트는 자신의 점수만 이의 제기 가능)
  - 검증:
    - 배치 제출 ≤ 7일 전: `now <= lastBatchTimestamp + 7일`
    - 증명 포맷: `proof`는 IPFS CID 문자열 (형식: `Qm...`)
    - 중복 방지: 에이전트는 배치당 ≤ 1개의 활성 분쟁만 보유
  - 분쟁 비용: 0.01 ETH (에이전트 유리로 해결되면 환불)
  - 속도 제한: 배치당 에이전트당 최대 1회 분쟁

- `resolveDispute`:
  - 호출자: `msg.sender == SENTINAI_ADMIN`
  - 검증:
    - Merkle 증명 검증 (오프체인 계산 루트가 제출된 루트와 일치)
    - 수정된 점수는 0–100 범위
  - 효과: 에이전트 점수 업데이트, 분쟁을 해결됨으로 표시, 해당되면 분쟁 비용 환불

**스마트 컨트랙트 검증**:
```solidity
// initiateDispute 검증 의사코드
require(msg.sender == agentId, "자신의 에이전트만 이의 제기 가능");
require(block.timestamp <= lastBatchTimestamp[agentId] + 7일, "분쟁 윈도우 종료");
require(disputes[agentId][currentBatch].status == NONE, "배치당 1건의 분쟁만");
require(msg.value == DISPUTE_COST, "0.01 ETH 전송 필요");

// resolveDispute: Merkle 증명 검증
bytes32 leaf = keccak256(abi.encodePacked(agentId, correctedScore, batchTimestamp));
require(verifyMerkleProof(leaf, proof, merkleRoot), "유효하지 않은 증명");
```

---

### 2. SLA 추적 시스템 (오프체인)

**위치**: `src/lib/sla-tracker.ts` (새로 생성)

**책임**: 모든 마켓플레이스 API 요청을 기록하고 일일 SLA 준수도 계산.

#### 요청 기록

x402 검증된 모든 요청이 기록됨:

```typescript
interface RequestRecord {
  agentId: string;        // 구매자 에이전트 주소
  serviceKey: string;     // "anomalies", "rca" 등
  timestamp: number;      // epoch 이후 밀리초
  latencyMs: number;      // 응답 시간
  success: boolean;       // 결제 + 응답 성공 여부
}
```

#### 일일 배치 계산

**트리거**: 매일 UTC 00:00

**프로세스**:

```
1. 지난 24시간 RequestRecord 수집
2. agentId별로 그룹화
3. 각 에이전트별:
   a. 성공률 = (성공 수 / 총 수) * 100

   b. 평균 레이턴시 (성공 요청만):
      - 필터: success == true인 레코드만
      - 성공한 요청이 없으면: 레이턴시 = ∞ (자동 -5 패널티)
      - 그렇지 않으면: 레이턴시 = sum(성공 요청의 latencyMs) / count(성공)
      - 최대 레이턴시 클램프: latencyMs > 30000ms면 30000으로 기록 (이상치 방지)

   c. SLA 위반 판정:
      - 성공률 < 95% → -5 패널티
      - 레이턴시 > 2000ms (그리고 성공한 요청 있으면) → -5 패널티
      - (독립적으로 둘 다 적용 가능)
      - 레이턴시 == ∞ (성공한 요청 없으면) → -5 패널티 적용

   d. 회복 조건 체크:
      - 모든 요청이 성공 (SR == 100%) AND 레이턴시 ≤ 2000ms → +2 포인트
      - (월간: 전체 달이 SR === 100% → +5 포인트)

   e. newScore = clamp(oldScore + delta, 0, 100)
4. (agentId, newScore) 쌍의 Merkle tree 생성
5. 전체 배치 데이터를 IPFS에 업로드 → batchHash 획득
6. 스마트 컨트랙트 호출:
   submitMerkleRoot([0xDeFi...A21, ...], [100, ...], merkleRoot, "Qm...")
```

#### Merkle Tree 구조

**왜 Merkle tree?**
- 온체인 증명이 작음 (배치당 32바이트)
- 에이전트가 자신의 데이터를 자체 검증 가능
- 사기 탐지 가능

**해시 알고리즘 & 리프 포맷**:
- **해시 함수**: `keccak256` (Solidity 표준)
- **리프 포맷**: `keccak256(abi.encodePacked(agentId, score, batchTimestamp))`
  - `agentId`: bytes20 (Ethereum 주소)
  - `score`: uint8 (0–100)
  - `batchTimestamp`: uint256 (배치 제출 시간, Unix 초 단위)
- **바이트 순서**: 리틀 엔디언 (uints), 정규 형식 (addresses)

**트리 구성**:
```
1. 리프 생성: [leaf0, leaf1, leaf2, leaf3, ...]
2. 아래에서 위로 층 구축:
   - 층이 홀수 개면 마지막 리프 복제 (leaf[n-1])
   - 각 쌍(left, right)에서: hash = keccak256(left || right)
   - 단일 루트가 남을 때까지 계속
3. 예시 (4명의 에이전트):
         Root (64 바이트 keccak256)
        /                        \
    Hash(L01)              Hash(R23)
    /      \                /      \
   Leaf0  Leaf1         Leaf2   Leaf3
```

**Merkle 증명 포맷**:
- 증명은 해시 배열 (각 32바이트), 트리 경로를 따라 형제 노드 나타냄
- 검증: 리프에서 시작, 각 형제 해시를 순서대로 적용 (트리에서 왼쪽에서 오른쪽)
- Leaf0의 경로 예: `[Leaf1, Hash(R23)]`

**검증 (에이전트가 수행)**:
```typescript
const leaf = keccak256(abi.encodePacked(agentId, score, batchTimestamp));
const path = [sibling0, sibling1, ...];  // 리프에서 루트까지의 형제

let computed = leaf;
for (const sibling of path) {
  computed = keccak256(abi.encodePacked(computed, sibling));
  // 참고: 순서는 트리의 위치에 따라 결정, 구현에서는 인덱스 추적 사용
}
const computed = merkleProof.verify(leaf, path);
assert(computed === submittedRoot);  // ✓ 신뢰함
```

---

### 3. 데이터 품질 SLA 메트릭

**모든 마켓플레이스 서비스에 동일 적용**.

| 메트릭 | 기준 | 패널티 |
|--------|------|--------|
| 성공률 | ≥ 95% | SR < 95%면 -5점 |
| 평균 레이턴시 | ≤ 2000ms | > 2000ms면 -5점 |
| 회복: 연속 성공 | 100개 연속 요청, 0 실패 | +2점 (매일 리셋) |
| 회복: 월간 우수 | 전체 달력 월 100% SR | +5점 (다음 달 1일 확인) |

**예시**:
```
0xDeFi...A21이 2026-03-11에:
  • 100개 중 95개 성공 → SR = 95% ✓ (기준값)
  • 평균 레이턴시: 1234ms ✓ (2000ms 이하)
  • 점수 변화: 0
  • 새 점수: 100 (유지)
```

---

## 신뢰도 점수 시스템

### 범위: 0–100

| 범위 | 의미 | 시장 신호 |
|------|------|---------|
| 90–100 | 우수 | 선호 공급자 |
| 75–89 | 양호 | 수용 가능 |
| 50–74 | 보통 | 위험, 낮은 가격 필요 |
| 0–49 | 불량 | 피하거나 극히 낮은 가격 |

### 초기 점수: 100

모든 새로운 에이전트는 점수 100으로 시작. 초기 좋은 행동을 장려.

### 점수 변화

**패널티** (일일, 누적 가능):
- SLA 위반 (성공률 또는 레이턴시): -5점
- 중복 위반: 일일 최대 -10점

**회복** (명시적 성과 기반):

1. **연속 성공 보너스** (+2점):
   - 트리거: 에이전트가 정확히 100개의 연속 성공한 요청(success == true)에 도달
   - 윈도우: 연속 카운터는 **단일 실패**(success == false)에서 리셋됨
   - 리셋: 카운터는 매일 UTC 00:00에 0부터 시작함
   - 보너스 적용: 일일 배치당 1회 (에이전트가 100, 200, 300 연속에 도달해도 하루에 +2만)
   - 예시:
     ```
     1일: 95개 성공 → 카운터 = 95, 보너스 없음
     2일: 5개 성공 + 1개 실패 → 카운터 리셋 0, 보너스 없음
     3일: 100개 성공 → 카운터 = 100, +2 보너스
     4일: 50개 성공 → 카운터 = 50 (계속), 아직 보너스 없음
     ```

2. **월간 우수 보너스** (+5점):
   - 트리거: 에이전트가 전체 달력 월동안 100% 성공률(SR === 100%) 유지
   - 윈도우: 월 = 달력월 (예: 2026-03-01 ~ 2026-03-31)
   - 확인: 다음 달 1일에 확인 (예: 2026-04-01 배치가 2026-03 보너스 계산)
   - 보너스 적용: 다음 달 시작 시 1회 (여러 달이 100% SR이어도 월당 +5)
   - 요구사항: 월의 모든 날이 ≥1개 요청 AND SR = 100%
   - 예시:
     ```
     2026년 3월: 매일 모든 요청이 성공
     4월 1일 배치: 3월 SR == 100% 확인 → YES → +5 보너스 적용
     2026년 4월: 4월 15일에 1개 실패
     5월 1일 배치: 4월 SR == 100% 확인 → NO → 보너스 없음
     ```

**중요**:
- 점수는 시간 경과에 따라 자동 회복되지 않음. 회복은 증명된 좋은 행동이 필요.
- 두 가지 회복 보너스가 같은 날에 적용될 수 있음 (1일 최대 +7 둘 다 만족 시)
- 연속 카운터는 에이전트당이며, 서비스별이 아님 (모든 요청 유형 합산)

---

## 분쟁 해결 (7일 윈도우)

### 왜 분쟁?

SentinAI 운영자가 Merkle root를 제출하므로, 거짓 데이터 제출을 방지하려면 에이전트가 이의를 제기할 수 있어야 함.

### 분쟁 타임라인 (엄격하고 명확함)

모든 시간은 **UTC**입니다.

**T = 0 (배치 제출, 예: 2026-03-11 09:00 UTC)**:
SentinAI가 `submitMerkleRoot()`로 배치 제출:
```solidity
submitMerkleRoot(
  agentIds: [0xDeFi...A21, ...],
  newScores: [95, ...],
  merkleRoot: 0xabc...,
  batchHash: "QmXyz..."
)
// 스마트 컨트랙트 기록: lastBatchTimestamp = now
```

**T ∈ [0, 604800) 초 (제출 기한 = 7일)**:
에이전트가 `initiateDispute()` 가능:
- 가장 빠름: T=0 (배치 제출 직후)
- 가장 늦음: T=604799 (7일 윈도우 종료 1초 전)
- 스마트 컨트랙트 강제: `require(block.timestamp < lastBatchTimestamp + 7days)`

```solidity
initiateDispute(
  agentId: 0xDeFi...A21,
  proof: "QmMyData..."  // 에이전트의 거래 레코드가 있는 IPFS CID
)
// 스마트 컨트랙트 기록: disputeTimestamp = now
```

**T ∈ [0, 864000) 초 (조사 윈도우 = 12일)**:
관리자가 분쟁을 조사하고 해결:
- 조사 기간: 분쟁 윈도우 종료 후 5일 (T=604800에서 T=864000까지)
- 둘 다 가져오기:
  - 전체 배치: `QmXyz...` (SentinAI가 제출)
  - 에이전트 주장: `QmMyData...` (에이전트가 제출)
- 검증: 에이전트 데이터가 제출된 Merkle 루트로 해시되는가?
- `resolveDispute(agentId, index, correctedScore)`로 해결

**T ≥ 864000 초 (자동 종료 = 제출 후 10일)**:
- 미해결 분쟁은 **자동으로 종료됨**
- 제출된 점수가 유지됨 (에이전트를 무한 대기에서 보호)
- 스마트 컨트랙트가 `getDisputeStatus(agentId)`로 자동 종료 강제:
  ```solidity
  if (dispute.status == PENDING && now >= lastBatchTimestamp + 10days) {
    dispute.status = AUTO_CLOSED;
    dispute.finalScore = submittedScore;
  }
  ```

**시각적 타임라인**:
```
T=0              T=604800 (7d)    T=864000 (12d)   T=1209600 (14d)
|__________________|______________|__________________|
  분쟁 제출 윈도우    조사 윈도우       기록 고정
  (에이전트가 이의   (관리자가           (추가 조치
   제기 가능)        해결)              불가능)
```

**주요 보장**:
1. 에이전트는 정확히 7일 동안 이의 제기 가능
2. 관리자는 정확히 5일 동안 조사 가능 (분쟁 윈도우 이후)
3. 10일 후 미해결 분쟁 없음
4. 14일 후 점수 이력 불변

### 공개 Merkle Tree를 통한 투명성

**핵심 기능**: Full batch data (IPFS CID)는 공개됨.

에이전트가 자발적으로 검증 가능:
```typescript
// IPFS에서 배치 다운로드
const batch = await ipfs.get("QmXyz...");

// 자신의 기록 찾기
const myRecords = batch.records.filter(r => r.agentId === "0xDeFi...A21");

// 자신의 점수 재계산
const recalcScore = calculateScore(myRecords);

// Merkle 포함 검증
const myLeaf = hash(agentId || recalcScore || timestamp);
const proof = batch.merkleProof[myIndex];
assert(merkleProof.verify(myLeaf, proof, submittedRoot));

// ✓ 검증 완료: 점수 신뢰함
```

**암호학적 투명성**: 온체인 계산 불필요.

---

## 기존 마켓플레이스와의 통합

### 영향받는 컴포넌트

**1. x402 Middleware**
- 추가: 검증된 모든 요청 → RequestRecord 기록

**2. 일일 Cron**
- 추가: UTC 00:00에 SLA 배치 프로세스 → smart contract 제출

**3. 마켓플레이스 Catalog API** (`GET /api/marketplace/catalog`)
- 추가: 신뢰도 필드
  ```json
  {
    "services": [
      {
        "key": "anomalies",
        "priceWei": "200000000000000000",
        "reputation": {
          "score": 95,
          "lastUpdate": "2026-03-11T09:00:00Z",
          "successRate": 97.5,
          "avgLatencyMs": 1234
        }
      }
    ]
  }
  ```

### 변경 불필요

- Pricing engine — 그대로 유지
- x402 결제 흐름 — 그대로 유지 (기록만 추가)
- 서비스 엔드포인트 — 그대로 유지

---

## IPFS 지속성 & 핀 전략

### 왜 IPFS?

전체 배치 데이터 (모든 에이전트 레코드, SLA 계산)는 IPFS에 저장되며 CID는 온체인에 기록됨. 이를 통해 에이전트는:
- 배치 데이터 다운로드 (`QmXyz...`)
- 자신의 레코드가 온체인 Merkle 루트와 일치하는지 확인
- 사기 제출 탐지

### 핀 책임

**1차**: SentinAI 운영자가 모든 배치 CID를 무한정 핀
- 저장 위치: Pinata 또는 자체 호스팅 IPFS 노드
- 수명: 영구 (배치 CID는 절대 만료되지 않음)
- 백업: 최소 2개의 독립적인 핀 서비스

**2차**: 공개 IPFS 네트워크 (최선의 노력)
- 모든 IPFS 노드는 데이터를 가져오고 다시 핀할 수 있음
- 지속성 보장 없음

### 데이터 손실 시 폴백

IPFS CID가 도달 불가능해지면 (두 핀 서비스 다운, 데이터 삭제):

1. **7일 이내 (분쟁 윈도우)**:
   - Admin이 `submitBatchDataOnChain(batchHash, compressedData)`로 배치 데이터를 온체인에 저장
   - 비용: 배치당 ~500k-2M 가스 (분쟁 중에는 수용 가능하지만 비쌈)

2. **7일 이후 (분쟁 윈도우 종료)**:
   - 배치 CID는 마지막 알려진 상태로 동결
   - 분쟁은 삭제된 데이터를 참조할 수 없음 (위험 수용)
   - 향후 배치는 동일한 핀 전략 사용

### 모니터링 & 알림

일일 상태 확인:
```typescript
async function checkIPFSAvailability() {
  const cids = await getLastNBatchCIDs(90);  // 지난 90일
  for (const cid of cids) {
    try {
      await ipfs.stat(cid, { timeout: 5000 });
      // ✓ CID 도달 가능
    } catch (e) {
      sendAlert(`IPFS CID 도달 불가: ${cid}`);
      // 폴백 트리거: 재핀 또는 온체인 저장
    }
  }
}
```

---

## 에러 처리 & 엣지 케이스

| 상황 | 처리 |
|------|------|
| 요청 성공 후 응답 반환 전 crash | `success: false` 기록 (SLA 위반) |
| 네트워크 타임아웃 | `success: false` + `latencyMs: ∞` 기록 |
| 에이전트가 매우 많은 거래 (>10k/일) | Merkle tree 파티셔닝 (Phase 2) |
| IPFS 업로드 실패 | Fallback: on-chain 저장 (높은 가스비) |
| 관리자가 분쟁 무시 | 7일 후 제출 점수 유지 (에이전트 보호) |
| 새 에이전트, 거래 없음 | score = 100 (초기값) |

---

## 테스트 전략

### 단위 테스트

**SLA Calculator** (`sla-tracker.test.ts`)
- 점수 계산, SLA 위반, 회복 조건
- 목표: 15개 테스트, >95% 커버리지

**Merkle Tree** (`merkle-tree.test.ts`)
- 트리 생성, 증명 검증, 잘못된 증명 거부
- 목표: 10개 테스트, 100% 커버리지

### 통합 테스트

**Batch Processor** (`batch-processor.test.ts`)
- 24h 시뮬레이션 → 배치 실행 → 점수 검증
- 목표: 5개 테스트

### Smart Contract 테스트

**ReputationRegistry** (`ReputationRegistry.test.ts`)
- 접근 제어, 배치 제출, 분쟁 해결
- 목표: 14개 테스트

### E2E 테스트

**Full Integration** (1개 journey)
- 요청 → 기록 → Merkle root 제출 → 분쟁 해결
- 목표: 1개 테스트, happy path + dispute 커버

---

## 성공 기준

Phase 1이 성공하려면:

1. ✓ 신뢰도 점수가 매일 온체인 기록됨
2. ✓ 에이전트가 Merkle proof로 자신 데이터 검증 가능
3. ✓ 최소 1건의 분쟁이 올바르게 해결됨
4. ✓ 마켓플레이스 catalog가 신뢰도를 가격과 함께 표시
5. ✓ 외부 oracle 불필요 (운영자 비용 <$100/월)

---

**문서 상태**: 구현 계획 준비 완료
**다음 단계**: `superpowers:writing-plans` 호출 → 상세 구현 계획 작성
