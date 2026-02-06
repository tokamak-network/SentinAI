# Predictive Scaling — Seed 기반 UI 검증 가이드

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 작성일 | 2026-02-06 |
| 기반 문서 | `docs/predictive-scaling-verification.md` |
| 대상 | 프론트엔드 QA, 개발자 |
| 선행 조건 | K8s/RPC 불필요. `npm run dev`만 실행하면 됨 |

---

## 1. 개요

`POST /api/metrics/seed?scenario=<name>` 엔드포인트를 통해 MetricsStore에 시나리오별 Mock 데이터를 주입하고, 대시보드 UI에서 Predictive Scaling 기능을 검증한다.

**장점**: 실제 L2 RPC 연결이나 K8s 클러스터 없이도 Scaling Forecast 카드의 동작을 완전히 검증 가능.

### 사용 가능한 시나리오

| 시나리오 | CPU 패턴 | TxPool 패턴 | 예상 예측 결과 |
|---------|---------|------------|---------------|
| `stable` | 15~25% 평탄 | 10~30 | maintain, 1 vCPU |
| `rising` | 20% → 70% 선형 증가 | 20 → 200 증가 | scale_up, 2~4 vCPU |
| `spike` | 30% 평탄 → 마지막 5개 95% | 50 → 5000 급증 | scale_up, 4 vCPU |
| `falling` | 80% → 20% 감소 | 300 → 20 감소 | scale_down, 1 vCPU |

---

## 2. 사전 준비

```bash
# 개발 서버 실행 (L2_RPC_URL 없어도 seed 기능은 동작)
npm run dev
# http://localhost:3002 접속
```

> **주의**: Seed 엔드포인트와 UI는 `NODE_ENV !== 'production'` 환경에서만 활성화된다.

---

## 3. UI 검증 항목

### TC-S01: Seed Test Data 패널 표시

**목적**: 개발 환경에서 Seed UI 컴포넌트가 정상 렌더링되는지 확인

**절차**:
1. 브라우저에서 `http://localhost:3002` 접속
2. 좌측 Resource Center → Scaling Forecast 카드 확인

**합격 기준**:
- [ ] "Seed Test Data" 라벨과 Database 아이콘이 표시됨
- [ ] 드롭다운에 4개 시나리오 옵션이 존재: Stable, Rising, Spike, Falling
- [ ] "Seed" 버튼이 활성 상태 (indigo 색상)
- [ ] 드롭다운 기본값이 "Rising (20% → 70%)"

---

### TC-S02: Stable 시나리오 주입 및 예측 확인

**목적**: 안정 상태 데이터 주입 후 "maintain" 예측이 표시되는지 확인

**절차**:
1. 드롭다운에서 "Stable (15~25% CPU)" 선택
2. "Seed" 버튼 클릭
3. 버튼이 "Seeding..." 상태로 변경 후 복귀 대기

**합격 기준**:
- [ ] 버튼 클릭 시 "Seeding..." 텍스트로 변경되고 비활성화됨
- [ ] 완료 후 버튼이 "Seed"로 복귀
- [ ] Scaling Forecast 카드의 Action 배지가 **파란색 "Stable"** 표시
- [ ] AI Insight 영역에 reasoning 텍스트 표시 (예: "stable", "idle" 관련 문구)
- [ ] Data Collection 프로그레스 바가 사라짐 (`isReady: true`)
- [ ] Predicted vCPU가 **1 vCPU**로 표시
- [ ] Trend 화살표 아이콘이 **회색 (45도 회전)**

---

### TC-S03: Rising 시나리오 주입 및 Scale-Up 예측 확인

**목적**: 상승 트렌드 데이터 주입 후 "scale_up" 예측이 표시되는지 확인

**절차**:
1. 드롭다운에서 "Rising (20% → 70%)" 선택
2. "Seed" 버튼 클릭
3. 결과 대기

**합격 기준**:
- [ ] Action 배지가 **주황색 "Scale Up"** 표시
- [ ] Predicted vCPU가 **2 또는 4 vCPU**로 표시
- [ ] Predicted vCPU 박스가 **주황색 배경** (현재보다 높은 값)
- [ ] Trend 화살표가 **주황색** (rising)
- [ ] AI Insight 영역에 상승 트렌드 관련 reasoning 표시
- [ ] Key Factors 섹션이 표시되고 1~3개 요소 존재
- [ ] Key Factors 중 impact > 0.3인 항목에 **주황색 점** 표시

---

### TC-S04: Spike 시나리오 주입 및 긴급 Scale-Up 확인

**목적**: 급격한 스파이크 데이터 주입 후 최대 스케일업 예측 확인

**절차**:
1. 드롭다운에서 "Spike (30% → 95%)" 선택
2. "Seed" 버튼 클릭
3. 결과 대기

**합격 기준**:
- [ ] Action 배지가 **주황색 "Scale Up"** 표시
- [ ] Predicted vCPU가 **4 vCPU**로 표시
- [ ] AI Insight에 spike 또는 급격한 증가 관련 reasoning 표시
- [ ] AI Confidence 퍼센트가 표시됨 (예: "AI Confidence: 85%")

---

### TC-S05: Falling 시나리오 주입 및 Scale-Down 예측 확인

**목적**: 하강 트렌드 데이터 주입 후 "scale_down" 예측 확인

**절차**:
1. 드롭다운에서 "Falling (80% → 20%)" 선택
2. "Seed" 버튼 클릭
3. 결과 대기

**합격 기준**:
- [ ] Action 배지가 **초록색 "Scale Down"** 표시
- [ ] Predicted vCPU가 **1 vCPU**로 표시
- [ ] Predicted vCPU 박스가 현재와 같거나 **초록색 배경** (현재보다 낮은 값)
- [ ] Trend 화살표가 **초록색 (180도 회전)**
- [ ] Key Factors 중 impact < -0.3인 항목에 **초록색 점** 표시

---

### TC-S06: 시나리오 간 전환 일관성

**목적**: 여러 시나리오를 연속 전환할 때 UI가 올바르게 갱신되는지 확인

**절차**:
1. Rising 시나리오 Seed → 결과 확인
2. 바로 Falling 시나리오 Seed → 결과 확인
3. 바로 Spike 시나리오 Seed → 결과 확인
4. 바로 Stable 시나리오 Seed → 결과 확인

**합격 기준**:
- [ ] 각 전환 시 이전 예측 데이터가 완전히 교체됨
- [ ] Action 배지 색상이 시나리오에 맞게 변경됨
- [ ] Predicted vCPU 값이 시나리오에 맞게 변경됨
- [ ] Trend 화살표 방향/색상이 시나리오에 맞게 변경됨
- [ ] 에러나 깨진 UI 없음

---

### TC-S07: Seed 버튼 연속 클릭 방어

**목적**: Seeding 진행 중 재클릭이 차단되는지 확인

**절차**:
1. "Seed" 버튼 클릭
2. "Seeding..." 상태에서 버튼을 다시 클릭 시도

**합격 기준**:
- [ ] "Seeding..." 상태에서 버튼이 비활성화됨 (cursor-not-allowed)
- [ ] 중복 요청이 발생하지 않음
- [ ] 완료 후 정상 동작 복귀

---

### TC-S08: Data Collection 프로그레스 바 → 예측 전환

**목적**: 데이터 부족 → Seed 주입 후 프로그레스 바가 사라지고 예측이 표시되는 전환 확인

**절차**:
1. 서버를 재시작하여 MetricsStore 초기화
2. 대시보드 접속 → "Collecting Data..." 프로그레스 바 확인
3. Seed 버튼으로 데이터 주입

**합격 기준**:
- [ ] 서버 재시작 직후 "Collecting Data..." 프로그레스 바 표시
- [ ] 프로그레스 바 아래에 "N/10 data points" 텍스트 표시
- [ ] Seed 주입 후 프로그레스 바가 사라짐
- [ ] 예측 결과 (Current vCPU → Predicted vCPU) 시각화가 대신 표시됨

---

## 4. CLI 검증 (보조)

UI 검증 전후로 API 레벨에서 데이터를 확인하는 보조 절차.

### 4.1 시나리오 주입 확인

```bash
# Rising 시나리오 주입
curl -s -X POST "http://localhost:3002/api/metrics/seed?scenario=rising" | python3 -m json.tool
```

**기대 응답**:
```json
{
    "success": true,
    "scenario": "rising",
    "injectedCount": 20,
    "timeRange": { "from": "...", "to": "..." },
    "summary": {
        "cpuRange": "18.5% - 71.2%",
        "txPoolRange": "15 - 208"
    }
}
```

### 4.2 주입 후 예측 확인

```bash
curl -s "http://localhost:3002/api/scaler" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('predictionMeta', {})
pred = d.get('prediction')
print(f'metricsCount: {meta.get(\"metricsCount\")}')
print(f'isReady: {meta.get(\"isReady\")}')
if pred:
    print(f'predictedVcpu: {pred[\"predictedVcpu\"]}')
    print(f'confidence: {pred[\"confidence\"]}')
    print(f'trend: {pred[\"trend\"]}')
    print(f'action: {pred[\"recommendedAction\"]}')
    print(f'reasoning: {pred[\"reasoning\"][:80]}...')
else:
    print('prediction: null')
"
```

### 4.3 4개 시나리오 일괄 검증

```bash
for scenario in stable rising spike falling; do
  echo "=== $scenario ==="
  curl -s -X POST "http://localhost:3002/api/metrics/seed?scenario=$scenario" > /dev/null
  sleep 1
  curl -s "http://localhost:3002/api/scaler" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pred = d.get('prediction')
if pred:
    print(f'  vcpu={pred[\"predictedVcpu\"]} trend={pred[\"trend\"]} action={pred[\"recommendedAction\"]} conf={pred[\"confidence\"]}')
else:
    print('  prediction: null')
"
  echo ""
done
```

**기대 결과**:
```
=== stable ===
  vcpu=1 trend=stable action=maintain conf=0.xx

=== rising ===
  vcpu=2 trend=rising action=scale_up conf=0.xx

=== spike ===
  vcpu=4 trend=rising action=scale_up conf=0.xx

=== falling ===
  vcpu=1 trend=falling action=scale_down conf=0.xx
```

> **참고**: AI Gateway 미연결 시 Fallback 예측이 반환되며, confidence=0.5로 고정된다. Fallback 모드에서도 trend와 recommendedAction은 데이터 패턴에 따라 올바르게 판단된다.

---

## 5. 검증 체크리스트 요약

### Seed UI 렌더링

- [ ] TC-S01: Seed Test Data 패널 표시

### 시나리오별 예측 결과

- [ ] TC-S02: Stable → maintain, 1 vCPU, 파란 배지
- [ ] TC-S03: Rising → scale_up, 2~4 vCPU, 주황 배지
- [ ] TC-S04: Spike → scale_up, 4 vCPU, 주황 배지
- [ ] TC-S05: Falling → scale_down, 1 vCPU, 초록 배지

### 인터랙션

- [ ] TC-S06: 시나리오 간 전환 일관성
- [ ] TC-S07: Seed 버튼 연속 클릭 방어
- [ ] TC-S08: 프로그레스 바 → 예측 전환

---

*문서 끝*
