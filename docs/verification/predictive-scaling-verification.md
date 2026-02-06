# Predictive Scaling 기능 검증 및 성능 평가

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-02-06 |
| 기반 문서 | `docs/proposal-1-predictive-scaling.md` |
| 대상 | QA, DevOps, 프로젝트 관리자 |

---

## 1. 구현 완료 상태

### 1.1 파일별 구현 현황

| 파일 | 상태 | 라인 수 | 비고 |
|------|------|---------|------|
| `src/types/prediction.ts` | 완료 | 169 | 8개 타입/인터페이스 정의 |
| `src/lib/metrics-store.ts` | 완료 | 169 | Ring Buffer (60개), 선형회귀 트렌드 감지 |
| `src/lib/predictive-scaler.ts` | 완료 | 311 | AI Gateway 연동, Fallback 로직 |
| `src/lib/prediction-tracker.ts` | 완료 | 153 | 정확도 추적 (최대 100개 기록) |
| `src/app/api/metrics/route.ts` | 수정 완료 | - | `pushMetric` 연동, blockInterval 계산 |
| `src/app/api/scaler/route.ts` | 수정 완료 | - | GET/POST에 예측 로직 통합 |
| `src/app/page.tsx` | 수정 완료 | - | Forecast 카드, 트렌드 차트, 진행률 UI |

### 1.2 Proposal 대비 구현 충실도

- **타입 정의**: 100% 일치 (proposal 명세 그대로)
- **MetricsStore**: 100% 일치 (Ring Buffer, 통계, 트렌드)
- **Predictive Scaler**: 100% 일치 (AI 연동, Fallback, Rate Limiting)
- **Prediction Tracker**: 100% 일치 (정확도 추적)
- **API 연동**: 100% 일치 (metrics pushMetric, scaler 예측 통합)
- **UI**: 100% 일치 (Forecast 카드, 진행률, Key Factors)
- **테스트 코드**: 미구현

---

## 2. 기능 검증 절차

### 2.1 사전 조건

```bash
# 1. 환경변수 설정 (.env.local)
L2_RPC_URL=https://rpc.titok.tokamak.network   # 필수
AI_GATEWAY_URL=https://api.ai.tokamak.network   # 예측 AI용
ANTHROPIC_API_KEY=<your-key>                     # 예측 AI용

# 2. 개발 서버 실행
npm run dev    # localhost:3002

# 또는 Docker
docker compose up -d    # localhost:3002
```

### 2.2 TC-01: MetricsStore 데이터 수집 검증

**목적**: `/api/metrics` 호출 시 MetricsStore에 데이터가 축적되는지 확인

```bash
# 15회 연속 호출 (5초 간격)
for i in $(seq 1 15); do
  echo "=== Request $i ==="
  curl -s "http://localhost:3002/api/metrics" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"cpu={d['metrics']['cpuUsage']:.1f}%, txPool={d['metrics']['txPoolCount']}, block={d['metrics']['blockHeight']}\")"
  sleep 5
done
```

**합격 기준**:
- [ ] 매 호출마다 JSON 응답 반환 (HTTP 200)
- [ ] 서버 로그에 `Kubectl Failed` 또는 RPC 데이터 출력 (K8s 미연결 시 에러는 허용)
- [ ] cpuUsage, txPoolCount, blockHeight 값이 매번 갱신됨

### 2.3 TC-02: 예측 메타데이터 확인 (데이터 부족 상태)

**목적**: 데이터 포인트가 10개 미만일 때 `prediction: null`, `isReady: false` 반환 확인

```bash
# 서버 재시작 직후 (데이터 0개 상태) 호출
curl -s "http://localhost:3002/api/scaler" | python3 -m json.tool
```

**합격 기준**:
- [ ] `prediction` 필드가 `null`
- [ ] `predictionMeta.metricsCount` < 10
- [ ] `predictionMeta.isReady` = `false`
- [ ] `predictionMeta.minRequired` = 10

**기대 응답**:
```json
{
  "currentVcpu": 1,
  "prediction": null,
  "predictionMeta": {
    "metricsCount": 0,
    "minRequired": 10,
    "nextPredictionIn": 0,
    "isReady": false
  }
}
```

### 2.4 TC-03: AI 예측 생성 검증 (데이터 충분 상태)

**목적**: 10개 이상 데이터 축적 후 AI 예측이 정상 생성되는지 확인

```bash
# Step 1: 데이터 축적 (최소 10회, 약 50초)
for i in $(seq 1 12); do
  curl -s "http://localhost:3002/api/metrics" > /dev/null
  echo "Collected data point $i"
  sleep 5
done

# Step 2: 예측 확인
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('predictionMeta', {})
pred = d.get('prediction')
print(f\"metricsCount: {meta.get('metricsCount')}\")
print(f\"isReady: {meta.get('isReady')}\")
if pred:
    print(f\"predictedVcpu: {pred['predictedVcpu']}\")
    print(f\"confidence: {pred['confidence']}\")
    print(f\"trend: {pred['trend']}\")
    print(f\"action: {pred['recommendedAction']}\")
    print(f\"reasoning: {pred['reasoning'][:100]}...\")
    print(f\"factors: {len(pred.get('factors', []))} items\")
else:
    print('prediction: null (AI not available or insufficient data)')
"
```

**합격 기준**:
- [ ] `predictionMeta.isReady` = `true`
- [ ] `prediction` 필드가 `null`이 아님 (AI 연결 시) 또는 Fallback 예측 반환
- [ ] `predictedVcpu`가 1, 2, 4 중 하나
- [ ] `confidence`가 0.0~1.0 범위
- [ ] `trend`가 `rising`, `falling`, `stable` 중 하나
- [ ] `recommendedAction`이 `scale_up`, `scale_down`, `maintain` 중 하나
- [ ] `factors` 배열에 1개 이상의 요소 존재

### 2.5 TC-04: Rate Limiting (5분 쿨다운) 검증

**목적**: 5분 이내 재요청 시 캐시된 예측이 반환되는지 확인

```bash
# Step 1: 첫 번째 예측 요청
PRED1=$(curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prediction',{}).get('generatedAt','none'))")
echo "Prediction 1 generatedAt: $PRED1"

# Step 2: 즉시 재요청
PRED2=$(curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prediction',{}).get('generatedAt','none'))")
echo "Prediction 2 generatedAt: $PRED2"

# Step 3: nextPredictionIn 확인
curl -s "http://localhost:3002/api/scaler" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"nextPredictionIn: {d['predictionMeta']['nextPredictionIn']:.0f}s\")"
```

**합격 기준**:
- [ ] `PRED1`과 `PRED2`의 `generatedAt` 타임스탬프가 동일 (캐시 반환)
- [ ] `nextPredictionIn` > 0 (쿨다운 중)

### 2.6 TC-05: AI Gateway 장애 시 Fallback 검증

**목적**: AI Gateway 연결 실패 시 규칙 기반 Fallback 예측이 동작하는지 확인

```bash
# AI_GATEWAY_URL을 잘못된 주소로 변경 후 실행
AI_GATEWAY_URL=http://localhost:9999 npm run dev

# 데이터 축적 후 예측 요청
# (위 TC-03과 동일한 데이터 축적 절차 수행 후)
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
pred = d.get('prediction')
if pred:
    print(f\"confidence: {pred['confidence']}\")
    print(f\"reasoning: {pred['reasoning']}\")
else:
    print('No prediction')
"
```

**합격 기준**:
- [ ] 서버가 크래시하지 않음
- [ ] `prediction`이 `null`이 아님 (Fallback 동작)
- [ ] `confidence` = 0.5 (Fallback 고정값)
- [ ] `reasoning`에 "Fallback" 문자열 포함

### 2.7 TC-06: 선제적 스케일링 의사결정 검증

**목적**: POST `/api/scaler` 호출 시 예측 기반 선제적 스케일업이 반응형보다 우선하는지 확인

```bash
# Auto-scaling + dry run으로 테스트
curl -s -X POST "http://localhost:3002/api/scaler" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}' | python3 -m json.tool
```

**합격 기준**:
- [ ] `decision.reason`에 `[Predictive]` 접두사 포함 (예측 기반 결정 시)
- [ ] 또는 반응형 결정 사용 (예측 confidence < 0.7이거나 scale_up이 아닌 경우)
- [ ] `dryRun: true`로 실제 K8s 변경 없음

### 2.8 TC-07: UI 검증

**목적**: 대시보드에서 예측 관련 UI 요소가 정상 표시되는지 확인

```
브라우저에서 http://localhost:3002 (또는 Docker: http://localhost:3002) 접속
```

| 검증 항목 | 확인 방법 |
|-----------|----------|
| Scaling Forecast 카드 | "Scaling Forecast" 제목 표시 |
| 데이터 수집 진행률 | 서버 시작 직후: "Collecting Data..." 프로그레스 바 |
| 예측 vCPU 시각화 | 데이터 충분 시: Current vCPU → Predicted vCPU 비교 |
| Trend 방향 | 화살표 아이콘이 trend에 따라 색상 변경 (rising=주황, falling=초록) |
| Action 배지 | Scale Up(주황), Scale Down(초록), Stable(파랑) |
| AI Insight | 예측 reasoning 텍스트 표시 |
| Key Factors | 최대 3개 요소, impact에 따른 색상 표시 |
| Resource Trend 차트 | CPU % 영역 차트, trend 라벨 표시 |

### 2.9 TC-08: 스트레스 모드와의 독립성

**목적**: `stress=true` 모드에서는 MetricsStore에 데이터가 저장되지 않는지 확인

```bash
# 스트레스 모드 호출 10회
for i in $(seq 1 10); do
  curl -s "http://localhost:3002/api/metrics?stress=true" > /dev/null
done

# metricsCount 확인 (증가하지 않아야 함)
curl -s "http://localhost:3002/api/scaler" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"metricsCount: {d['predictionMeta']['metricsCount']}\")"
```

**합격 기준**:
- [ ] `metricsCount`가 스트레스 모드 호출 전후 동일 (증가하지 않음)

---

## 3. 성능 평가 기준

### 3.1 메트릭 수집 성능

| 지표 | 목표값 | 측정 방법 |
|------|--------|----------|
| pushMetric 오버헤드 | < 1ms | metrics API 응답 시간 비교 (push 전/후) |
| Ring Buffer 메모리 | < 50KB | 60개 데이터 포인트 × ~800 bytes/point |
| 통계 계산 시간 | < 5ms | `getMetricsStats()` 실행 시간 |

**측정 스크립트**:
```bash
# 50회 호출의 평균 응답 시간
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:3002/api/metrics"
done | awk '{sum+=$1; count++} END {printf "avg: %.3fs (n=%d)\n", sum/count, count}'
```

### 3.2 AI 예측 성능

| 지표 | 목표값 | 비고 |
|------|--------|------|
| AI Gateway 응답 시간 | < 3s | Claude Haiku 4.5 기준 |
| Fallback 응답 시간 | < 10ms | 규칙 기반, 네트워크 불필요 |
| Rate Limiting 효과 | 5분당 최대 1회 AI 호출 | 비용 제어 |
| 캐시 히트율 | > 95% | 5분 쿨다운 대비 폴링 빈도 고려 |

**측정 스크립트**:
```bash
# scaler API 응답 시간 (예측 포함)
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:3002/api/scaler"
done | awk '{sum+=$1; count++} END {printf "avg: %.3fs (n=%d)\n", sum/count, count}'
```

### 3.3 예측 정확도 평가

> **참고**: 정확도 측정은 실제 K8s 클러스터 연결 환경에서 장기간 (24시간+) 운영 후에만 의미 있는 수치를 얻을 수 있습니다.

| 지표 | 목표값 | 비고 |
|------|--------|------|
| 전체 정확도 | > 70% | predicted vs actual vCPU 차이 ≤ 1 |
| 최근 20건 정확도 | > 75% | 학습 효과 반영 |
| False Positive Rate | < 20% | 불필요한 scale_up 비율 |
| 선제적 스케일링 효과 | > 0 | 반응형 대비 더 빨리 스케일업한 횟수 |

**Prediction Tracker API** (현재 내부 모듈, API 엔드포인트 미노출):
```typescript
// prediction-tracker.ts 에서 제공하는 정확도 통계
import { getAccuracy } from '@/lib/prediction-tracker';

const stats = getAccuracy();
// {
//   totalPredictions: 45,
//   verifiedPredictions: 30,
//   accuratePredictions: 24,
//   accuracyRate: 0.80,
//   recentAccuracy: 0.85,
// }
```

### 3.4 비용 영향 평가

| 시나리오 | 예상 비용 영향 |
|---------|---------------|
| AI Gateway 호출 | ~288 calls/day (5분 쿨다운 기준) |
| 선제적 스케일업 (적중) | 서비스 중단 방지, 비용 중립 |
| 선제적 스케일업 (오탐) | 불필요한 vCPU 증가 → 최대 $0.09/hour 추가 비용 |
| Fallback 모드 | AI 비용 $0, 정확도 하락 감수 |

---

## 4. Edge Case 검증

| # | 시나리오 | 예상 동작 | 검증 방법 |
|---|---------|----------|----------|
| E-01 | AI Gateway 타임아웃 | Fallback 예측 (confidence 0.5) | AI_GATEWAY_URL을 느린 서버로 설정 |
| E-02 | AI가 잘못된 JSON 반환 | Fallback 예측 | 수동 테스트 또는 단위 테스트 |
| E-03 | AI가 `predictedVcpu: 3` 반환 | `parseAIResponse`가 null 반환 → Fallback | 단위 테스트 |
| E-04 | AI가 `confidence: 1.5` 반환 | `parseAIResponse`가 null 반환 → Fallback | 단위 테스트 |
| E-05 | MetricsStore 버퍼 초과 (61개+) | 가장 오래된 데이터 제거 (60개 유지) | 61회 pushMetric 후 count 확인 |
| E-06 | 서버 재시작 | MetricsStore 초기화 (인메모리) | 서버 재시작 후 metricsCount=0 |
| E-07 | 동시 다수 요청 | Rate Limiting으로 1회만 AI 호출 | 병렬 curl 10개 실행 |
| E-08 | L2 RPC 연결 실패 | metrics API 500 → 데이터 수집 중단 | L2_RPC_URL을 잘못된 값으로 설정 |

---

## 5. 알려진 제약사항

### 5.1 인메모리 상태 휘발성

MetricsStore, PredictionTracker, 스케일링 상태가 모두 인메모리로 관리됩니다. 서버 재시작 시 모든 시계열 데이터와 예측 기록이 초기화됩니다.

**영향**: 배포/재시작 후 최소 10개 데이터 포인트 축적까지 예측 불가 (약 50초~10분)

### 5.2 Prediction Tracker 미연동

`prediction-tracker.ts`가 구현되어 있으나, `scaler/route.ts`에서 `recordPrediction()` / `recordActual()`을 호출하지 않고 있습니다. 정확도 추적을 활성화하려면 추가 연동이 필요합니다.

### 5.3 단일 메트릭 소스

현재 `metrics/route.ts`의 폴링 주기(프론트엔드 1초)에 의존하여 데이터가 수집됩니다. 별도의 백그라운드 수집기가 없으므로 UI를 열어둔 상태에서만 데이터가 축적됩니다.

### 5.4 테스트 코드 부재

단위 테스트, 통합 테스트가 아직 작성되지 않았습니다. `parseAIResponse`, `calculateStats`, `generateFallbackPrediction` 등의 핵심 함수에 대한 테스트가 권장됩니다.

---

## 6. 검증 체크리스트 요약

### 빌드 및 타입 안전성

- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npm run lint` 에러 없음 (기존 warning 허용)
- [ ] `npm run build` 성공

### 기능 검증 (TC-01 ~ TC-08)

- [ ] TC-01: MetricsStore 데이터 수집
- [ ] TC-02: 데이터 부족 시 prediction null
- [ ] TC-03: AI 예측 생성
- [ ] TC-04: Rate Limiting (5분 쿨다운)
- [ ] TC-05: AI Fallback 동작
- [ ] TC-06: 선제적 스케일링 의사결정
- [ ] TC-07: UI 요소 표시
- [ ] TC-08: 스트레스 모드 독립성

### 성능 기준

- [ ] metrics API 응답 < 3s (K8s 연결 시)
- [ ] scaler API 응답 < 5s (AI 호출 포함)
- [ ] Fallback 응답 < 100ms
- [ ] 메모리 사용 안정 (60개 데이터 포인트 제한)

---

*문서 끝*
