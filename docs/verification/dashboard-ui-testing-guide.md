# SentinAI 대시보드 UI 테스트 가이드

브라우저에서 대시보드 UI를 수동/자동으로 검증하는 방법을 안내합니다.

---

## 1. 테스트 환경 준비

```bash
# dev 서버 시작
npm run dev

# 브라우저에서 접속
open http://localhost:3002
```

---

## 2. 수동 테스트 체크리스트

### 2.1 메인 대시보드

| # | 항목 | 확인 방법 | data-testid |
|---|------|----------|-------------|
| 1 | vCPU 표시 | 좌측 상단 현재 vCPU 값 (1/2/4) | `current-vcpu` |
| 2 | CPU 사용률 | 게이지 또는 숫자 표시 | `cpu-usage` |
| 3 | 블록 높이 | L1/L2 블록 번호 표시 | `block-height` |
| 4 | 컴포넌트 상태 | op-geth, op-node 등 4개 카드 | `component-*` |
| 5 | 비용 정보 | 월간 비용, 절감액 표시 | `cost-*` |
| 6 | 이상 탐지 배너 | spike 시나리오에서 노란/빨간 배너 | `anomaly-banner` |
| 7 | 이상 탐지 피드 | 이상 이벤트 목록 | `anomaly-feed` |

### 2.2 NLOps 채팅 UI

| # | 항목 | 확인 방법 | data-testid |
|---|------|----------|-------------|
| 1 | 토글 버튼 | 우하단 "SentinAI 어시스턴트" 버튼 | `chat-toggle` |
| 2 | 패널 열기/닫기 | 클릭으로 패널 토글 | `chat-panel`, `chat-close` |
| 3 | 환영 메시지 | 빈 상태에서 환영 텍스트 + 예시 버튼 | `chat-welcome` |
| 4 | 예시 버튼 | "현재 상태", "로그 분석 해줘", "비용 확인" | `chat-example-*` |
| 5 | 메시지 입력 | 텍스트 입력 + Enter 전송 | `chat-input` |
| 6 | 전송 버튼 | 빈 입력 시 비활성, 입력 시 활성 | `chat-send` |
| 7 | 사용자 메시지 | 우측 파란색 말풍선 | `chat-msg-user` |
| 8 | 어시스턴트 응답 | 좌측 흰색 말풍선 | `chat-msg-assistant` |
| 9 | 로딩 인디케이터 | 전송 후 점 3개 애니메이션 | `chat-loading` |
| 10 | 확인 바 | 스케일/설정 변경 시 노란 바 | `chat-confirmation` |
| 11 | 확인/취소 버튼 | 확인 바 내부 | `chat-confirm-btn`, `chat-cancel-btn` |

### 2.3 NLOps 시나리오별 테스트

```
시나리오 1: 상태 조회
  1. 채팅 열기 → "현재 상태" 예시 클릭
  2. 확인: 응답에 vCPU, CPU%, 컴포넌트 정보 포함

시나리오 2: 비용 조회
  1. "비용 확인" 입력 → 전송
  2. 확인: 월간 비용, 추천 포함

시나리오 3: 스케일링 (확인 플로우)
  1. "2 vCPU로 스케일해줘" 입력
  2. 확인: 확인 바 표시, 입력 비활성화
  3. "취소" 클릭 → 확인 바 사라짐, 입력 활성화
  4. 다시 "2 vCPU로 스케일해줘" → "확인" 클릭
  5. 확인: 스케일링 완료 응답

시나리오 4: 설정 변경
  1. "자동 스케일링 꺼줘" → 확인 바 → "확인"
  2. 확인: 설정 변경 응답
  3. "자동 스케일링 켜줘" → 확인 → 복원

시나리오 5: 대화 유지
  1. 여러 메시지 연속 전송
  2. 확인: 대화 이력 유지, 스크롤 자동 이동
```

---

## 3. API 통합 테스트 (Vitest)

브라우저 없이 NLOps 핵심 로직을 검증합니다. **추가 의존성 불필요.**

```bash
# NLOps 테스트만 실행
npx vitest run src/lib/__tests__/nlops-engine.test.ts

# 전체 테스트
npm run test:run
```

### 테스트 커버리지 (31개)

| 카테고리 | 테스트 수 | 내용 |
|---------|----------|------|
| `classifyIntent` | 10 | 7개 인텐트 분류, 유효성 검증, AI 실패 폴백, JSON 파싱 |
| `executeAction` | 12 | 쿼리 5종, 분석, 설명, RCA, 확인 플로우, 에러 처리 |
| `nlops-responder` | 9 | 정적 응답, 폴백, 후속 추천 |

---

## 4. curl 기반 API 테스트

dev 서버가 실행 중일 때 바로 사용 가능합니다.

```bash
BASE=http://localhost:3002

# 상태 확인
curl -s $BASE/api/nlops | jq

# 상태 조회
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "현재 상태 알려줘"}' | jq '{intent, executed}'

# 비용 조회
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "비용 확인해줘"}' | jq '{intent, executed}'

# 이상 현황
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "이상 현황 보여줘"}' | jq '{intent, executed}'

# 로그 분석
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "로그 분석 해줘"}' | jq '{intent, executed}'

# 스케일링 (확인 요청)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "2 vCPU로 스케일해줘"}' | jq '{intent, executed, needsConfirmation}'

# 스케일링 (확인 실행)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "2 vCPU로 스케일해줘", "confirmAction": true}' | jq '{intent, executed}'

# RCA
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "근본 원인 분석해줘"}' | jq '{intent, executed}'

# 설명
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "CPU가 뭐야?"}' | jq '{intent, executed}'

# Unknown
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "잘 모르겠는 명령어"}' | jq '{intent, executed}'

# 에러 케이스 (400)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": ""}' | jq
```

---

## 5. 이상 탐지 시나리오 테스트 (Seed API)

```bash
# spike 데이터 주입 → 이상 탐지 배너 확인
curl -X POST $BASE/api/metrics/seed?scenario=spike

# 브라우저에서 확인:
# - anomaly-banner 표시
# - anomaly-feed에 이벤트 목록

# 정상 복원
curl -X POST $BASE/api/metrics/seed?scenario=stable
```

---

## 6. 브라우저 자동화가 필요한 경우

향후 브라우저 레벨 자동 테스트가 필요해지면 다음 옵션을 고려하세요.

### 6.1 Vitest Browser Mode (권장)

기존 Vitest 설정에 브라우저 모드를 추가하는 가장 가벼운 방법입니다.

```bash
npm install -D @vitest/browser playwright  # ~300MB (Chromium 1개)
```

```ts
// vitest.config.ts 에 브라우저 프로젝트 추가
export default defineConfig({
  test: {
    // 기존 node 테스트는 유지
    include: ['src/**/*.test.ts'],
  },
  // 별도 workspace로 브라우저 테스트 분리 가능
});
```

장점: Vitest 통합, 기존 설정 재사용, 최소 의존성

### 6.2 Playwright (이전 사용)

풀스택 E2E 프레임워크가 필요한 경우입니다.

```bash
npm install -D @playwright/test  # + 브라우저 ~1GB
npx playwright install chromium
```

장점: 3개 브라우저, 강력한 디버깅, trace/video 캡처

### 6.3 Cypress

프론트엔드 팀에서 선호하는 대안입니다.

```bash
npm install -D cypress  # ~500MB
```

장점: 실시간 리로드, 직관적 UI, Time Travel 디버깅

---

## 7. data-testid 전체 목록

현재 대시보드에 설정된 테스트 ID입니다.

### 메인 대시보드

| testid | 위치 |
|--------|------|
| `current-vcpu` | vCPU 표시 |
| `cpu-usage` | CPU 사용률 |
| `block-height` | 블록 높이 |
| `anomaly-banner` | 이상 탐지 배너 |
| `anomaly-banner-title` | 배너 제목 |
| `anomaly-feed` | 이상 이벤트 피드 |

### NLOps 채팅

| testid | 위치 |
|--------|------|
| `chat-toggle` | 채팅 열기 버튼 |
| `chat-panel` | 채팅 패널 전체 |
| `chat-close` | 닫기 버튼 |
| `chat-welcome` | 환영 메시지 영역 |
| `chat-messages` | 메시지 목록 컨테이너 |
| `chat-example-{text}` | 예시 버튼 (현재 상태, 로그 분석 해줘, 비용 확인) |
| `chat-msg-user` | 사용자 메시지 |
| `chat-msg-assistant` | 어시스턴트 메시지 |
| `chat-loading` | 로딩 인디케이터 |
| `chat-confirmation` | 확인 바 |
| `chat-confirmation-msg` | 확인 메시지 텍스트 |
| `chat-confirm-btn` | 확인 버튼 |
| `chat-cancel-btn` | 취소 버튼 |
| `chat-input` | 메시지 입력 필드 |
| `chat-send` | 전송 버튼 |
