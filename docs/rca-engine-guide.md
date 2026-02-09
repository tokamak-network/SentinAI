# RCA Engine (Root Cause Analysis) 가이드

## 📋 개요

RCA Engine은 **이상 탐지 후 근본 원인을 추적**하고 **해결 방안을 제시**하는 AI 기반 분석 시스템입니다.

**파일**: `src/lib/rca-engine.ts`

### 3단계 분석 프로세스

```
1️⃣ Timeline 구성
   ├─ 로그 파싱
   ├─ 이상 메트릭 변환
   └─ 시간순 정렬

2️⃣ AI 인과관계 분석
   ├─ Component 의존성 그래프 활용
   ├─ 연쇄 실패 추적
   └─ 심각도 평가

3️⃣ 권장 조치 제시
   ├─ 즉시 조치 (Immediate)
   └─ 예방 조치 (Preventive)
```

---

## 🏗️ Optimism Rollup 아키텍처

### 컴포넌트 관계도

```
                    ┌─────────────────┐
                    │   L1 (Ethereum) │
                    │   or Sepolia    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   op-node        │
                    │ (Derivation      │
                    │  Driver)         │
                    └────┬─────────────┘
                    ┌────┴─────┬──────────────┐
                    ▼          ▼              ▼
            ┌──────────────┐ ┌────────────┐ ┌──────────────┐
            │  op-geth     │ │ op-batcher │ │ op-proposer  │
            │  (Execution) │ │ (Batches)  │ │ (State Root) │
            └──────────────┘ └────────────┘ └──────────────┘
                    │
                    └─────→ L1 (Submit batches & roots)
```

### 각 컴포넌트 역할

| 컴포넌트 | 역할 | 의존성 | 영향 범위 |
|---------|------|--------|---------|
| **L1** | 외부 체인 (Ethereum/Sepolia) | 없음 | 모든 컴포넌트 |
| **op-node** | L1 데이터 수신 → L2 상태 유도 | L1 | 모든 하위 컴포넌트 |
| **op-geth** | L2 블록 실행 (트랜잭션 처리) | op-node | 트랜잭션 처리 |
| **op-batcher** | L2 트랜잭션 배치 제출 (L1) | op-node, L1 | 트랜잭션 압축 |
| **op-proposer** | L2 상태근 제출 (L1) | op-node, L1 | 인출(Withdrawal) |

### 의존성 그래프

```typescript
const DEPENDENCY_GRAPH = {
  'l1': {
    dependsOn: [],
    feeds: ['op-node', 'op-batcher', 'op-proposer'],
  },
  'op-node': {
    dependsOn: ['l1'],
    feeds: ['op-geth', 'op-batcher', 'op-proposer'],
  },
  'op-geth': {
    dependsOn: ['op-node'],
    feeds: [],
  },
  'op-batcher': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-proposer': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
};
```

**중요**: op-node가 실패하면 모든 하위 컴포넌트가 영향을 받습니다!

---

## 📊 Timeline 구성

### 데이터 소스

Timeline은 다음 3가지 소스에서 이벤트를 수집합니다:

#### 1. 로그 파싱 (Log Events)

```typescript
function parseLogsToEvents(logs: Record<string, string>): RCAEvent[]
```

**지원 형식**:
- ISO 8601: `2024-12-09T14:30:45.123Z`
- Geth 형식: `[12-09|14:30:45.123]`
- 일반 형식: `2024-12-09 14:30:45`

**추출 조건**:
- ERROR, ERR, FATAL 레벨 → type: `error`
- WARN, WARNING 레벨 → type: `warning`

**예시**:
```
[12-09|14:30:45.123] ERROR [execution] block derivation failed: context deadline exceeded

→ {
  timestamp: 1733761845123,
  component: 'op-geth',  # 자동 맵핑
  type: 'error',
  description: 'block derivation failed: context deadline exceeded',
  severity: 'high'
}
```

#### 2. 이상 메트릭 변환 (Anomaly Events)

```typescript
function anomaliesToEvents(anomalies: AnomalyResult[]): RCAEvent[]
```

**메트릭 → 컴포넌트 맵핑**:

| 메트릭 | 컴포넌트 | 원인 |
|--------|---------|------|
| `cpuUsage` | op-geth | CPU 스파이크/부하 |
| `txPoolPending` | op-geth | 트랜잭션 축적 |
| `gasUsedRatio` | op-geth | 블록 포화 |
| `l2BlockHeight`, `l2BlockInterval` | op-node | 블록 생성 정체 |

**예시**:
```
Anomaly: CPU 스파이크 (Z-Score: 3.2)

→ {
  timestamp: 1733761900000,
  component: 'op-geth',
  type: 'metric_anomaly',
  description: 'CPU usage spike: 30% → 65%',
  severity: 'high'  # |Z| > 2.5 이므로
}
```

#### 3. 시간순 정렬

```typescript
function buildTimeline(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  minutes: number = 5
): RCAEvent[]
```

**동작**:
1. 로그 + 이상 메트릭 합치기
2. 지난 5분 데이터만 필터링
3. 타임스탬프 기준 정렬

**결과**:
```json
[
  {
    "time": "2024-12-09T14:28:00Z",
    "component": "op-node",
    "type": "error",
    "description": "L1 reorg detected"
  },
  {
    "time": "2024-12-09T14:28:30Z",
    "component": "op-geth",
    "type": "warning",
    "description": "Derivation stalled"
  },
  {
    "time": "2024-12-09T14:29:00Z",
    "component": "op-geth",
    "type": "metric_anomaly",
    "description": "TxPool: 1000 → 5000 (monotonic increase)"
  }
]
```

---

## 🧠 AI 기반 인과관계 분석

### System Prompt 구조

RCA Engine은 **SRE 관점의 명확한 지시**를 Claude에 제공합니다:

```
1. Component Architecture (5개 컴포넌트 상세 설명)
2. Dependency Graph (의존성 관계)
3. Common Failure Patterns (5가지 전형적 실패 패턴)
4. Analysis Guidelines (분석 방법론)
```

### 5가지 전형적 실패 패턴

#### 1️⃣ L1 Reorg (L1 체인 재조직)

**원인**: L1에서 체인 재조직 발생
```
┌─────────────────────────────────┐
│ L1 Reorg                        │
└────────────┬────────────────────┘
             │
             ▼
┌────────────────────────────────┐
│ op-node Derivation Reset       │
│ (유도 상태 초기화)              │
└────────────┬────────────────────┘
             │
             ▼
┌────────────────────────────────┐
│ L2 Block Generation Stall      │
│ (블록 생성 일시 정지)           │
└────────────────────────────────┘
```

**증상**:
- Block height plateau 2분 이상
- 임시 동기화 정지

---

#### 2️⃣ L1 Gas Spike (L1 가스비 급등)

**원인**: L1 네트워크 혼잡
```
┌──────────────────────────┐
│ L1 Gas Price Surge       │
│ (가스비 급상승)           │
└─────────┬────────────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
Batcher    Proposer
Failed    Failed
│         │
└────┬────┘
     ▼
TxPool
Accumulation
```

**증상**:
- op-batcher: 배치 제출 실패
- TxPool: 단조 증가 (5분 이상)
- 로그: "transaction underpriced" 또는 "replacement transaction underpriced"

---

#### 3️⃣ op-geth Crash (프로세스 중단)

**원인**: op-geth 프로세스 중단 (OOM, 시그널 등)
```
┌──────────────────┐
│ op-geth Crash    │
│ (프로세스 종료)   │
└────────┬─────────┘
         │
         ▼
CPU: 100% → 0%
Memory: Peak → 0
Port: Open → Closed
```

**증상**:
- CPU 갑자기 0% (Zero-drop detection)
- 모든 트랜잭션 처리 중단
- 로그: "connection refused", "unexpected EOF"

---

#### 4️⃣ Network Partition (P2P 네트워크 단절)

**원인**: 노드 간 P2P 통신 단절
```
┌──────────────────────────┐
│ Network Partition        │
│ (P2P Gossip 단절)        │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ op-node Peer Loss        │
│ (동료 노드 연결 손실)    │
└────────┬─────────────────┘
         │
         ▼
Unsafe Head Divergence
(안전 헤드 발산)
```

**증상**:
- op-node: "peer disconnected" 로그
- Block interval: 증가
- Unsafe head: 예상값과 다름

---

#### 5️⃣ Sequencer Stall (Sequencer 정지)

**원인**: Sequencer 노드 자체 문제
```
┌──────────────────────┐
│ Sequencer Stall      │
│ (블록 생성 정지)      │
└──────────┬───────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Block Height   TxPool
Plateau        Growth
(2분+)         (5분+)
```

**증상**:
- Block height: 변화 없음
- TxPool: 계속 증가
- 로그: "context deadline exceeded" 등 타임아웃

---

### AI 분석 결과 형식

Claude가 반환하는 JSON:

```json
{
  "rootCause": {
    "component": "op-node" | "op-geth" | "op-batcher" | "op-proposer" | "l1" | "system",
    "description": "명확한 근본 원인 설명",
    "confidence": 0.0 - 1.0
  },
  "causalChain": [
    {
      "timestamp": 1733761800000,
      "component": "op-node",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
      "description": "이 단계에서 발생한 일"
    }
  ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}
```

### 신뢰도 점수 (Confidence)

| 신뢰도 | 의미 | 상황 |
|--------|------|------|
| **0.9~1.0** | 매우 높음 | 명확한 로그 + 이상 메트릭 일치 |
| **0.7~0.9** | 높음 | 로그 또는 메트릭 중 하나만 명확 |
| **0.5~0.7** | 중간 | 여러 가능성 있음 |
| **0.3~0.5** | 낮음 | AI 호출 실패 → Fallback |
| **< 0.3** | 매우 낮음 | 데이터 부족 |

---

## 🔀 의존성 추적

### 상류(Upstream) 의존성 조회

```typescript
findUpstreamComponents(component: RCAComponent): RCAComponent[]
```

**예**:
```
op-geth의 상류 의존성:
  op-geth → op-node → l1

op-batcher의 상류 의존성:
  op-batcher → [op-node, l1]
```

### 하류(Downstream) 영향 추적

```typescript
findAffectedComponents(rootComponent: RCAComponent): RCAComponent[]
```

**예**:
```
op-node 실패 시 영향받는 컴포넌트:
  op-node fails
    ├─ op-geth 영향 (op-geth가 op-node 필요)
    ├─ op-batcher 영향
    └─ op-proposer 영향

op-geth 실패 시 영향받는 컴포넌트:
  op-geth fails
    └─ (없음 - op-geth는 다른 컴포넌트를 공급하지 않음)
```

---

## 🛠️ Fallback 분석 (AI 호출 실패)

AI 호출이 실패할 때 자동으로 규칙 기반 분석을 수행합니다.

### Fallback 로직

```typescript
function generateFallbackAnalysis(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  lastError?: string
): RCAResult
```

**동작**:
1. Timeline에서 첫 번째 ERROR 이벤트 찾기
2. 해당 컴포넌트에서 영향받는 모든 컴포넌트 목록화
3. 기본 권장 조치 제시

**신뢰도**: 0.3 (낮음 - 수동 확인 권장)

**반환 권장 조치**:
```json
{
  "immediate": [
    "Check component logs for detailed error messages",
    "Verify all pods are running: kubectl get pods -n <namespace>",
    "Check L1 connectivity and block sync status"
  ],
  "preventive": [
    "Set up automated alerting for critical metrics",
    "Implement health check endpoints for all components",
    "Document incident response procedures"
  ]
}
```

---

## 📝 로그 파싱 상세

### 지원 로그 형식

#### ISO 8601 형식
```
2024-12-09T14:30:45.123Z ERROR [op-geth] failed to execute block
→ timestamp: 1733761845123
```

#### Geth 형식
```
[12-09|14:30:45.123] op-geth ERROR block execution timeout
→ timestamp: 해당 연도-12월-09일 14:30:45.123
```

#### 일반 형식
```
2024-12-09 14:30:45 ERROR op-node derivation failed
→ timestamp: 해당 날짜 14:30:45
```

### 컴포넌트 이름 정규화

```typescript
const COMPONENT_NAME_MAP = {
  'op-geth': 'op-geth',
  'geth': 'op-geth',
  'op-node': 'op-node',
  'node': 'op-node',
  'op-batcher': 'op-batcher',
  'batcher': 'op-batcher',
  'op-proposer': 'op-proposer',
  'proposer': 'op-proposer',
};
```

### 로그 레벨 추출

```typescript
const LOG_LEVEL_MAP = {
  'ERROR', 'ERR', 'FATAL' → type: 'error'   (심각도: high)
  'WARN', 'WARNING'       → type: 'warning' (심각도: medium)
};
```

---

## 📊 실행 예시

### 1단계: Timeline 구성

```bash
Timeline Events (5분 이내):
[14:28:00] op-node     ERROR  L1 reorg detected
[14:28:30] op-node     WARNING Derivation stalled
[14:29:00] op-geth     METRIC  TxPool: 1000 → 5000
[14:29:30] op-geth     ERROR   Connection refused
[14:30:00] op-batcher  ERROR   Batch submission failed
```

### 2단계: AI 분석

**프롬프트 전송 내용**:
```
System: [RCA_SYSTEM_PROMPT 포함 아키텍처, 패턴 등]

User:
== Event Timeline ==
[timeline JSON]

== Detected Anomalies ==
- txPoolPending: 5000 (z-score: 3.1, spike)

== Recent Metrics ==
[메트릭 스냅샷]

== Component Logs ==
[로그 내용]

Analyze the above data and identify the root cause.
```

**Claude 응답**:
```json
{
  "rootCause": {
    "component": "op-node",
    "description": "L1에서 체인 재조직이 발생하여 op-node의 유도 상태가 초기화됨. 이로 인해 op-geth 실행이 지연되고 트랜잭션이 TxPool에 축적됨.",
    "confidence": 0.85
  },
  "causalChain": [
    {
      "timestamp": 1733761680000,
      "component": "l1",
      "type": "error",
      "description": "L1 reorg detected"
    },
    {
      "timestamp": 1733761710000,
      "component": "op-node",
      "type": "error",
      "description": "Derivation reset due to L1 reorg"
    },
    {
      "timestamp": 1733761740000,
      "component": "op-geth",
      "type": "metric_anomaly",
      "description": "TxPool accumulation (1000 → 5000)"
    }
  ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "remediation": {
    "immediate": [
      "Monitor L1 finality status",
      "Check op-node derivation progress",
      "Verify op-geth is catching up with pending transactions"
    ],
    "preventive": [
      "Increase watchdog timeout thresholds during L1 finality uncertainty",
      "Implement automated derivation state validation",
      "Set up alerts for L1 reorg patterns"
    ]
  }
}
```

### 3단계: 결과 저장

```typescript
{
  "id": "rca-1733761845-abc123",
  "rootCause": { ... },
  "causalChain": [ ... ],
  "affectedComponents": ["op-geth", "op-batcher"],
  "timeline": [ ... ],
  "remediation": { ... },
  "generatedAt": "2024-12-09T14:30:45.678Z"
}
```

---

## 📞 API 사용

### RCA 분석 요청

```bash
curl -X POST "http://localhost:3002/api/rca" \
  -H "Content-Type: application/json" \
  -d '{
    "autoTriggered": false
  }'
```

**응답**:
```json
{
  "success": true,
  "result": {
    "id": "rca-1733761845-abc123",
    "rootCause": { ... },
    "causalChain": [ ... ],
    "affectedComponents": ["op-geth", "op-batcher"],
    "timeline": [ ... ],
    "remediation": {
      "immediate": [ ... ],
      "preventive": [ ... ]
    },
    "generatedAt": "2024-12-09T14:30:45.678Z"
  }
}
```

### RCA 이력 조회

```bash
# 최근 10개 RCA 분석 결과
curl -s "http://localhost:3002/api/rca?limit=10" | jq '.history'

# 특정 RCA 분석 결과
curl -s "http://localhost:3002/api/rca/rca-1733761845-abc123" | jq '.result'
```

---

## ⚙️ 성능 최적화

### 설정값

```typescript
/** 최대 이력 항목 수 */
const MAX_HISTORY_SIZE = 20;

/** AI 호출 타임아웃 */
const AI_TIMEOUT = 30000;  // 30초

/** 재시도 횟수 */
const MAX_RETRIES = 2;

/** 재시도 대기 시간 */
retry_delay = 1000 * (attempt + 1);  // 지수 백오프
```

### Timeline 기간

```typescript
/** 기본적으로 최근 5분 데이터만 분석 */
buildTimeline(anomalies, logs, minutes = 5)
```

---

## 🔍 Fallback 트리거 조건

RCA 분석이 실패하는 경우:

1. AI 호출 실패 (네트워크 오류, 타임아웃)
2. JSON 파싱 실패
3. AI 응답이 예상 형식 없음

**이때 자동으로 규칙 기반 분석으로 전환되며, 신뢰도는 0.3으로 표시됩니다.**

---

## 📚 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/rca-engine.ts` | 메인 RCA 엔진 |
| `src/types/rca.ts` | 타입 정의 |
| `src/app/api/rca/route.ts` | API 엔드포인트 |
| `src/lib/anomaly-detector.ts` | Layer 1 이상 탐지 |
| `src/lib/ai-client.ts` | AI 호출 (Claude) |

---

## 🎯 주요 특징 요약

✅ **Component-centric Analysis**: Optimism 아키텍처 기반
✅ **Causal Chain Tracing**: 근본 원인부터 최종 증상까지 추적
✅ **Dependency Graph**: 컴포넌트 의존성 자동 계산
✅ **AI-Powered**: Claude 기반 의미 분석
✅ **Fallback Support**: AI 실패 시 규칙 기반 분석
✅ **Actionable Advice**: 즉시 조치 + 예방 조치 제시
✅ **History Management**: 최근 20개 분석 결과 저장
