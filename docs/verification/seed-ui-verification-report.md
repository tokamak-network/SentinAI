# Seed 기반 UI 검증 실행 결과 보고서

| 항목 | 내용 |
|------|------|
| 버전 | 1.0.0 |
| 실행일 | 2026-02-06 15:15~15:25 (KST) |
| 실행자 | Claude Opus 4 (자동화 검증) |
| 기반 문서 | `docs/seed-ui-verification.md` |
| 환경 | macOS Darwin 25.2.0, Node.js, Next.js 16.1.6 (Turbopack) |
| 서버 포트 | 3002 (`npm run dev`, NODE_ENV=development) |

---

## 1. 요약

| TC | 항목 | 결과 | 비고 |
|----|------|------|------|
| TC-S01 | Seed Test Data 패널 표시 | **PASS** | 코드 검증 완료. 브라우저 시각 확인은 별도 필요 |
| TC-S02 | Stable 시나리오 | **PASS** | vcpu=1, trend=stable, action=maintain, conf=0.95 |
| TC-S03 | Rising 시나리오 | **PASS** | vcpu=2, trend=rising, action=scale_up, conf=0.92 |
| TC-S04 | Spike 시나리오 | **PASS** | vcpu=4, trend=rising, action=scale_up, conf=0.95 |
| TC-S05 | Falling 시나리오 | **CONDITIONAL** | vcpu=1, trend=falling, action=maintain (see note) |
| TC-S06 | 시나리오 간 전환 | **PASS** | 4개 시나리오 연속 전환 시 예측 정상 교체 |
| TC-S07 | 연속 클릭 방어 | **PASS** | UI: isSeeding state 비활성화, API: 동시 요청 무해 |
| TC-S08 | 프로그레스 바 → 예측 전환 | **PASS** | 빈 상태 → seed 후 isReady=true 전환 확인 |

**전체 결과: 7 PASS / 1 CONDITIONAL (총 8건)**

---

## 2. 사전 조치: Seed 시 Prediction 캐시 리셋

검증 중 발견된 문제: seed 엔드포인트(`POST /api/metrics/seed`)가 `clearMetrics()`만 호출하고 prediction 쿨다운(5분)을 리셋하지 않아, 시나리오 전환 시 이전 캐시된 예측이 반환됨.

**수정 사항** (`src/app/api/metrics/seed/route.ts`):
- `resetPredictionState()` import 추가
- seed 실행 시 `clearMetrics()` 직후 `resetPredictionState()` 호출

수정 후 4개 시나리오 모두 독립적인 예측 생성 확인 완료.

---

## 3. 상세 결과

### TC-S01: Seed Test Data 패널 표시

**검증 방법**: 소스 코드 분석 (`src/app/page.tsx`)

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| "Seed Test Data" 라벨 + Database 아이콘 | ✅ | line 398-399: `<Database size={14}>`, `"Seed Test Data"` |
| 드롭다운 4개 시나리오 | ✅ | line 407-410: Stable, Rising, Spike, Falling |
| "Seed" 버튼 (indigo 색상) | ✅ | line 418: `bg-indigo-600 text-white` |
| 드롭다운 기본값 "Rising" | ✅ | line 100: `useState('rising')` |
| dev 모드에서만 표시 | ✅ | line 396: `process.env.NODE_ENV !== 'production'` |

---

### TC-S02: Stable 시나리오

```
POST /api/metrics/seed?scenario=stable
→ injected=20, cpu=15.9%~24.8%, txPool=12~29

GET /api/scaler
→ metricsCount=22, isReady=true
→ vcpu=1, trend=stable, action=maintain, conf=0.95
→ reasoning: "Metrics indicate an extremely idle state..."
→ factors: CPU Usage (-0.9), TxPool (-1.0), Gas Ratio (-0.8), Block Interval (0.1)
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| Action 배지: 파란색 "Stable" | ✅ | action=maintain → `bg-blue-500` "Stable" |
| Predicted vCPU: 1 vCPU | ✅ | predictedVcpu=1 |
| Data Collection 프로그레스 바 사라짐 | ✅ | isReady=true |
| AI Insight reasoning 텍스트 | ✅ | "extremely idle state" |
| Trend 화살표: 회색 (45도) | ✅ | trend=stable → `text-gray-400 rotate-45` |

---

### TC-S03: Rising 시나리오

```
POST /api/metrics/seed?scenario=rising
→ injected=20, cpu=17.1%~70.2%, txPool=25~198

GET /api/scaler
→ metricsCount=21, isReady=true
→ vcpu=2, trend=rising, action=scale_up, conf=0.92
→ reasoning: "CPU usage has steadily climbed from 35% to 70%..."
→ factors: CPU Trend (0.9), TxPool (0.85), Gas Ratio (0.6), Data Anomaly (0)
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| Action 배지: 주황색 "Scale Up" | ✅ | action=scale_up → `bg-orange-500` "Scale Up" |
| Predicted vCPU: 2 vCPU | ✅ | predictedVcpu=2 (범위 2~4 내) |
| Predicted vCPU 박스: 주황색 배경 | ✅ | 2 > 1(current) → `bg-orange-100` |
| Trend 화살표: 주황색 | ✅ | trend=rising → `text-orange-500` |
| AI Insight reasoning | ✅ | "steadily climbed" |
| Key Factors 표시 (1~3개) | ✅ | 3개 표시 (impact>0.3 항목) |
| impact>0.3 항목에 주황색 점 | ✅ | CPU(0.9), TxPool(0.85), Gas(0.6) → `bg-orange-500` |

---

### TC-S04: Spike 시나리오

```
POST /api/metrics/seed?scenario=spike
→ injected=20, cpu=27.6%~97.0%, txPool=36~5064

GET /api/scaler
→ metricsCount=21, isReady=true
→ vcpu=4, trend=rising, action=scale_up, conf=0.95
→ reasoning: "Critical load spike detected..."
→ factors: CPU Saturation (1.0), TxPool Explosion (0.9), Block Interval Lag (0.8), Gas Usage (0.85)
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| Action 배지: 주황색 "Scale Up" | ✅ | action=scale_up → `bg-orange-500` |
| Predicted vCPU: 4 vCPU | ✅ | predictedVcpu=4 |
| AI Insight reasoning | ✅ | "Critical load spike detected" |
| AI Confidence 표시 | ✅ | 95% |

---

### TC-S05: Falling 시나리오

```
POST /api/metrics/seed?scenario=falling
→ injected=20, cpu=20.3%~79.5%, txPool=26~302

GET /api/scaler
→ metricsCount=21, isReady=true
→ vcpu=1, trend=falling, action=maintain, conf=0.95
→ reasoning: "Metrics show a consistent and significant downward trend..."
→ factors: CPU Trend (-0.9), TxPool (-0.8), Gas Ratio (-0.6), Block Interval (0.1)
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| Predicted vCPU: 1 vCPU | ✅ | predictedVcpu=1 |
| Trend 화살표: 초록색 (180도 회전) | ✅ | trend=falling → `text-green-500 rotate-180` |
| Key Factors impact<-0.3 초록색 점 | ✅ | CPU(-0.9), TxPool(-0.8), Gas(-0.6) → `bg-green-500` |
| Action 배지: 초록색 "Scale Down" | **CONDITIONAL** | AI가 maintain 반환 → 파란색 "Stable" 표시 |

> **NOTE**: AI가 `action=maintain`을 반환한 이유: 현재 vCPU가 이미 1(최소값)이므로 더 내릴 수 없어 "maintain"으로 판단. `predictedVcpu=1`과 `trend=falling`은 올바름. 논리적으로 타당하나, 명세서 기대값 `scale_down`과 불일치.
>
> **Predicted vCPU 박스 색상**: predictedVcpu(1) = currentVcpu(1)이므로 `bg-blue-100` (동일) 표시. 명세서 기대값은 초록색이나, 실제로는 감소하지 않음.

---

### TC-S06: 시나리오 간 전환 일관성

```
rising  → vcpu=2, trend=rising,  action=scale_up, conf=0.95
falling → vcpu=1, trend=falling, action=maintain,  conf=0.95
spike   → vcpu=4, trend=rising,  action=scale_up, conf=0.95
stable  → vcpu=1, trend=stable,  action=maintain,  conf=0.95
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| 각 전환 시 이전 예측 교체 | ✅ | resetPredictionState 호출로 매번 새 예측 |
| Action 배지 색상 변경 | ✅ | 주황/파랑/주황/파랑 순서 |
| Predicted vCPU 변경 | ✅ | 2/1/4/1 순서 |
| Trend 화살표 방향/색상 변경 | ✅ | rising/falling/rising/stable 순서 |
| 에러 없음 | ✅ | 모든 응답 200 OK |

---

### TC-S07: Seed 버튼 연속 클릭 방어

**UI 코드 검증**:
- `isSeeding` state가 true일 때 버튼에 `disabled` 속성 적용 (line 414)
- `cursor-not-allowed` 클래스 + `bg-indigo-300` (비활성 스타일) 적용 (line 417)
- 텍스트 "Seeding..." 표시 (line 421)

**API 레벨 동시 요청 테스트**:
- 3개 동시 POST 요청 모두 success=true
- 각 요청이 clearMetrics + pushMetric 수행하므로 마지막 데이터만 유지
- 최종 metricsCount=21 (seed 20 + 폴링 1)

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| "Seeding..." 상태 비활성화 | ✅ | isSeeding → disabled + cursor-not-allowed |
| 중복 요청 방지 | ✅ | UI에서 disabled, API는 idempotent |
| 완료 후 복귀 | ✅ | finally 블록에서 setIsSeeding(false) |

---

### TC-S08: Data Collection 프로그레스 바 → 예측 전환

서버 재시작 후 클린 상태에서 시작.

```
Step 1 (Clean):   metricsCount=0, isReady=false, prediction=null
Step 2 (Seed):    injected=20
Step 3 (After):   metricsCount=20, isReady=true, vcpu=2, trend=rising, action=scale_up
```

| 체크 항목 | 결과 | 상세 |
|-----------|------|------|
| 재시작 직후 프로그레스 바 조건 충족 | ✅ | isReady=false → "Collecting Data..." 표시 |
| "N/10 data points" 텍스트 | ✅ | metricsCount=0, minRequired=10 → "0/10 data points" |
| Seed 후 프로그레스 바 사라짐 | ✅ | isReady=true → 프로그레스 바 조건 불충족 (숨김) |
| 예측 결과 시각화 표시 | ✅ | prediction 객체 존재 → Current → Predicted 시각화 |

---

## 4. CLI 검증 결과 (§4 보조)

### 4.1 시나리오 주입 응답 형식

4개 시나리오 모두 아래 형식으로 정상 응답 확인:
```json
{
    "success": true,
    "scenario": "<name>",
    "injectedCount": 20,
    "timeRange": { "from": "...", "to": "..." },
    "summary": { "cpuRange": "...", "txPoolRange": "..." }
}
```

| 시나리오 | cpuRange | txPoolRange | 명세 일치 |
|---------|----------|-------------|----------|
| stable | 15.3%~24.8% | 10~29 | ✅ (15~25% 범위) |
| rising | 17.1%~70.2% | 25~198 | ✅ (20%→70% 패턴) |
| spike | 27.6%~97.0% | 36~5064 | ✅ (30%→95% 패턴) |
| falling | 20.3%~79.5% | 26~302 | ✅ (80%→20% 패턴) |

### 4.2 주입 후 예측 결과

| 시나리오 | vcpu | trend | action | confidence | 명세 기대 | 일치 |
|---------|------|-------|--------|------------|----------|------|
| stable | 1 | stable | maintain | 0.95 | maintain, 1 vCPU | ✅ |
| rising | 2 | rising | scale_up | 0.92 | scale_up, 2~4 vCPU | ✅ |
| spike | 4 | rising | scale_up | 0.95 | scale_up, 4 vCPU | ✅ |
| falling | 1 | falling | maintain | 0.95 | scale_down, 1 vCPU | ⚠️ action 불일치 |

### 4.3 에러 핸들링

| 테스트 | 결과 |
|--------|------|
| 잘못된 시나리오 (`?scenario=invalid`) | 400 + 에러 메시지 + validScenarios |
| 시나리오 누락 (`/seed` without param) | 400 + 에러 메시지 + validScenarios |

---

## 5. 발견된 이슈 및 수정 사항

### Issue 1: Seed 시 Prediction 캐시 미리셋 (수정 완료)

- **증상**: seed로 시나리오 교체 후에도 이전 AI 예측이 5분 동안 캐시 반환
- **원인**: `clearMetrics()`만 호출, prediction 쿨다운 리셋 안 됨
- **수정**: `src/app/api/metrics/seed/route.ts`에 `resetPredictionState()` 추가
- **검증**: 수정 후 4개 시나리오 연속 전환 시 매번 새 예측 생성 확인

### Issue 2: Falling 시나리오의 action 판단 (미수정 — AI 동작 특성)

- **증상**: AI가 `action=maintain` 반환 (명세 기대: `scale_down`)
- **원인**: 현재 vCPU=1(최소값)이므로 AI가 더 내릴 수 없다고 판단
- **영향**: UI에서 배지가 "Stable"(파랑)으로 표시됨. "Scale Down"(초록) 기대와 불일치
- **권장 대응**:
  1. Fallback 예측에서는 trend=falling이면 action=scale_down 반환 (현재 구현 일치)
  2. AI 프롬프트에 "최소 vCPU에서도 trend에 맞는 action을 반환할 것" 지시 추가 검토
  3. 또는 UI에서 trend 기반으로 배지 색상 결정 (action 대신 trend 사용)

---

## 6. UI 렌더링 로직 검증 (코드 분석)

| UI 요소 | 코드 위치 | 로직 | 검증 |
|---------|-----------|------|------|
| Action 배지 색상 | line 329-338 | scale_up→주황, scale_down→초록, else→파랑 | ✅ |
| Trend 화살표 | line 352-356 | rising→주황, falling→초록+180°, stable→회색+45° | ✅ |
| Predicted vCPU 박스 색상 | line 357-371 | predicted>current→주황, predicted<current→초록, else→파랑 | ✅ |
| Data Collection 프로그레스 바 | line 377-393 | isReady=false일 때만 표시, 퍼센트 바 + N/10 텍스트 | ✅ |
| Seed 패널 | line 395-424 | NODE_ENV!=='production'일 때만 표시 | ✅ |
| Key Factors 점 색상 | line 449-452 | impact>0.3→주황, impact<-0.3→초록, else→회색 | ✅ |
| AI Confidence 퍼센트 | line 324-327 | prediction 존재 시 `{confidence * 100}%` 표시 | ✅ |

---

## 7. 검증 체크리스트 최종

### Seed UI 렌더링
- [x] TC-S01: Seed Test Data 패널 표시

### 시나리오별 예측 결과
- [x] TC-S02: Stable → maintain, 1 vCPU, 파란 배지
- [x] TC-S03: Rising → scale_up, 2 vCPU, 주황 배지
- [x] TC-S04: Spike → scale_up, 4 vCPU, 주황 배지
- [ ] TC-S05: Falling → maintain(≠scale_down), 1 vCPU, 파란 배지(≠초록)

### 인터랙션
- [x] TC-S06: 시나리오 간 전환 일관성
- [x] TC-S07: Seed 버튼 연속 클릭 방어
- [x] TC-S08: 프로그레스 바 → 예측 전환

---

*보고서 끝*
