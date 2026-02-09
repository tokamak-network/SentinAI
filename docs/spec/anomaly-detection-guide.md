# Anomaly Detection 기준 및 동작 방식

## 📋 개요

SentinAI의 이상 탐지(Anomaly Detection)는 **3계층 파이프라인**으로 구성되어 있습니다:

1. **Layer 1**: 통계 기반 이상 탐지 (Z-Score + Rule-based)
2. **Layer 2**: AI 의미 분석 (Claude 기반 근본원인 분석)
3. **Layer 3**: 알림 발송 (Slack/Webhook)

---

## 🔍 Layer 1: 통계 기반 이상 탐지

### 개요

Layer 1은 **실시간 메트릭 데이터**를 분석하여 즉각적인 이상을 탐지합니다.

**파일**: `src/lib/anomaly-detector.ts`

### 감지 메트릭

| 메트릭 | 단위 | 설명 |
|--------|------|------|
| **cpuUsage** | % | L2 노드 CPU 사용률 (0~100%) |
| **txPoolPending** | 개 | 대기 중인 트랜잭션 개수 |
| **gasUsedRatio** | % | 블록의 가스 사용 비율 (0~1) |
| **l2BlockHeight** | 번호 | L2 최신 블록 높이 |
| **l2BlockInterval** | 초 | 연속 블록 생성 간격 |

### 탐지 규칙

#### 1️⃣ Z-Score 기반 탐지 (가장 일반적)

**기준**: 평균으로부터 표준편차의 2.5배 이상 벗어남

```
Z-Score = (현재값 - 평균) / 표준편차

탐지 조건: |Z-Score| > 2.5
```

**예시**:
```
CPU 사용률 평균: 30%
표준편차: 5%
현재값: 50%

Z-Score = (50 - 30) / 5 = 4.0
→ 4.0 > 2.5 이므로 이상 탐지! (Spike)
```

**설정값**:
```typescript
const Z_SCORE_THRESHOLD = 2.5;  // 신뢰도 99.3%
const MIN_HISTORY_POINTS = 5;   // 최소 이력 데이터 5개
```

**적용 대상**:
- CPU Usage (Z-Score 이용)
- TxPool Pending (Z-Score 이용)
- Gas Used Ratio (Z-Score 이용)
- L2 Block Interval (Z-Score 이용)

---

#### 2️⃣ CPU 0% Drop (프로세스 크래시)

**기준**: CPU가 갑자기 0%로 떨어짐

```
최근 3개 데이터의 평균 CPU >= 10%
→ 현재 CPU < 1%
→ 프로세스 크래시 의심
```

**설정값**:
```typescript
if (currentCpu < 1 && recentMean >= 10) {
  // 프로세스 크래시로 판단
}
```

**예시**:
```
최근 CPU 변화: 35% → 32% → 38% (평균 35%)
현재 CPU: 0%

→ 이상 탐지! (Drop, rule: zero-drop)
→ 심각도: Critical (프로세스 중단)
```

---

#### 3️⃣ L2 Block Height Plateau (Sequencer 정지)

**기준**: 블록 높이가 2분 이상 변화 없음

```
최근 2분간 모든 블록 높이 동일
→ Sequencer 정지 의심
```

**설정값**:
```typescript
const BLOCK_PLATEAU_SECONDS = 120;  // 2분

// 검사
if (모든_최근_높이가_동일 && 지속시간 >= 120초) {
  // Sequencer 정지로 판단
}
```

**예시**:
```
시간    블록높이  상태
14:00  12340    ✓
14:30  12340    ✓
15:00  12340    ✓ ← 60분 동안 변화 없음

→ 이상 탐지! (Plateau, rule: plateau)
→ 심각도: High (Sequencer 정지)
```

---

#### 4️⃣ TxPool 단조 증가 (Batcher 실패)

**기준**: 트랜잭션 풀이 5분 이상 계속 증가

```
최근 5분간 모든 txPool 값이 증가하거나 같음
→ Batcher 실패 의심 (트랜잭션 배치 미처리)
```

**설정값**:
```typescript
const TXPOOL_MONOTONIC_SECONDS = 300;  // 5분

// 검사
for (let i = 1; i < history.length; i++) {
  if (현재[i] < 현재[i-1]) {
    isMonotonic = false;  // 한 번이라도 감소하면 정상
  }
}

if (isMonotonic && 증가량 > 0) {
  // Batcher 실패로 판단
}
```

**예시**:
```
시간    TxPool  상태
00:00  100     ✓
01:00  150     ✓ (증가)
02:00  180     ✓ (증가)
03:00  190     ✓ (증가)
04:00  195     ✓ (증가)
05:00  200     ✓ (증가) ← 5분 동안 계속 증가

→ 이상 탐지! (Spike, rule: monotonic-increase)
→ 심각도: High (Batcher 배치 미처리)
```

---

### 탐지 우선순위

탐지 순서 (충돌 방지):

```typescript
1. CPU 0% Drop (가장 심각)
2. L2 Block Height Plateau
3. TxPool Monotonic Increase
4. Z-Score 기반 탐지 (위의 규칙에서 이미 탐지된 메트릭 제외)
```

### 예외 처리

| 조건 | 동작 |
|------|------|
| 이력 데이터 < 5개 | 탐지 스킵 (데이터 부족) |
| 표준편차 = 0 | Z-Score = 0 (정상, 변동 없음) |
| 메트릭이 이미 탐지됨 | 중복 탐지 방지 |

---

## 🧠 Layer 2: AI 의미 분석

### 개요

Layer 1에서 이상을 탐지하면, Layer 2에서 **Claude AI**를 사용하여 근본 원인을 분석합니다.

**파일**: `src/lib/anomaly-ai-analyzer.ts`

### 프롬프트 구조

```
System Prompt:
├─ SRE 역할 정의
├─ Optimism 컴포넌트 관계도
├─ 일반적인 실패 패턴 (5가지)
└─ 분석 가이드라인

User Prompt:
├─ 탐지된 이상 목록
├─ 현재 메트릭 데이터
└─ 관련 로그 (op-geth, op-node, op-batcher, op-proposer)
```

### Optimism 컴포넌트 실패 패턴

| 패턴 | 원인 | 증상 | 영향 |
|------|------|------|------|
| **L1 Reorg** | L1 체인 재조직 | op-node 유도 상태 리셋 → 임시 동기화 정지 | 블록 높이 정체 |
| **L1 Gas Spike** | L1 가스비 급등 | Batcher가 L1에 배치 전송 못함 | TxPool 증가 |
| **op-geth Crash** | op-geth 프로세스 중단 | CPU 0% 급락 | 모든 다운스트림 영향 |
| **Network Partition** | P2P 네트워크 단절 | 동료 노드와 통신 불가 | Unsafe head 발산 |
| **Sequencer Stall** | Sequencer 정지 | 블록 생성 멈춤 | 블록 높이 정체, TxPool 증가 |

### AI 분석 결과

```typescript
interface DeepAnalysisResult {
  severity: 'low' | 'medium' | 'high' | 'critical';
  anomalyType: 'performance' | 'security' | 'consensus' | 'liveness';
  correlations: string[];           // 연관된 증상들
  predictedImpact: string;          // 예상 영향
  suggestedActions: string[];       // 권장 조치
  relatedComponents: string[];      // 영향받는 컴포넌트
}
```

**예시**:
```json
{
  "severity": "critical",
  "anomalyType": "liveness",
  "correlations": [
    "CPU 0% 급락 감지됨",
    "TxPool 단조 증가 시작 (배치 미처리)"
  ],
  "predictedImpact": "op-geth가 중단되었으므로 모든 트랜잭션 처리 중단. 사용자 트래픽 영향.",
  "suggestedActions": [
    "op-geth 프로세스 재시작",
    "메모리/디스크 여유 확인",
    "최근 로그 검토"
  ],
  "relatedComponents": [
    "op-geth",
    "op-node",
    "op-batcher"
  ]
}
```

### 성능 최적화

**캐싱**:
```typescript
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;  // 5분

// 동일한 이상에 대해 5분 내 재분석하지 않음
```

**Rate Limiting**:
```typescript
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;  // 1분

// 분당 최대 1회 AI 호출
```

---

## 📢 Layer 3: 알림 발송

### 알림 필터링

**조건**:
1. AI 분석 severity >= 설정된 임계값
2. 마지막 알림 이후 cooldown 경과

**설정값**:
```typescript
interface AlertConfig {
  enabled: boolean;                    // 알림 활성화 여부
  webhookUrl?: string;                 // Slack/Discord URL
  thresholds: {
    notifyOn: AISeverity[];            // 알림 대상 심각도 (low/medium/high/critical)
    cooldownMinutes: number;           // 중복 알림 방지 (분)
  };
}
```

**기본값**:
```typescript
notifyOn: ['high', 'critical']        // High 이상만 알림
cooldownMinutes: 10                   // 10분 cooldown
```

### 알림 채널

| 채널 | 용도 | 설정 |
|------|------|------|
| **Slack** | 운영팀 통보 | `ALERT_WEBHOOK_URL` |
| **Webhook** | 외부 시스템 연동 | Custom URL |
| **Dashboard** | 대시보드 표시 | 자동 기록 |

---

## 📊 전체 파이프라인

```
메트릭 수집 (1분 간격)
    ↓
Layer 1: 통계 탐지 (즉시)
    ├─ Z-Score 검사
    ├─ CPU 0% Drop 검사
    ├─ Block Plateau 검사
    ├─ TxPool Monotonic 검사
    ↓
[이상 탐지됨?]
    │
    ├─ YES → Layer 2: AI 분석 (1분마다 1회만)
    │         ├─ 근본 원인 분석
    │         ├─ 심각도 평가
    │         └─ 권장 조치 제시
    │            ↓
    │         Layer 3: 알림 발송 (설정 기반)
    │         └─ Severity >= 임계값 이고 Cooldown 경과
    │
    └─ NO → 정상 (계속 모니터링)
```

---

## 🧪 테스트 예시

### Quick Test: Z-Score 탐지

```bash
# 1. Mock 데이터 생성 (상승 추세)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 2. 이상 확인
curl -s "http://localhost:3002/api/metrics" | jq '.anomalies'

# 예상 결과:
# [
#   {
#     "isAnomaly": true,
#     "metric": "cpuUsage",
#     "direction": "spike",
#     "zScore": 3.2,
#     "rule": "z-score"
#   }
# ]
```

### Deep Test: AI 분석

```bash
# 1. 이상 이벤트 조회
curl -s "http://localhost:3002/api/anomalies" | jq '.events[0]'

# 2. Layer 2 AI 분석 확인
curl -s "http://localhost:3002/api/anomalies" | jq '.events[0].deepAnalysis'

# 예상 결과:
# {
#   "severity": "high",
#   "anomalyType": "performance",
#   "correlations": ["CPU 스파이크 지속"],
#   "predictedImpact": "블록 생성 지연 가능성",
#   "suggestedActions": ["..."],
#   "relatedComponents": ["op-geth", "op-node"]
# }
```

---

## ⚙️ 설정 커스터마이징

### 환경변수

```bash
# .env.local에서 설정 가능

# Z-Score 임계값 조정 (기본 2.5)
# anomaly-detector.ts에서 Z_SCORE_THRESHOLD 수정

# Block Plateau 시간 (기본 120초)
# BLOCK_PLATEAU_SECONDS = 120

# TxPool Monotonic 시간 (기본 300초)
# TXPOOL_MONOTONIC_SECONDS = 300

# 알림 설정
# /api/anomalies/config에서 설정 가능
```

### API로 알림 설정 변경

```bash
curl -X PUT "http://localhost:3002/api/anomalies/config" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "thresholds": {
      "notifyOn": ["high", "critical"],
      "cooldownMinutes": 10
    }
  }'
```

---

## 📈 메트릭별 참고값

### CPU Usage

| 상태 | CPU % | 설명 |
|------|-------|------|
| 정상 | 20~40 | 일반적인 L2 노드 |
| 부하 | 40~70 | 높은 트래픽 |
| 위험 | 70~99 | 임박한 오버로드 |
| 크래시 | 0~1 | 프로세스 중단 |

### Block Interval

| 상태 | 간격 | 설명 |
|------|------|------|
| 정상 | 2~4초 | Optimism 표준 |
| 느림 | 4~10초 | 네트워크 지연 |
| 매우 느림 | 10~60초 | 심각한 정체 |
| 정지 | 60초+ | Sequencer 정지 |

### TxPool Pending

| 상태 | 개수 | 설명 |
|------|------|------|
| 정상 | 0~1000 | 일반 부하 |
| 높음 | 1000~10000 | Batcher 지연 |
| 매우 높음 | 10000+ | Batcher 실패 |

---

## 🔗 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/anomaly-detector.ts` | Layer 1 통계 탐지 |
| `src/lib/anomaly-ai-analyzer.ts` | Layer 2 AI 분석 |
| `src/lib/alert-dispatcher.ts` | Layer 3 알림 발송 |
| `src/types/anomaly.ts` | 타입 정의 |
| `src/app/api/anomalies/route.ts` | API 엔드포인트 |

---

## 📚 추가 자료

- [Anomaly Detection Proposal](./done/proposal-2-anomaly-detection.md)
- [RCA Engine Guide](./done/proposal-3-rca-engine.md)
- [Alert Configuration API](../app/api/anomalies/config/route.ts)
