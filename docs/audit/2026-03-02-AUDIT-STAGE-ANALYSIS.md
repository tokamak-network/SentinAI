# SentinAI 종합 감사 - Stage별 상세 분석
**분석 대상**: Autonomous Operational AI Agent for EVM Clients (Self-Hosted)
**분석 방법론**: Data Flow Tracing (5단계 파이프라인)
**평가 기준**: 운영성(Operability) × 성능(Performance)

---

## 📋 Contents
1. **Stage 1: Observation Layer** — 메트릭 수집 (RPC, K8s)
2. **Stage 2: Detection Layer** — 이상 탐지 및 분석
3. **Stage 3: Decision Layer** — RCA 및 스케일링 의사결정
4. **Stage 4: Action Layer** — K8s 실행 및 자동 복구
5. **Stage 5: Communication Layer** — 알림 및 리포트

---

# Stage 1: Observation Layer 📊

## 1️⃣ 응답 지연 분석

### 현재 상태
- **K8s 폴링**: 병렬 처리로 평균 50-200ms
  - `componentPromises` via Promise.all() (route.ts:469-494)
  - 메트릭 서버 + kubelet fallback 병렬 처리

- **RPC 호출**: 평균 100-500ms
  - L1 캐싱: 6초 TTL → 95% 호출 감소 (l1-rpc-cache.ts)
  - L2 병렬 호출: 4개 동시 (getBlock, L1BlockNumber, derivationLag, status)
  - 타임아웃: RPC_TIMEOUT_MS=15초 (하드코딩)

- **E2E 지연**: 로그에만 기록, API 응답본문에 미포함

### 병목
- **RPC_TIMEOUT_MS=15초 블로킹**: txpool_status 실패 시 최대 15초 대기
- **K8s 명령어 동기식**: 각 pod당 최대 2개 kubectl 호출
- **폴링 주기 불명시**: 1s 고정인지 확인 불가

### 개선 아이디어
- RPC 타임아웃 단계적 감소 (15s → 10s 기본, 환경변수로 조정 가능)
- K8s pod 정보 5-10초 캐싱 (NodeInfo는 자주 변경 X)
- E2E 지연을 응답 헤더 포함 (`X-Response-Time-Ms`)

### 📊 성능 점수: 71/100
✅ 병렬 처리 적극 활용
✅ L1 캐싱 95% 호출 감소
❌ 15초 timeout이 전체 응답 블로킹
❌ K8s pod 정보 매 요청 폴링

---

## 2️⃣ 리소스 효율

### 비효율 지점

| 항목 | 파일:라인 | 영향 |
|------|---------|------|
| **eoaBalances 무제한 증가** | l1-rpc-cache.ts:36, 123 | 메모리 누수 (주소 수 무제한) |
| **K8s pod 매 요청 폴링** | route.ts:196-244 | 네트워크 I/O 과다 |
| **컴포넌트 필드 중복 저장** | route.ts:292-296 | 응답 크기 ~+20% |
| **ZK Stack 메서드 모두 호출** | evm-execution.ts:100-103 | RPC 요청 spike |

### 개선 방안
- L1 캐시: MaxSize 제한 (100개 주소)
- K8s pod: 5-10초 메모리 캐시 추가
- ZK Stack: 메서드 선택적 호출 (환경변수)

### 📊 운영성 점수: 62/100
✅ 기본 폴백 메커니즘 완비
❌ 설정 조정 불가 (하드코딩)
❌ Prometheus metrics 없음

---

## 3️⃣ 에러 처리

### 커버되는 시나리오 ✅
- RPC 타임아웃 → AbortController
- L1 실패 → L1 캐시 사용
- K8s 실패 → 빈 components[] 반환
- txpool_status 미지원 → block.transactions.length fallback

### 미흡한 부분 ❌
- RPC 재시도 없음 (1회만 시도)
- 타임아웃 vs 연결 실패 구분 없음
- K8s 에러 상세정보 부족
- EOA balance 부분 실패 감지 불가

---

## 4️⃣ 로깅 및 추적성
- Timer 로그만 있고 응답 타임스탠프 없음
- 캐시 hit/miss 로깅 과다 (30초에 수천 줄)
- Request ID/Trace ID 없음

### 권장사항
- Trace ID 추가 (모든 로그에 동일 ID)
- Timer를 JSON 형식으로 변경 (파싱 용이)
- L1 캐시 hit/miss를 debug 레벨로 강등

---

## 5️⃣ 모니터링 준비도
- ❌ Prometheus metrics 노출 없음
- ✅ 실시간 데이터: GET /api/metrics
- ❌ 히스토리 조회 API 없음

### 개선
- Prometheus 라이브러리 추가
- GET /metrics 엔드포인트
- GET /api/metrics/history?duration=1h

---

## 6️⃣ 자동 복구 능력
- ✅ L1 RPC Failover (별도 구현)
- ✅ 캐시 폴백
- ❌ 재시도 없음 (1회만 시도)
- ❌ Circuit breaker 없음
- ❌ Health check endpoint 없음

---

## 7️⃣ 설정/튜닝 용이성

### 하드코딩된 값
| 값 | 파일:라인 | 권장 |
|----|---------|------|
| 15000ms | route.ts:31 | Env: RPC_TIMEOUT_MS |
| 5000ms | route.ts:32 | Env: STATUS_PROBE_TIMEOUT_MS |
| 6000ms | l1-rpc-cache.ts:20 | Env: L1_CACHE_TTL_MS |
| 300000ms | l1-rpc-cache.ts:23 | Env: EOA_CACHE_TTL_MS |

### 📊 운영성 점수: 62/100

---

---

# Stage 2: Detection Layer 🔍

## 1️⃣ 응답 지연 분석

### 현재 상태
- **Layer 1 (Statistical)**: 동기, <5ms
  - Z-Score 계산, 규칙 기반 감지

- **Layer 2 (AI)**: 비동기, 1-2초
  - AI 호출 60초 레이트 제한
  - 분석 캐시 5분 TTL

- **Layer 3 (Alert)**: 비동기, 500ms-2s (Webhook 포함)

### 병목
- 응답 시간 계측 없음
- AI 호출 전후 기록 미흡
- Detection Pipeline 전체 경과 시간 미추적

### 📊 성능 점수: 72/100
✅ 3단계 필터링으로 오탐율 낮춤
✅ 비동기 처리로 블로킹 최소화
❌ 응답 시간 추적 불가능

---

## 2️⃣ 리소스 효율

### 비효율 지점
- 메트릭 버퍼 전체 순회: O(60) 매번
- 이벤트 스토어 O(n) 조회
- AI 응답 파싱 오버헤드
- Alert 쿨다운 중복 조회

### 📊 운영성 점수: 68/100
✅ 감지 근거 명확
❌ 추적 ID 없음
❌ 타이밍 로깅 부재

---

## 3️⃣ 에러 처리
- ✅ AI 응답 파싱 실패 처리
- ✅ Webhook 전송 실패 처리
- ❌ Detection Pipeline 비동기 에러 처리 미흡
- ❌ Log ingester 실패 처리 없음

---

---

# Stage 3: Decision Layer 🎯

## 1️⃣ 응답 지연 분석

### 현재 상태
- **RCA Engine**: 최대 30초 timeout + 2회 재시도 (총 ~70초)
- **Predictive Scaler**: 5분 cooldown, ~1.8초 AI 호출
- **Scaling Decision**: 순수 메트릭 계산 (<5ms)

### 병목
- RCA 직렬 처리 (Timeline → AI → Fallback)
- Predictive 데이터 준비 (메트릭 통계 O(n))
- Agent Loop에서 직렬 호출

### 📊 성능 점수: 68/100
✅ Scaling decision 계산 빠름
⚠️ RCA timeout 30초 (장시간 블로킹)
❌ 시스템 프롬프트 매번 재생성

---

## 2️⃣ 리소스 효율
- AI 호출 빈도: 시간당 ~12회 (Predictive)
- RCA history: 20개 항목 (in-memory)
- 예측 캐시: 1개 최신 항목

### 비효율 지점
- 사용자 프롬프트 매번 구축
- 시스템 프롬프트 매번 호출 (캐싱 없음)
- 메트릭 통계 O(n) 매번
- RCA history in-memory (손실 위험)

### 📊 운영성 점수: 72/100
✅ 의사결정 로깅 및 추적 (DecisionTrace)
❌ Scaling decision 로깅 미흡
❌ 설정 hardcoding 다수

---

## 3️⃣ 에러 처리
- ✅ RCA AI 실패 시 Fallback
- ✅ Predictive 실패 후 rule-based fallback
- ❌ RCA history 손실 위험 (in-memory)
- ❌ Scaling 실패 시 재시도 없음

---

---

# Stage 4: Action Layer ⚙️

## 1️⃣ 응답 지연 분석

### 현재 상태
- **kubectl 실행**: 5~30초 (타임아웃 범위)
- **Zero-Downtime 전환**: ~2분 30초 (최악 6분+)
  - Phase 1: 30초 (Standby Pod 생성)
  - Phase 2: 최대 5분 (Ready 폴링, 10초 간격)
  - Phase 3: 20초 (트래픽 전환)
  - Phase 4: 2분 (정리 + 삭제 대기)
  - Phase 5: 30초 (StatefulSet 동기화)

### 병목 🔴
- **Phase 2 폴링**: 300초 timeout, 10초 간격 = 30회 반복
  - 폴링 실패 시 최대 450초
  - RPC 체크 매번 15초

- **K8s API 호출**: 최대 96회 (Phase 2만 30회 폴링 × 3 kubectl)

### 📊 성능 점수: 58/100
✅ 일반 스케일링: 5~20초
❌ Zero-downtime: 최악 6분
❌ K8s API 효율: 96회 호출
❌ 네트워크 재시도: 없음

---

## 2️⃣ 리소스 효율
- 최악의 K8s API 호출: 96회/작업
- Ready 폴링: 30회 (매번 3개 kubectl)
- 메모리: 제로 오버헤드 (싱글톤)

### 비효율 지점
- `waitForReady()`: 매번 3개 kubectl (ready + IP + RPC)
- 폴링 간격 고정 10초 (동적 조정 불가)
- RPC 체크 타임아웃 15초 (공격적이지 않음)

### 📊 운영성 점수: 62/100
✅ 기본 기능 완성 (scaling, remediation)
❌ 설정 튜닝 어려움 (많은 hardcoded 값)
❌ 부분 실패 복구 미흡

---

## 3️⃣ 에러 처리
✅ **구현**:
- Phase 2 실패 → rollback
- kubectl 실패 → try-catch + rollback
- Cooldown 중 → 에러 반환

❌ **미구현**:
- Network timeout 재시도 없음
- Standby Pod 생성 실패 후 재시도 없음
- Traffic switch 부분 실패 시 롤백 불가능
- K8s API 429 (Rate Limit) 처리 없음

---

## 4️⃣ 로깅 및 추적성
- Phase 타이밍 기록 있음 (메모리)
- 상태 불일치 감지 불가
- Standby Pod 생성 시간 미기록
- Ready 폴링 시도 횟수 미기록

---

---

# Stage 5: Communication Layer 💬

## 1️⃣ 응답 지연 분석

### 현재 상태
- **Alert 전송**: 500ms ~ 3초 (webhook latency)
- **Report 생성**: 8초 (Best Tier AI)
- **NLOps 응답**: 최대 8.6초
  - Tool planning: 1.8초
  - Tool execution: 최대 5초 (순차)
  - Response generation: 1.8초

### 병목
- Tool 순차 실행 (병렬화 안됨)
- Webhook 타임아웃 없음 (무한 대기 가능)
- 3개 AI 호출 반복

### 📊 성능 점수: 55/100
❌ NLOps 8.6초 (병렬화로 50% 개선 가능)
❌ Webhook 타임아웃 없음
❌ API 호출 최대 9개 순차

---

## 2️⃣ 리소스 효율
- Alert 배치 처리 없음
- NLOps tool: 최대 9개 API 호출 (순차)
- 불필요한 중복 호출 (get_system_status + get_metrics)

### 📊 운영성 점수: 62/100
✅ Alert 설정 조정 가능
❌ 재시도 정책 전무
❌ Tool 선택적 비활성화 불가

---

## 3️⃣ 에러 처리
- ✅ Slack/webhook 전송 실패 처리
- ✅ AI 응답 오류 fallback
- ❌ 재시도 없음 (1회만 시도)
- ❌ Dead Letter Queue 없음
- ❌ 타임아웃 관리 없음

---

## 4️⃣ 로깅 및 추적성
- ✅ Alert 전송 결과 로깅
- ✅ Report 생성 로그
- ⚠️ Tool execution 부분 로그
- ❌ Webhook 응답 코드 미기록

---

---

## 📊 종합 점수 (All Stages)

| Stage | 운영성 | 성능 | 종합 |
|-------|--------|------|------|
| 1 | 62 | 71 | 66 |
| 2 | 68 | 72 | 70 |
| 3 | 72 | 68 | 70 |
| 4 | 62 | 58 | 60 |
| 5 | 62 | 55 | 58 |
| **평균** | **65** | **65** | **65** |

---

## 🎯 각 Stage의 P1 개선 항목

### Stage 1
1. 타임아웃을 환경변수로 변경
2. K8s pod 정보 5-10초 캐싱
3. 에러 타입 명시적 구분

### Stage 2
1. 응답 시간 계측 추가
2. Trace ID 도입
3. 하드코딩된 threshold 환경변수화

### Stage 3
1. Scaling Decision 로깅 강화
2. 설정 Externalize (가중치, RCA timeout 등)
3. RCA/Prediction History 영속화

### Stage 4
1. Zero-Downtime Phase 2 최적화 (폴링 지수백오프)
2. K8s API 호출 최적화 (96회 → 30회)
3. 설정 체계화 및 모니터링 추가

### Stage 5
1. Webhook 타임아웃 추가 + 재시도
2. NLOps tool 병렬 실행
3. Alert dispatch 배경화 (async queue)

---

**상세 개선 사항은 별도 문서 참조: `2026-03-02-AUDIT-IMPROVEMENT-ROADMAP.md`**
