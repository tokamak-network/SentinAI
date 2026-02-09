# SentinAI 대시보드 통합 테스트 계획

> **문서 목표**: Proposal 2 (이상 탐지), Proposal 4 (비용 최적화), Daily Report 기능을 대시보드에서 직접 테스트하기 위한 세분화된 테스트 항목 및 기준

**작성일**: 2026-02-09
**테스트 대상**: 3가지 기능
**테스트 환경**: 로컬 개발 서버 (`npm run dev`, port 3002)

---

## 목차

1. [테스트 환경 준비](#테스트-환경-준비)
2. [Proposal 2: 이상 탐지 (Anomaly Detection)](#proposal-2-이상-탐지-anomaly-detection)
3. [Proposal 4: 비용 최적화 (Cost Optimizer)](#proposal-4-비용-최적화-cost-optimizer)
4. [Daily Report: 일일 운영 보고서](#daily-report-일일-운영-보고서)
5. [통합 테스트 시나리오](#통합-테스트-시나리오)
6. [버그 리포팅 템플릿](#버그-리포팅-템플릿)

---

## 테스트 환경 준비

### 사전 체크리스트

```bash
# 1. 환경 변수 확인
cat .env.local | grep -E "(L2_RPC|ANTHROPIC_API_KEY|ALERT_WEBHOOK|COST_TRACKING)"

# 2. 의존성 설치
npm install

# 3. 서버 빌드 및 시작
npm run build
npm run dev

# 4. 서버 상태 확인
curl -s http://localhost:3002/api/health | jq
# Expected: { "status": "healthy" }
```

### 데이터베이스 리셋 (테스트 간 초기화)

```bash
# 메트릭 스토어, 이상 이벤트, 축적기 데이터 모두 인메모리이므로
# 서버 재시작으로 초기화됨
```

### 개발 도구 열기

- Chrome DevTools (F12)
- Network 탭: API 호출 확인
- Console 탭: 에러 로그 확인
- Application/Storage 탭: 로컬스토리지 확인

---

## Proposal 2: 이상 탐지 (Anomaly Detection)

### 개요

**3-Layer 파이프라인:**
1. **Layer 1** - 통계 기반 탐지 (Z-Score, 규칙)
2. **Layer 2** - AI 시맨틱 분석 (Claude Haiku)
3. **Layer 3** - 알림 발송 (Dashboard, Slack)

**UI 위치:**
- 대시보드 상단: 빨간색 "Anomaly Alert Banner"
- AI Monitor 섹션: "Real-time Anomalies" 피드
- API: `GET /api/anomalies`, `GET /api/anomalies/config`, `POST /api/anomalies/config`

---

### 테스트 1.1: Layer 1 - 통계 기반 탐지

#### 테스트 목표
Z-Score 및 규칙 기반 이상 탐지가 정확하게 작동하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 1.1.1 | Z-Score 탐지 | CPU 급증 시뮬레이션 후 이상 탐지 | `anomalies[]` 배열에 CPU 이상 포함 | 배열이 비어있음 또는 다른 메트릭 오탐 |
| 1.1.2 | CPU 0% 급락 | `effectiveCpu = 0`으로 설정, 이전 평균 > 10% | CPU drop 이상 탐지, rule='zero-drop' | 탐지 안 됨 |
| 1.1.3 | 블록 높이 정체 | 같은 블록높이 2분 이상 유지 | l2BlockHeight 이상, rule='plateau' | 탐지 안 됨 |
| 1.1.4 | TxPool 단조 증가 | txPoolPending 5분간 계속 증가 | txPoolPending 이상, rule='monotonic-increase' | 탐지 안 됨 |
| 1.1.5 | 정상 상태 | 모든 메트릭이 평상적 범위 내 | `anomalies: []` 반환 | 오탐 발생 |

#### 테스트 절차

**케이스 1.1.1: Z-Score 탐지**

```bash
# Step 1: Seed 데이터 주입 (rising 시나리오 - CPU 상승)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising" \
  -H "Content-Type: application/json"

# Step 2: 1분 대기 (데이터 축적)
sleep 60

# Step 3: 메트릭 조회 및 확인
curl -s "http://localhost:3002/api/metrics" | jq '.anomalies'

# Expected Output:
# [
#   {
#     "isAnomaly": true,
#     "metric": "cpuUsage",
#     "value": 45.2,
#     "zScore": 3.8,
#     "direction": "spike",
#     "description": "...",
#     "rule": "z-score"
#   }
# ]
```

**체크포인트 (대시보드)**
- [ ] 상단에 빨간색 "Anomaly Detected (1)" 배너 표시
- [ ] "Analyze Now" 버튼 표시
- [ ] AI Monitor의 "Real-time Anomalies" 섹션에 이상 메트릭 나열

**케이스 1.1.2: CPU 0% 급락**

```bash
# Step 1: 메트릭/seed에서 effectiveCpu=0 설정
# (현재 seed API에 직접 옵션 없으므로, 대신 stress mode 테스트)

# Step 2: 대시보드에서 "Simulate Load" 버튼 클릭
# → CPU가 상승 (평균 > 10%)

# Step 3: 시뮬레이션 종료 후 바로 CPU 모니터링
# → 다음 주기에 effectiveCpu=0이면 이상 탐지

# 또는 K8s 환경에서 pod 재시작 시뮬레이션
kubectl delete pod -l app=op-geth -n default
# → CPU 급락 관찰
```

---

### 테스트 1.2: Layer 2 - AI 시맨틱 분석

#### 테스트 목표
탐지된 이상에 대해 Claude AI가 심각도, 유형, 권장사항을 정확하게 분석하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 1.2.1 | 심각도 분류 | 이상 분석 결과의 severity | `severity ∈ {low, medium, high, critical}` | severity 값이 잘못되었거나 없음 |
| 1.2.2 | 이상 유형 분류 | 이상 유형 (performance/security/consensus/liveness) | `anomalyType ∈ {performance, security, consensus, liveness}` | 유형 값이 범위 밖 또는 없음 |
| 1.2.3 | 관련 컴포넌트 | AI가 식별한 영향받는 컴포넌트 | `relatedComponents` 배열 포함 (예: op-geth, op-node) | 배열이 비어있거나 정확하지 않음 |
| 1.2.4 | 권장 조치 | AI가 제시하는 구체적 행동 | `suggestedActions` 배열에 2개 이상의 구체적 조치 | 배열이 비어있거나 일반적인 텍스트만 포함 |
| 1.2.5 | Rate Limiting | 1분 내 연속 AI 호출 시 캐싱 | 2번째 호출이 캐시된 결과 반환 | API가 재호출됨 (Rate limit 미작동) |
| 1.2.6 | AI 실패 폴백 | AI Gateway 연결 실패 시 | 기본 심각도(medium) + 폴백 메시지 | 에러 응답 또는 빈 데이터 |

#### 테스트 절차

**케이스 1.2.1: 심각도 분류**

```bash
# Step 1: CPU 급락 이상 생성 (매우 심각)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"

# Step 2: 1분 대기 후 메트릭 조회
sleep 60
curl -s "http://localhost:3002/api/metrics" | jq '.anomalies'
# → isAnomaly=true 확인

# Step 3: 이상 이벤트 API 조회
curl -s "http://localhost:3002/api/anomalies" | jq '.events[0].deepAnalysis.severity'

# Expected: "high" 또는 "critical"
```

**체크포인트 (대시보드)**
- [ ] 이상 배너의 "Analyze Now" 클릭 후 로딩 표시
- [ ] 30초 이내에 AI 분석 완료 (Haiku는 빠름)
- [ ] 분석 결과 표시: 심각도, 유형, 권장사항

**케이스 1.2.5: Rate Limiting**

```bash
# Step 1: 이상 생성
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# Step 2: 즉시 이상 이벤트 조회 (첫 번째 AI 호출)
curl -s "http://localhost:3002/api/anomalies?limit=1" | \
  jq '.events[0].deepAnalysis'
# → 분석 결과 반환 (timestamp 기록)

firstAnalysisTime=$(date +%s)

# Step 3: 10초 후 다시 조회 (Rate limit 내 - 캐시 반환 기대)
sleep 10
curl -s "http://localhost:3002/api/anomalies?limit=1" | \
  jq '.events[0].deepAnalysis.timestamp'

# Expected: 첫 번째와 동일한 timestamp (캐시됨)
```

---

### 테스트 1.3: Layer 3 - 알림 발송

#### 테스트 목표
임계값에 따라 올바른 채널로 알림이 발송되고 쿨다운이 작동하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 1.3.1 | 대시보드 알림 | Dashboard 채널 알림 기록 | `getAlertHistory()` 배열에 레코드 추가 | 기록 없음 |
| 1.3.2 | Slack 알림 | Webhook URL 설정 시 Slack 알림 | Slack 채널에 메시지 수신 | 메시지 미수신 |
| 1.3.3 | 심각도 필터링 | notifyOn=['high', 'critical'] 설정 시 low/medium 필터 | low/medium 이상은 알림 안 보냄 | low 이상도 알림 전송 |
| 1.3.4 | 쿨다운 동작 | cooldownMinutes=10 설정 후 연속 이상 | 첫 번째만 알림, 10분 내 추가는 차단 | 매번 알림 전송 |
| 1.3.5 | 설정 업데이트 | POST /api/anomalies/config 변경 | 새 설정 반영 | 이전 설정 유지 |

#### 테스트 절차

**케이스 1.3.1: 대시보드 알림 기록**

```bash
# Step 1: 현재 알림 설정 확인
curl -s "http://localhost:3002/api/anomalies/config" | jq '.config'

# Step 2: 이상 생성
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"

# Step 3: 30초 대기 (AI 분석 완료 대기)
sleep 30

# Step 4: 알림 기록 조회
curl -s "http://localhost:3002/api/anomalies/config" | \
  jq '.alertsSent24h, .config.thresholds'

# Expected: alertsSent24h >= 1
```

**체크포인트 (대시보드)**
- [ ] 이상 배너에 "Analyze Now" 버튼 표시
- [ ] 클릭 후 배너가 업데이트 (분석 완료 신호)

**케이스 1.3.2: Slack 알림 (선택사항)**

```bash
# Step 1: Webhook URL 설정
curl -X POST "http://localhost:3002/api/anomalies/config" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "thresholds": {
      "notifyOn": ["high", "critical"],
      "cooldownMinutes": 5
    },
    "enabled": true
  }'

# Step 2: 이상 생성 (high 이상)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"

# Step 3: 30초 대기

# Step 4: Slack 채널 확인 → 메시지 수신 확인
```

**케이스 1.3.4: 쿨다운**

```bash
# Step 1: 5분 쿨다운 설정
curl -X POST "http://localhost:3002/api/anomalies/config" \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": {
      "notifyOn": ["critical"],
      "cooldownMinutes": 5
    },
    "enabled": true
  }'

# Step 2: 첫 번째 이상 생성
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=spike"
sleep 30

# Step 3: 첫 번째 알림 카운트
curl -s "http://localhost:3002/api/anomalies/config" | \
  jq '.alertsSent24h'
# Expected: 1

# Step 4: 두 번째 이상 생성 (쿨다운 중)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=falling"
sleep 30

# Step 5: 알림 카운트 확인
curl -s "http://localhost:3002/api/anomalies/config" | \
  jq '.alertsSent24h, .nextAlertAvailableAt'
# Expected: alertsSent24h=1 (변화 없음), nextAlertAvailableAt 있음
```

---

### 테스트 1.4: UI 통합

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 1.4.1 | 배너 표시 | 이상 탐지 시 상단 배너 | 빨간색 배너, 이상 설명 표시 | 배너 미표시 또는 잘못된 정보 |
| 1.4.2 | 배너 닫기 | 배너의 "X" 또는 "Analyze Now" 클릭 | 배너 숨김 또는 분석 트리거 | UI 반응 없음 |
| 1.4.3 | 이상 피드 | AI Monitor의 "Real-time Anomalies" | 탐지된 이상 목록 표시 | 피드 미표시 |
| 1.4.4 | 색상 코딩 | 이상 방향별 색상 (spike=빨강, drop=노랑, plateau=주황) | 올바른 색상 적용 | 색상 오류 |

#### 테스트 절차

**케이스 1.4.1-2: 배너 UI**

```
1. 대시보드 열기 (http://localhost:3002)
2. Seed 데이터 → rising scenario
3. 1분 대기
4. 상단에 빨간색 배너 확인
   - "Anomaly Detected (1)" 텍스트
   - 이상 설명 표시 (예: "CPU 사용률 급증")
   - "Analyze Now" 버튼
5. "Analyze Now" 클릭
6. AI 분석 진행 중 로딩 표시 확인
7. 분석 완료 후 배너가 상세 정보로 업데이트되는지 확인
```

**체크리스트**
- [ ] 배너 색상이 빨간색 (`bg-red-500/10`)
- [ ] 텍스트가 한국어 또는 영어로 명확
- [ ] "Analyze Now" 버튼이 클릭 가능
- [ ] 로딩 중 버튼이 비활성화 (`disabled`)

---

## Proposal 4: 비용 최적화 (Cost Optimizer)

### 개요

**주요 기능:**
1. vCPU 사용 패턴 분석 (7일간)
2. 시간대별 히트맵 시각화
3. Claude AI 기반 최적화 추천 (Opus 모델)
4. 월간 절감 예상액 제시

**UI 위치:**
- Resource Center 하단: "COST ANALYSIS" 버튼
- 펼쳐진 패널: AI 인사이트, 히트맵, 추천 카드

**API:**
- `GET /api/cost-report?days=7`

---

### 테스트 2.1: 데이터 수집 및 패턴 분석

#### 테스트 목표
usage-tracker가 올바르게 vCPU 사용 데이터를 수집하고, 패턴을 정확하게 분석하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 2.1.1 | 데이터 기록 | recordUsage() 호출 시 데이터 저장 | 내부 배열에 데이터 포인트 추가 | 데이터 미저장 |
| 2.1.2 | 시간대별 버킷 | 7일 × 24시간 = 168개 버킷 생성 | usagePatterns 길이 <= 168 | 버킷 개수 오류 |
| 2.1.3 | 평균/최대값 | 각 시간대의 avgVcpu, peakVcpu 계산 | 값이 1~4 범위 내 | 범위 밖 값 또는 0 |
| 2.1.4 | CPU 사용률 | avgUtilization 계산 (0-100) | 값이 0~100 범위 내 | 범위 밖 값 또는 -1 |
| 2.1.5 | 스트레스 모드 제외 | 스트레스 시뮬레이션 데이터(vcpu=8) 제외 | 8 vCPU 데이터 없음 | 8 vCPU 데이터 포함 |

#### 테스트 절차

**케이스 2.1.1-2: 데이터 기록 및 패턴 생성**

```bash
# Step 1: 서버 시작 (fresh start)
npm run dev

# Step 2: 2시간 동안 다양한 시나리오 실행
# (패턴 축적을 위해 여러 시간대 데이터 필요)

for i in {1..12}; do
  # Scenario 1: Rising (낮은 CPU)
  curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising" \
    --connect-timeout 5

  # 5분 대기 (다음 스냅샷 타이밍)
  sleep 300

  # Scenario 2: Stable (중간 CPU)
  if [ $((i % 2)) -eq 0 ]; then
    curl -X POST "http://localhost:3002/api/metrics/seed?scenario=stable" \
      --connect-timeout 5
    sleep 300
  fi
done

# Step 3: 비용 보고서 생성
curl -s "http://localhost:3002/api/cost-report?days=7" | \
  jq '.usagePatterns | length'
# Expected: 1 ~ 168 (수집된 시간대 수)
```

**검증 스크립트:**

```bash
# usagePatterns 검증
curl -s "http://localhost:3002/api/cost-report?days=7" | jq '
.usagePatterns[] |
select(.avgVcpu < 0 or .avgVcpu > 4 or
       .avgUtilization < 0 or .avgUtilization > 100) |
.hourOfDay, .dayOfWeek, .avgVcpu, .avgUtilization
'
# Expected: (empty - no errors)
```

**케이스 2.1.5: 스트레스 모드 제외**

```bash
# Step 1: 스트레스 모드 활성화
# (대시보드의 "Simulate Load" 버튼)

# Step 2: 1분 실행

# Step 3: 스트레스 모드 비활성화

# Step 4: 비용 보고서 생성
curl -s "http://localhost:3002/api/cost-report?days=7" | jq '
.usagePatterns |
map(select(.peakVcpu == 8)) |
length
'
# Expected: 0 (8 vCPU 데이터 없음)
```

---

### 테스트 2.2: AI 추천 생성

#### 테스트 목표
Claude AI (Opus)가 비용 최적화 추천을 정확하고 구체적으로 생성하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 2.2.1 | 추천 유형 | type ∈ {downscale, schedule, reserved, right-size} | 모든 값이 유효한 enum | 범위 밖 타입 |
| 2.2.2 | 비용 계산 | currentCost < projectedCost 또는 == (절감 없을 수 있음) | 값이 USD 형식, >= 0 | 음수 또는 비합리적 값 |
| 2.2.3 | 절감률 | savingsPercent = (current - projected) / current * 100 | 0 <= savingsPercent <= 100 | 범위 밖 |
| 2.2.4 | 신뢰도 | confidence ∈ [0, 1] | 소수 2자리 이내 | 범위 밖 또는 부정확 |
| 2.2.5 | 한국어 | title, description, implementation이 한글 | 모든 텍스트가 한글 | 영어 또는 혼합 |
| 2.2.6 | 구체성 | implementation에 구체적 코드/경로 | 예: "src/types/scaling.ts 수정" | "설정 변경" 같은 일반텍스트 |
| 2.2.7 | 위험도 | risk ∈ {low, medium, high} | 모든 값이 유효 | 범위 밖 또는 없음 |
| 2.2.8 | AI Insight | 한글, 3문장 이상, 데이터 기반 | 명확한 통찰과 수치 포함 | 일반적인 텍스트 또는 영어 |

#### 테스트 절차

**케이스 2.2.1-8: 종합 추천 검증**

```bash
# Step 1: 충분한 데이터 수집 (위 테스트 2.1 선행)

# Step 2: 비용 보고서 생성
curl -s "http://localhost:3002/api/cost-report?days=7" > cost_report.json

# Step 3: JSON 검증 스크립트 실행
cat << 'EOF' > validate_cost_report.sh
#!/bin/bash

# Parse JSON
report=$(cat cost_report.json)

# 2.2.1: Recommendation Type
echo "=== Checking Recommendation Types ==="
echo "$report" | jq '.recommendations[] | .type' | \
  grep -v -E "^\"(downscale|schedule|reserved|right-size)\"$" && echo "❌ Invalid type found" || echo "✓ All types valid"

# 2.2.2: Cost Calculation
echo -e "\n=== Checking Cost Values ==="
echo "$report" | jq '.recommendations[] |
  if .currentCost < 0 or .projectedCost < 0 then
    "❌ Negative cost: \(.currentCost), \(.projectedCost)"
  else
    "✓ OK"
  end'

# 2.2.3: Savings Percent
echo -e "\n=== Checking Savings Percent ==="
echo "$report" | jq '.recommendations[] |
  if .savingsPercent < 0 or .savingsPercent > 100 then
    "❌ Invalid percent: \(.savingsPercent)"
  else
    "✓ \(.savingsPercent)%"
  end'

# 2.2.4: Confidence
echo -e "\n=== Checking Confidence ==="
echo "$report" | jq '.recommendations[] |
  if .confidence < 0 or .confidence > 1 then
    "❌ Invalid confidence: \(.confidence)"
  else
    "✓ \(.confidence)"
  end'

# 2.2.5-6: Korean & Specificity
echo -e "\n=== Checking Korean Text & Specificity ==="
echo "$report" | jq '.recommendations[] |
  {
    title: .title,
    titleLen: (.title | length),
    implLen: (.implementation | length),
    hasKorean: (.title | test("[가-힣]"))
  } |
  if .hasKorean and .titleLen > 5 and .implLen > 20 then
    "✓ OK: \(.title) (\(.titleLen)자, impl:\(.implLen)자)"
  else
    "❌ Issue: title=\(.title), hasKorean=\(.hasKorean)"
  end'

# 2.2.7: Risk Level
echo -e "\n=== Checking Risk Level ==="
echo "$report" | jq '.recommendations[] | .risk' | \
  grep -v -E "^\"(low|medium|high)\"$" && echo "❌ Invalid risk found" || echo "✓ All risks valid"

# 2.2.8: AI Insight
echo -e "\n=== Checking AI Insight ==="
echo "$report" | jq '.aiInsight |
  {
    length: (. | length),
    lines: (. | split("\n") | length),
    hasKorean: (test("[가-힣]"))
  } |
  if .hasKorean and .length > 50 and .lines > 1 then
    "✓ Insight OK (\(.length)자, \(.lines)줄)"
  else
    "❌ Insight issue: length=\(.length), lines=\(.lines)"
  end'

EOF

chmod +x validate_cost_report.sh
./validate_cost_report.sh
```

**Expected Output (예시):**
```
=== Checking Recommendation Types ===
✓ All types valid

=== Checking Cost Values ===
✓ OK
✓ OK
✓ OK

=== Checking Savings Percent ===
✓ 23%
✓ 15%
✓ 8%

=== Checking Confidence ===
✓ 0.88
✓ 0.72
✓ 0.65

=== Checking Korean Text & Specificity ===
✓ OK: 야간 자동 스케일다운 (9자, impl:85자)
✓ OK: 스케일링 임계치 최적화 (10자, impl:72자)

=== Checking Risk Level ===
✓ All risks valid

=== Checking AI Insight ===
✓ Insight OK (256자, 3줄)
```

---

### 테스트 2.3: 히트맵 시각화

#### 테스트 목표
사용 패턴이 UI 히트맵으로 정확하게 렌더링되는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 2.3.1 | 그리드 크기 | 7행(요일) × 24열(시간) | 총 168개 셀 | 셀 개수 오류 |
| 2.3.2 | 색상 스케일 | CPU 사용률에 따른 색상 변화 | 낮음(초록) → 높음(빨강) | 색상 연속성 없음 |
| 2.3.3 | 요일 라벨 | 일-토 한글 표시 | 7개 라벨, 한글 표시 | 라벨 없음 또는 영어 |
| 2.3.4 | 시간 라벨 | 0, 4, 8, 12, 16, 20시 표시 | 6개 라벨 표시 | 라벨 누락 |
| 2.3.5 | 호버 정보 | 셀 hover 시 tooltip | "월 14:00 - 평균 2.1 vCPU, 67% 사용률" 형식 | Tooltip 없음 또는 포맷 오류 |
| 2.3.6 | 범례 | 낮음~높음 색상 범례 | 5개 색상 그래디언트 | 범례 없음 |

#### 테스트 절차

**케이스 2.3.1-6: UI 렌더링**

```
1. 대시보드 열기
2. Resource Center 하단의 "COST ANALYSIS" 버튼 클릭
3. 로딩 대기 (30초)
4. Cost Analysis 패널 펼쳐짐 확인
5. 히트맵 섹션 확인:
   ✓ 테이블이 7행 × 24열 그리드 형태
   ✓ 요일 라벨: 일, 월, 화, 수, 목, 금, 토 (한글)
   ✓ 시간 라벨: 0시, 4시, 8시, 12시, 16시, 20시
   ✓ 각 셀이 사각형 (3px 높이)
   ✓ 셀 색상이 연속적 변화 (초록 → 노랑 → 주황 → 빨강)
6. 셀 위에 마우스 호버:
   ✓ Tooltip 표시 (예: "월 09:00 - 평균 2.3 vCPU, 68% 사용률")
7. 히트맵 하단에 범례:
   ✓ "낮음" ← [초록] [초록] [노랑] [주황] [빨강] → "높음"
```

**Chrome DevTools 검증:**

```javascript
// Console에서 실행

// 1. 히트맵 셀 개수
document.querySelectorAll('[title*="vCPU"]').length
// Expected: 168 (또는 데이터가 있는 시간대만)

// 2. 요일 라벨
Array.from(document.querySelectorAll('.text-gray-500'))
  .filter(el => el.textContent.match(/[일월화수목금토]/))
  .length
// Expected: >= 7

// 3. 색상 분포 (초록 셀 개수)
document.querySelectorAll('.bg-green-900, .bg-green-700').length
// Expected: > 0 (낮은 사용률 셀)

// 4. Hover 테스트
document.querySelector('[title*="평균"]')?.title
// Expected: "월 14:00 - 평균 2.1 vCPU, 67% 사용률" 형식
```

---

### 테스트 2.4: 추천 카드 UI

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 2.4.1 | 카드 표시 | 최대 3개의 추천 카드 | 3개 이하 표시 | 4개 이상 또는 카드 없음 |
| 2.4.2 | 카드 제목 | 각 카드의 타이틀 표시 | 한글, 20자 이내 | 타이틀 없음 또는 너무 김 |
| 2.4.3 | 월간 절감액 | "-$14/월" 형식 | 녹색 텍스트, USD 형식 | 형식 오류 또는 음수 |
| 2.4.4 | 확장 클릭 | 카드 클릭 시 상세 정보 | 통계, 위험도, 구현 방법 표시 | 확장 안 됨 |
| 2.4.5 | 위험도 배지 | 위험도별 색상 (low=초록, medium=노랑, high=빨강) | 올바른 배지 색상 | 색상 오류 또는 배지 없음 |

#### 테스트 절차

**케이스 2.4.1-5: 카드 UI**

```
1. 히트맵 아래 "최적화 추천" 섹션 확인
2. 최대 3개의 카드 표시 확인
3. 각 카드 구조:
   [타이틀] [아이콘] [월간 절감액 ▶]
   [설명 텍스트]
4. 첫 번째 카드 클릭 → 확장
5. 확장된 내용:
   ✓ 현재 비용 / 예상 비용 / 절감률 (3개 박스)
   ✓ 위험도 배지 ("낮음"/초록, "중간"/노랑, "높음"/빨강)
   ✓ 신뢰도 (예: "신뢰도: 88%")
   ✓ 구현 방법 (상세 텍스트)
6. 카드 다시 클릭 → 축소
7. 닫기 버튼 클릭 → 전체 패널 닫힘
```

**체크리스트:**
- [ ] 카드 개수 <= 3
- [ ] 각 카드 제목이 한글
- [ ] 월간 절감액이 "-$XX" 형식 (초록색)
- [ ] 위험도 색상이 올바름
- [ ] 구현 방법이 구체적 (URL, 파일명 포함)

---

## Daily Report: 일일 운영 보고서

### 개요

**주요 기능:**
1. 24시간 메트릭 축적 (5분 간격)
2. 매일 23:55 자동 보고서 생성
3. Claude Opus 4.6로 한글 보고서 작성
4. `data/reports/YYYY-MM-DD.md` 저장

**API:**
- `GET /api/reports/daily` - 상태/목록 조회
- `POST /api/reports/daily` - 수동 보고서 생성
- `GET /api/reports/daily?date=YYYY-MM-DD` - 특정 보고서 조회

---

### 테스트 3.1: 메트릭 축적 (Daily Accumulator)

#### 테스트 목표
5분 간격으로 메트릭 스냅샷이 올바르게 축적되고, 시간별 요약이 정확하게 생성되는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 3.1.1 | 스냅샷 기록 | 5분마다 MetricSnapshot 저장 | snapshots 배열 증가 | 배열 변화 없음 |
| 3.1.2 | 최소 간격 | 4분 내 재호출 시 중복 방지 | null 반환, snapshots 변화 없음 | 중복 데이터 추가 |
| 3.1.3 | 시간별 요약 | 시간대별 avgCpu, maxCpu 계산 | hourly summary 생성 | 계산 오류 또는 누락 |
| 3.1.4 | 블록 추정 | blocksProduced = 300초 / avgBlockInterval | 블록 수 > 0 (정상 상황) | 음수 또는 0 |
| 3.1.5 | 날짜 변경 | 자정 시 새 날짜 데이터 시작 | 날짜 변경 시 snapshots 초기화 | 이전 데이터 혼합 |
| 3.1.6 | 데이터 완성도 | dataCompleteness = 수집 / 예상 | 0 ~ 1 범위의 소수 | 범위 밖 또는 정수 |

#### 테스트 절차

**케이스 3.1.1-4: 스냅샷 축적**

```bash
# Step 1: 서버 시작 후 축적기 상태 확인
curl -s "http://localhost:3002/api/reports/daily?status=true" | jq '
{
  initialized: .data.initialized,
  currentDate: .data.currentDate,
  snapshotCount: .data.snapshotCount,
  dataCompleteness: .data.dataCompleteness
}'

# Expected:
# {
#   "initialized": true,
#   "currentDate": "2026-02-09",
#   "snapshotCount": 0,
#   "dataCompleteness": 0
# }

# Step 2: 메트릭 생성 (스냅샷 트리거)
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=stable" \
  --connect-timeout 3

# Step 3: 5분 대기
sleep 300

# Step 4: 다시 상태 확인
curl -s "http://localhost:3002/api/reports/daily?status=true" | jq '.data | {
  snapshotCount,
  lastSnapshotTime,
  dataCompleteness
}'

# Expected:
# {
#   "snapshotCount": 1,
#   "lastSnapshotTime": "2026-02-09T XX:XX:XX.000Z",
#   "dataCompleteness": 0.2  # (1 / 5 expected in first hour)
# }

# Step 5: 추가 스냅샷 확인 (2회 반복)
for i in {1..2}; do
  curl -X POST "http://localhost:3002/api/metrics/seed?scenario=stable"
  sleep 300
done

# Step 6: 최종 상태
curl -s "http://localhost:3002/api/reports/daily?status=true" | jq '.data.snapshotCount'
# Expected: 3
```

**케이스 3.1.2: 중복 방지**

```bash
# Step 1: 스냅샷 기록
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=stable"
count1=$(curl -s "http://localhost:3002/api/reports/daily?status=true" | \
  jq '.data.snapshotCount')

# Step 2: 2분 후 다시 호출 (최소 간격 5분 미만)
sleep 120
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=stable"
count2=$(curl -s "http://localhost:3002/api/reports/daily?status=true" | \
  jq '.data.snapshotCount')

# Expected: count1 == count2 (변화 없음)
[ "$count1" -eq "$count2" ] && echo "✓ Duplication prevention working" || \
  echo "❌ Unexpected change: $count1 → $count2"
```

**케이스 3.1.6: 데이터 완성도**

```bash
# Completeness = collected / expected
# Expected 계산: (현재 시각 - 자정) / 5분

# 예: 오전 10:00에 12개 스냅샷 수집
# 자정~현재 = 600분 (10시간)
# 예상 스냅샷 = 600 / 5 = 120개
# 완성도 = 12 / 120 = 0.1 (10%)

curl -s "http://localhost:3002/api/reports/daily?status=true" | jq '
.data | {
  collected: .snapshotCount,
  completeness: .dataCompleteness,
  completenessPercent: (.dataCompleteness * 100 | round)
}'

# Expected:
# {
#   "collected": 12,
#   "completeness": 0.1,
#   "completenessPercent": 10
# }
```

---

### 테스트 3.2: 보고서 생성

#### 테스트 목표
축적된 데이터를 기반으로 Claude Opus가 정확하고 상세한 한글 보고서를 생성하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 3.2.1 | 마크다운 형식 | 제목, 섹션, 표 등이 올바른 마크다운 | 유효한 마크다운 구문 | 형식 오류 또는 파싱 실패 |
| 3.2.2 | 한글 작성 | 전체 보고서가 한글 | 모든 섹션이 한글 | 영어 혼합 또는 기계 번역 흔적 |
| 3.2.3 | 섹션 완성 | 5개 주요 섹션 포함 | 요약, 지표 분석, 스케일링, 이상, 권고 | 섹션 누락 |
| 3.2.4 | 데이터 정확도 | 보고서의 수치가 입력 데이터와 일치 | 평균 CPU, 최대 TxPool 등 정확 | 데이터 오류 또는 누락 |
| 3.2.5 | 테이블 형식 | 시간별 요약 테이블 | 파이프라인 테이블 형식 | 테이블 없음 또는 잘못된 형식 |
| 3.2.6 | 이상 분석 | warning/critical 로그 분석 | 이상이 있으면 언급, 없으면 "이상 없음" | 이상 판단 오류 |
| 3.2.7 | 권고사항 | 구체적이고 실행 가능한 조치 | 예: "K8s CronJob 설정..." | 일반적인 텍스트 또는 실행 불가 |

#### 테스트 절차

**케이스 3.2.1-7: 종합 보고서 검증**

```bash
# Step 1: 충분한 데이터 축적 (테스트 3.1 선행, 최소 10개 스냅샷)

# Step 2: 수동 보고서 생성 (debug=true로 프롬프트 포함)
curl -X POST "http://localhost:3002/api/reports/daily" \
  -H "Content-Type: application/json" \
  -d '{"debug": true}' | tee daily_report_response.json

# Step 3: 응답 검증
cat daily_report_response.json | jq '{
  success: .success,
  reportPath: .reportPath,
  contentLength: (.reportContent | length),
  dataCompleteness: .metadata.dataCompleteness,
  processingTimeMs: .metadata.processingTimeMs
}'

# Expected:
# {
#   "success": true,
#   "reportPath": "data/reports/2026-02-09.md",
#   "contentLength": 5000+,
#   "dataCompleteness": 0.4,
#   "processingTimeMs": 3000-5000
# }

# Step 4: 보고서 마크다운 검증 스크립트
cat << 'EOF' > validate_daily_report.sh
#!/bin/bash

report=$(jq -r '.reportContent' daily_report_response.json)

# 3.2.1: Markdown 형식
echo "=== Markdown Format ==="
if echo "$report" | grep -q "^# SentinAI 일일 운영 보고서"; then
  echo "✓ Main title found"
else
  echo "❌ No main title"
fi

if echo "$report" | grep -E "^## [0-9]\." > /dev/null; then
  sectionCount=$(echo "$report" | grep -E "^## [0-9]\." | wc -l)
  echo "✓ $sectionCount main sections found"
else
  echo "❌ No sections"
fi

# 3.2.2: Korean text
echo -e "\n=== Korean Content ==="
koreanCharCount=$(echo "$report" | grep -o '[가-힣]' | wc -l)
if [ "$koreanCharCount" -gt 100 ]; then
  echo "✓ Korean text confirmed ($koreanCharCount characters)"
else
  echo "❌ Insufficient Korean text ($koreanCharCount)"
fi

# 3.2.3: Required sections
echo -e "\n=== Required Sections ==="
sections=("요약" "핵심 지표" "스케일링" "이상 징후" "권고사항")
for section in "${sections[@]}"; do
  if echo "$report" | grep -q "$section"; then
    echo "✓ $section 포함"
  else
    echo "❌ $section 미포함"
  fi
done

# 3.2.5: Table format
echo -e "\n=== Table Format ==="
if echo "$report" | grep -E "\|.*\|.*\|" > /dev/null; then
  tableCount=$(echo "$report" | grep -c "^|")
  echo "✓ Table found ($tableCount rows)"
else
  echo "❌ No table"
fi

# 3.2.6: Anomaly analysis
echo -e "\n=== Anomaly Analysis ==="
if echo "$report" | grep -q "이상" || echo "$report" | grep -q "warning" || echo "$report" | grep -q "critical"; then
  echo "✓ Anomaly analysis found"
elif echo "$report" | grep -q "이상 없음"; then
  echo "✓ No anomalies noted"
else
  echo "⚠ Unclear anomaly status"
fi

# 3.2.7: Concrete recommendations
echo -e "\n=== Recommendations ==="
recCount=$(echo "$report" | grep -E "^-|^[0-9]\." | wc -l)
if [ "$recCount" -gt 0 ]; then
  echo "✓ Recommendations found ($recCount items)"
  # 첫 추천 출력
  echo "Sample recommendation:"
  echo "$report" | grep -E "^-|^[0-9]\." | head -1
else
  echo "❌ No recommendations"
fi

EOF

chmod +x validate_daily_report.sh
./validate_daily_report.sh
```

**Expected Output (예시):**
```
=== Markdown Format ===
✓ Main title found
✓ 5 main sections found

=== Korean Content ===
✓ Korean text confirmed (2340 characters)

=== Required Sections ===
✓ 요약 포함
✓ 핵심 지표 포함
✓ 스케일링 포함
✓ 이상 징후 포함
✓ 권고사항 포함

=== Table Format ===
✓ Table found (26 rows)

=== Anomaly Analysis ===
✓ Anomaly analysis found

=== Recommendations ===
✓ Recommendations found (4 items)
Sample recommendation:
- K8s CronJob을 설정하여 야간 시간대(22시-08시)에 1 vCPU로 자동 축소하세요.
```

---

### 테스트 3.3: 보고서 저장 및 조회

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 3.3.1 | 파일 저장 | 마크다운 파일이 data/reports에 저장 | YYYY-MM-DD.md 파일 생성 | 파일 없음 또는 위치 오류 |
| 3.3.2 | 파일 내용 | 저장된 파일 = API 응답의 reportContent | 1:1 일치 | 내용 불일치 |
| 3.3.3 | 중복 방지 | 동일 날짜 재생성 시 에러 (force 없음) | error 메시지 반환 | 파일 덮어쓰기 |
| 3.3.4 | force 옵션 | force=true 시 기존 파일 덮어쓰기 | 새 콘텐츠로 업데이트 | 파일 미변경 |
| 3.3.5 | 목록 조회 | GET ?list=true 응답 | 날짜 배열 역순 정렬 | 목록 없음 또는 오류 |
| 3.3.6 | 특정 조회 | GET ?date=YYYY-MM-DD 응답 | 해당 날짜 보고서 내용 | 404 또는 잘못된 내용 |
| 3.3.7 | 날짜 검증 | 잘못된 날짜 형식 | 400 에러 | 5xx 에러 또는 처리 안 됨 |

#### 테스트 절차

**케이스 3.3.1-2: 파일 저장 및 검증**

```bash
# Step 1: 보고서 생성
curl -X POST "http://localhost:3002/api/reports/daily" \
  -H "Content-Type: application/json" \
  -d '{}' > report_response.json

# Step 2: 응답에서 파일 경로 추출
filepath=$(jq -r '.reportPath' report_response.json)
apiContent=$(jq -r '.reportContent' report_response.json)

# Step 3: 파일 시스템 확인
if [ -f "$filepath" ]; then
  echo "✓ File exists: $filepath"

  # Step 4: 파일 내용 = API 응답 일치 확인
  fileContent=$(cat "$filepath" | sed '1,5d; $d')  # 헤더/푸터 제거
  apiContent=$(echo "$apiContent" | sed '1,5d; $d')

  if [ "$(echo "$apiContent" | md5sum)" = "$(echo "$fileContent" | md5sum)" ]; then
    echo "✓ File content matches API response"
  else
    echo "❌ File content mismatch"
  fi
else
  echo "❌ File not found: $filepath"
fi
```

**케이스 3.3.3-4: 중복 방지 및 force**

```bash
# Step 1: 첫 번째 보고서 생성
curl -X POST "http://localhost:3002/api/reports/daily" \
  -H "Content-Type: application/json" \
  -d '{}'
sleep 2

# Step 2: 동일 날짜 재생성 시도 (force 없음)
response=$(curl -s -X POST "http://localhost:3002/api/reports/daily" \
  -H "Content-Type: application/json" \
  -d '{}')

success=$(echo "$response" | jq '.success')
if [ "$success" = "false" ]; then
  echo "✓ Duplication prevented"
  echo "$response" | jq '.error'
else
  echo "❌ Duplication not prevented"
fi

# Step 3: force=true로 재생성
response2=$(curl -s -X POST "http://localhost:3002/api/reports/daily" \
  -H "Content-Type: application/json" \
  -d '{"force": true}')

if echo "$response2" | jq '.success' | grep -q "true"; then
  echo "✓ Force overwrite successful"
else
  echo "❌ Force overwrite failed"
fi
```

**케이스 3.3.5-7: 목록 및 조회**

```bash
# Step 1: 보고서 목록 조회
curl -s "http://localhost:3002/api/reports/daily?list=true" | jq '
{
  success: .success,
  reportCount: (.data.reports | length),
  dates: .data.reports
}'

# Expected:
# {
#   "success": true,
#   "reportCount": 1,
#   "dates": ["2026-02-09"]
# }

# Step 2: 특정 날짜 조회
today=$(date +%Y-%m-%d)
curl -s "http://localhost:3002/api/reports/daily?date=$today" | jq '{
  success: .success,
  date: .data.date,
  contentPreview: (.data.content | .[0:100])
}'

# Expected:
# {
#   "success": true,
#   "date": "2026-02-09",
#   "contentPreview": "---\ntitle: SentinAI 일일 운영 보고서\ndate: 2026-02-09..."
# }

# Step 3: 잘못된 날짜 형식
curl -s "http://localhost:3002/api/reports/daily?date=02-09-2026" | jq '.error'
# Expected: "Invalid date format"

curl -s -w "\n%{http_code}" "http://localhost:3002/api/reports/daily?date=02-09-2026"
# Expected: 400
```

---

### 테스트 3.4: 자동 스케줄링

#### 테스트 목표
cron이 매일 23:55에 자동으로 보고서를 생성하는지 검증

#### 테스트 항목

| # | 항목 | 테스트 내용 | 성공 기준 | 실패 기준 |
|---|------|----------|---------|---------|
| 3.4.1 | 스케줄러 초기화 | 서버 시작 시 cron job 등록 | getSchedulerStatus() = initialized:true | initialized:false |
| 3.4.2 | 5분 스냅샷 | 5분마다 자동 스냅샷 | 서버 log에 스냅샷 기록 | 로그 없음 |
| 3.4.3 | 23:55 실행 | 매일 23:55 KST에 보고서 생성 (수동 테스트 불가) | cron 정의 확인 | cron 설정 오류 |

#### 테스트 절차

**케이스 3.4.1: 스케줄러 상태 확인**

```bash
# Step 1: 서버 로그에서 초기화 메시지 확인
npm run dev 2>&1 | grep -i "scheduler\|cron"
# Expected: "[Scheduler] Initialized" 또는 유사 메시지

# Step 2: API로 상태 확인 (API 미구현 시 스킵)
curl -s "http://localhost:3002/api/reports/daily?status=true" | jq '
.data | {
  schedulerInitialized: .initialized,
  lastSnapshotTime: .lastSnapshotTime
}'
```

**케이스 3.4.2: 스냅샷 로그 확인**

```bash
# Step 1: 서버 시작
npm run dev > server.log 2>&1 &
server_pid=$!

# Step 2: 15분 운영
sleep 900

# Step 3: 스냅샷 기록 확인
grep "snapshot\|takeSnapshot" server.log | wc -l
# Expected: >= 3 (15분 / 5분 = 3회)

# Step 4: 서버 종료
kill $server_pid
```

**케이스 3.4.3: Cron 정의 확인**

```bash
# src/lib/scheduler.ts 파일에서 cron 정의 확인
grep -A 2 "schedule.*\*/5" src/lib/scheduler.ts
# Expected: cron.schedule('*/5 * * * *', ...)

grep -A 2 "schedule.*55 23" src/lib/scheduler.ts
# Expected: cron.schedule('55 23 * * *', ...)
```

---

## 통합 테스트 시나리오

### 시나리오 A: 일반 운영 흐름

```
0분: 서버 시작
     - Accumulator 초기화
     - Scheduler 등록 (5분 스냅샷, 23:55 보고서)
     - 대시보드 접속

5분: 첫 메트릭 수집 → 스냅샷 기록

10분: Cost Analysis 버튼 클릭
      - 사용 패턴 조회
      - AI 추천 생성
      - 히트맵 + 카드 표시

15분: 이상 생성 (rising scenario)
      - Layer 1: Z-Score 탐지
      - Layer 2: AI 분석 (30초)
      - Layer 3: 알림 발송
      - UI 배너 표시

30분: Slack 알림 확인 (설정되었을 경우)

45분: 일일 보고서 수동 조회
      - POST /api/reports/daily
      - 보고서 생성 확인
      - 파일 시스템 검증

23:55: 자동 보고서 생성 (실시간 확인 어려움, 로그로 검증)
```

### 시나리오 B: 엣지 케이스

```
- 서버 재시작: 축적기 데이터 소실, 새 날짜 구조 생성
- AI 게이트웨이 다운: Fallback 추천/분석 사용
- Webhook URL 오류: 대시보드 알림만 기록
- 4분 내 재호출: 스냅샷 중복 방지
```

---

## 버그 리포팅 템플릿

테스트 중 이슈 발견 시 다음 형식으로 리포팅해주세요:

```markdown
## 버그/이슈 리포트

### 제목
[기능] 발견된 문제 요약

### 기능
- [ ] Proposal 2: Anomaly Detection
- [ ] Proposal 4: Cost Optimizer
- [ ] Daily Report

### 심각도
- [ ] Critical (서비스 불가)
- [ ] High (기능 오류)
- [ ] Medium (부분 기능 오류)
- [ ] Low (UI/UX 개선)

### 재현 단계
1. ...
2. ...
3. ...

### 예상 동작
...

### 실제 동작
...

### 환경
- Node 버전: `node -v`
- npm 버전: `npm -v`
- 브라우저: (Chrome 버전)
- 서버 로그: (에러 로그)

### 첨부
- 스크린샷
- API 응답 JSON
- 브라우저 콘솔 에러
```

---

## 테스트 완료 체크리스트

테스트 완료 후 다음 항목을 확인하세요:

### Proposal 2: 이상 탐지
- [ ] Layer 1 탐지 (모든 4가지 규칙)
- [ ] Layer 2 AI 분석 (심각도, 유형, 조치)
- [ ] Layer 3 알림 (대시보드, Slack, 쿨다운)
- [ ] UI 배너 및 피드 표시
- [ ] API 응답 검증

### Proposal 4: 비용 최적화
- [ ] 데이터 수집 (7일 패턴)
- [ ] AI 추천 생성 (4가지 유형)
- [ ] 히트맵 렌더링 (7×24 그리드)
- [ ] 추천 카드 UI (3개 이하, 확장 가능)
- [ ] 한글 텍스트 및 구체성

### Daily Report
- [ ] 스냅샷 축적 (5분 간격, 24시간)
- [ ] 보고서 생성 (한글, 5개 섹션)
- [ ] 파일 저장 (data/reports/)
- [ ] 목록/조회 API
- [ ] 중복 방지 및 force 옵션
- [ ] 자동 스케줄링 (23:55, 5분)

### 통합 테스트
- [ ] 3가지 기능이 대시보드에서 함께 동작
- [ ] 각 기능 간 간섭 없음
- [ ] 엣지 케이스 처리 (재시작, API 실패)

---

**문서 작성일**: 2026-02-09
**최종 검토**: 아직 미실행
