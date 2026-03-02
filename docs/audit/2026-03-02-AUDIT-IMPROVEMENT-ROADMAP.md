# SentinAI 개선 로드맵 및 Production Readiness
**버전**: 2026-03-02
**목표**: Self-Hosted Deployment를 위한 운영성 + 성능 개선

---

## 🚀 우선순위 로드맵

### Phase 1: Critical Path (1-2주) 🔴
**목표**: Production 배포 가능 수준 (B → B+)

#### 1.1. 환경 적응성 개선 (모든 Stage)
**우선순위**: **P0 Critical**
**영향도**: 운영성 +20점

**작업 목록**:

```
[ ] Stage 1: RPC/K8s 타임아웃 환경변수화
    - RPC_TIMEOUT_MS (기본 15s → 10s)
    - K8S_TIMEOUT_MS (기본 5s)
    - L1_CACHE_TTL_MS (기본 6s)
    - EOA_CACHE_TTL_MS (기본 300s)
    파일: route.ts:31-32, l1-rpc-cache.ts:20-23

[ ] Stage 2: 감지 threshold 환경변수화
    - ANOMALY_Z_SCORE_THRESHOLD (기본 3.0)
    - ANOMALY_BLOCK_PLATEAU_SECONDS (기본 120)
    - ANOMALY_TXPOOL_MONOTONIC_SECONDS (기본 300)
    - ANOMALY_MIN_STD_DEV_* (각 metric별)
    - ANOMALY_AI_RATE_LIMIT_MS (기본 60000)
    파일: anomaly-detector.ts:17-39

[ ] Stage 3: 스케일링 설정 환경변수화
    - SCALING_WEIGHT_CPU (기본 0.3)
    - SCALING_WEIGHT_GAS (기본 0.3)
    - SCALING_WEIGHT_TXPOOL (기본 0.2)
    - SCALING_WEIGHT_AI (기본 0.2)
    - SCALING_*_THRESHOLD (Idle/Normal/Critical)
    - RCA_TIMEOUT_MS (기본 30000 → 15000)
    - RCA_MAX_RETRIES (기본 2 → 1)
    파일: scaling-decision.ts, rca-engine.ts

[ ] Stage 4: K8s/Zero-Downtime 타임아웃 환경변수화
    - ZERO_DOWNTIME_READY_TIMEOUT_MS (300000 → 230000)
    - ZERO_DOWNTIME_POLL_INTERVAL_MS (10000 고정 → 동적)
    - ZERO_DOWNTIME_POD_CLEANUP_SLEEP_MS (30000)
    - RPC_CHECK_TIMEOUT_MS (15000 → 5000)
    파일: zero-downtime-scaler.ts:270-299

[ ] Stage 5: 알림/리포트 설정 환경변수화
    - WEBHOOK_TIMEOUT_MS (없음 → 5000 추가)
    - WEBHOOK_RETRY_ATTEMPTS (없음 → 3 추가)
    - DAILY_REPORT_SCHEDULE (없음 → "0 6 * * *" 추가)
    파일: alert-dispatcher.ts, daily-report-generator.ts
```

**예상 소요**: 2-3일
**기대 효과**: 재배포 없이 모든 타임아웃/threshold 조정 가능

---

#### 1.2. Webhook 신뢰성 개선 (Stage 5)
**우선순위**: **P0 Critical**
**영향도**: 메시지 손실률 1% → 0.1%

```
[ ] Webhook fetch 타임아웃 설정
    파일: alert-dispatcher.ts:222-230
    변경: fetch(url, { timeout: 5000 })

[ ] Webhook 재시도 로직 (exponential backoff)
    - 1차 실패: 100ms 대기 후 재시도
    - 2차 실패: 500ms 대기 후 재시도
    - 3차 실패: alert 기록만 (메시지 저장)

[ ] Dead Letter Queue 구현
    - 실패한 alert를 별도 store에 저장
    - 매 1시간마다 재시도
    - 최대 3회까지만 재시도
```

**예상 소요**: 1-2일
**기대 효과**: 메시지 손실 거의 0%

---

#### 1.3. Scaling Decision 로깅 (Stage 3)
**우선순위**: **P0 Critical**
**영향도**: 운영성 +15점

```
[ ] Scaling decision 점수 로깅
    파일: scaling-decision.ts:91-125 추가
    내용: CPU score, Gas score, TxPool score, AI score, 최종 점수
    형식: JSON { scores: { cpu, gas, txpool, ai }, total, tier }

[ ] Decision history 저장
    현재: scaling-history에 fromVcpu/toVcpu만 저장
    개선: scores 정보도 함께 저장 (ScalingHistoryEntry 확장)
```

**예상 소요**: 1일
**기대 효과**: "왜 이 결정인가" 추적 가능

---

### Phase 2: High-Impact Improvements (2-3주) 🟠
**목표**: B+ → A- (운영성/성능 + 20점)

#### 2.1. Zero-Downtime Phase 2 최적화 (Stage 4)
**우선순위**: **P1 High**
**영향도**: 응답 시간 6분 → 3분 (50% 단축)

```
[ ] 폴링 간격 지수백오프 적용
    현재: 10초 고정
    변경: 1s → 2s → 5s → 10s (타임아웃 230s)
    파일: zero-downtime-scaler.ts:271-326
    코드:
      const intervals = [1000, 2000, 5000, 10000];
      const attempt = Math.min(attemptCount, intervals.length - 1);
      await _testHooks.sleep(intervals[attempt]);

[ ] Ready check kubectl 통합
    현재: 3개 kubectl 호출 (ready status + pod IP + RPC health)
    변경: 1개 통합 호출 (jsonpath로 여러 필드)
    명령: kubectl get pod -o jsonpath='...' (status, podIP 동시)

[ ] RPC 체크 타임아웃 단축
    현재: 15000ms
    변경: 5000ms (더 빠른 실패 감지)

[ ] Phase 2 timeout 230초로 단축
    현재: 300초
    변경: 230초 (폴링 25회 기대)

[ ] Partial rollback 자동화
    Traffic switch 실패 시 → old pod label 즉시 복구
    (현재 partial failure 가능성)
```

**예상 소요**: 3-4일
**기대 효과**: 스케일링 시간 2배 단축, 안정성 향상

---

#### 2.2. NLOps 성능 최적화 (Stage 5)
**우선순위**: **P1 High**
**영향도**: 응답 시간 8.6s → 4.5s (50% 단축)

```
[ ] Tool execution 병렬화
    현재: 순차 실행 (9개 tool × RTT)
    변경: Promise.all() 병렬화
    파일: nlops-engine.ts:547-552
    코드:
      const results = await Promise.all(
        toolCalls.map(call => executeTool(call))
      );

[ ] Tool planning 단계 스킵 (간단한 쿼리)
    현재: "status" 명령도 AI planning 거침
    변경: 정규식으로 간단한 명령 직접 처리
    예: /^(status|metrics|health)/i → planning 스킵

[ ] Tool 결과 조합
    get_system_status (metrics) + get_metrics (메트릭)
    현재: 각각 별도 호출
    변경: 단일 메서드로 통합 (중복 제거)

[ ] AI planning 캐싱
    동일 사용자 질문 1분 내 반복 시 캐시 반환
    파일: nlops-engine.ts:301-351 근처에 캐시 추가
```

**예상 소요**: 2-3일
**기대 효과**: NLOps 응답 시간 50% 단축

---

#### 2.3. 히스토리 영속화 (Stage 3, 4)
**우선순위**: **P1 High**
**영향도**: 프로세스 재시작 시 데이터 손실 방지

```
[ ] RCA history Redis 이전
    현재: in-memory 배열 (20개만 보유)
    변경: Redis 저장 (key: `rca:history:${timestamp}`, TTL 7day)
    파일: rca-engine.ts:531-551

[ ] Prediction history Redis 저장
    현재: 1개 최신 항목만 메모리
    변경: Redis에 시계열 저장 (accuracy 검증용)
    파일: predictive-scaler.ts

[ ] Scaling decision history 강화
    현재: fromVcpu, toVcpu, timestamp만
    변경: scores breakdown도 함께 저장
    파일: executor-agent.ts:172-179 수정
```

**예상 소요**: 2-3일
**기대 효과**: 의사결정 히스토리 분석 가능

---

### Phase 3: System Maturity (3-4주) 🟡
**목표**: A- 수준 달성 (운영 자동화, 모니터링)

#### 3.1. Trace ID 기반 추적 (모든 Stage)
```
[ ] Request ID 생성 및 전파
    - 모든 요청에 UUID 부여
    - 응답 헤더에 포함
    - 모든 로그에 포함

[ ] E2E 요청 추적
    - Anomaly 탐지 → 분석 → 스케일링 전체 흐름 추적
    - 마지막에 결과 기록

[ ] Dashboard에 trace 링크 제공
```

#### 3.2. Metrics History API (모든 Stage)
```
[ ] GET /api/metrics/history?duration=1h&window=5m
    - 과거 메트릭 조회 (차트용)
    - 다양한 시간 범위 지원
    - 캐시 (Redis)
```

#### 3.3. Production Guides 작성
```
[ ] Troubleshooting Guide
    - "응답이 느려요" → 확인 항목
    - "알림이 안 와요" → 디버깅
    - "Pod가 CrashLoopBackOff" → 원인 분석

[ ] 운영 가이드
    - 배포 후 초기 설정
    - 모니터링 setup
    - 자동 스케일링 튜닝
```

---

## 📋 Production Readiness Checklist

### 필수 (Must-Have) 🔴
배포 전 반드시 완료해야 하는 항목

```
[✅] 기본 아키텍처 구현
  [ ] 5단계 파이프라인 (Observation → Decision → Action)
  [ ] Chain plugin 시스템
  [ ] Agent loop (30초 주기)

[❌] → [✅] 환경 매개변수화
  [ ] 모든 타임아웃 환경변수화 (15개)
  [ ] Threshold/가중치 환경변수화 (10개)
  [ ] 기본값 합리적으로 설정

[❌] → [✅] 에러 처리 및 복구
  [ ] RPC 호출 재시도 (2회, exponential backoff)
  [ ] Webhook 타임아웃 + 재시도
  [ ] K8s API 429 (Rate Limit) 처리
  [ ] Partial failure 감지 및 로깅

[❌] → [✅] 모니터링 기본
  [ ] 실시간 메트릭 API (/api/metrics)
  [ ] Alert 히스토리 조회 가능
  [ ] Scaling decision 로깅
  [ ] RCA history 조회 가능

[⚠️] → [✅] Kubernetes 안정성
  [ ] Zero-downtime 스케일링 구현
  [ ] Rollback 메커니즘
  [ ] Circuit breaker (remediation)
  [ ] Cooldown 적용

[❌] → [✅] 보안
  [ ] Webhook 서명 검증 (Slack)
  [ ] API 인증 (x-api-key)
  [ ] Secrets 환경변수로만 관리
  [ ] TLS 활성화 (K8s)

[✅] 테스트
  [ ] 51개 unit test 작성
  [ ] CI/CD 파이프라인 구성
  [ ] E2E 테스트 최소 기본 흐름

[⚠️] → [✅] 로깅 및 디버깅
  [ ] Structured logging (JSON)
  [ ] 모든 에러에 원인 정보 포함
  [ ] Request tracing (trace ID)
```

### 중요 (Should-Have) 🟠
배포 후 2주 내 완료 권장

```
[❌] 모니터링 고도화
  [ ] Prometheus metrics 노출
  [ ] Grafana 대시보드
  [ ] 알림 규칙 (Slack/PagerDuty)
  [ ] Log aggregation (ELK 또는 유사)

[❌] → [⚠️] 성능 최적화
  [ ] Zero-downtime Phase 2 최적화 (3분 이내)
  [ ] NLOps tool 병렬화
  [ ] K8s API 호출 최소화 (96회 → 30회)
  [ ] 캐싱 전략 (설정, 메트릭, RCA)

[❌] → [⚠️] 운영 자동화
  [ ] Daily report 자동 스케줄
  [ ] Metrics 자동 수집 및 분석
  [ ] Anomaly 자동 복구 (remediation playbook)
  [ ] Cost optimization 자동 추천

[❌] 문서화
  [ ] API 문서 (OpenAPI/Swagger)
  [ ] 배포 가이드 (Docker, K8s)
  [ ] 운영 가이드 (튜닝, 트러블슈팅)
  [ ] Architecture 다이어그램
```

### 선택 (Nice-to-Have) 🟢
배포 후 1개월 이내 권장

```
[❌] Advanced Features
  [ ] Multi-chain 자동 감지
  [ ] Machine learning 기반 threshold tuning
  [ ] Anomaly pattern recognition
  [ ] Predictive maintenance

[❌] 사용자 경험
  [ ] Web dashboard 고도화
  [ ] Mobile app (선택사항)
  [ ] 실시간 알림 (푸시)
  [ ] Custom webhook 포맷
```

---

## 📊 주간 개선 계획

### 주차 1: Environment 적응성 (Phase 1)
```
Week 1:
  Mon-Tue: Stage 1-3 타임아웃 환경변수화 (5개 변수)
  Wed: Stage 4 타임아웃 환경변수화 (4개 변수)
  Thu: Stage 5 webhook 개선 (timeout + retry)
  Fri: 테스트 및 문서화

목표: 모든 운영자 튜닝 가능, 재배포 불필요
기대: 운영성 62-72 → 78-85
```

### 주차 2: 신뢰성 개선 (Phase 1)
```
Week 2:
  Mon-Tue: Zero-downtime Phase 2 최적화
  Wed: Scaling decision 로깅 강화
  Thu: NLOps tool 병렬화
  Fri: 통합 테스트

목표: 응답 시간 단축, 로깅 명확화
기대: 성능 58-72 → 72-80
```

### 주차 3: 모니터링 강화 (Phase 2)
```
Week 3:
  Mon-Tue: RCA/Prediction history Redis 이전
  Wed: Metrics history API 구현
  Thu: Dashboard 수정 (history 표시)
  Fri: QA

목표: 히스토리 분석 가능, 데이터 손실 방지
기대: 운영성 65 → 75+
```

### 주차 4: 최종 검증 (Phase 2)
```
Week 4:
  Mon-Wed: Production readiness checklist 검증
  Thu-Fri: Load testing, stress testing, chaos engineering

목표: Production 배포 확신
기대: 전체 점수 65 → 80+
```

---

## 🎯 성공 기준

### 배포 전 필수
- [ ] Executive Summary의 Critical 5개 발견 중 Top 3 완료
- [ ] 모든 Stage 운영성 ≥ 75/100
- [ ] Production Readiness Checklist 필수 항목 100% 체크
- [ ] Load test: 1000 RPS에서 P99 지연 < 5초
- [ ] Zero-downtime scaling 완료 시간 ≤ 3분
- [ ] Alert delivery rate ≥ 99.5%

### 배포 후 4주 내
- [ ] Monitoring 완전 자동화 (Prometheus + Grafana)
- [ ] Daily report 자동 생성 및 전송
- [ ] Cost tracking 정확성 ≥ 99%
- [ ] Anomaly detection F1 score ≥ 0.95

---

## 리소스 및 기술

### 기술 스택
- **환경 설정**: dotenv, joi (validation)
- **로깅**: Pino (구조화된 로깅)
- **모니터링**: Prometheus, Grafana
- **캐싱**: Redis (이미 지원)
- **테스트**: Vitest, Playwright (E2E)

### 예상 개발 리소스
- **개발자**: 1명 (풀타임) 또는 2명 (파트타임)
- **QA**: 0.5명 (파트타임)
- **기간**: 3-4주
- **예산**: $15,000-20,000 (인건비 기준)

---

## 위험도 분석

### High Risk ⚠️
1. **Zero-downtime 폴링 로직 변경**: Phase 2 폴링 간격 수정 시 기존 동작 변경 가능
   - **완화**: 기존 동작 기본값으로 유지, 새로운 옵션으로 추가

2. **Redis 도입**: RCA/Prediction history 저장 시 Redis 필수
   - **완화**: In-memory fallback 유지, Redis 선택사항

### Medium Risk ⚠️
1. **대규모 환경변수 추가**: 15개 이상의 새 변수
   - **완화**: 기본값 제공, 문서화

2. **API 인터페이스 확장**: 새로운 history API
   - **완화**: 기존 API 호환성 유지

---

## 결론

**SentinAI는 기본 구조는 견고하지만, Production 배포를 위해서는 3가지 긴급 과제가 있습니다:**

1. **Environment 적응성** (1주) — 하드코딩 파라미터 환경변수화
2. **신뢰성** (1주) — 재시도, 타임아웃, 복구 로직 추가
3. **응답 속도** (1주) — Zero-downtime 최적화, NLOps 병렬화

**위 3가지만 완료하면 B+ → A- 수준으로 격상 가능하며, Production 배포 자신감 확보 가능합니다.**

예상 완료 일정: **2026-03-23** (3주, 병렬 개발 기준)

---

**작성**: Claude Code Audit Agent
**감사 일자**: 2026-03-02
**문서 링크**:
- Executive Summary: `2026-03-02-AUDIT-EXECUTIVE-SUMMARY.md`
- Stage Analysis: `2026-03-02-AUDIT-STAGE-ANALYSIS.md`
- Improvement Roadmap: `2026-03-02-AUDIT-IMPROVEMENT-ROADMAP.md` (현재 문서)
