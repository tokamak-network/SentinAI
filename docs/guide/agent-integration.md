# Agent Integration Guide

SentinAI에는 두 가지 독립적인 AI 에이전트 통합 방식이 있습니다.

| | Option A — NLOps Agent SDK | Option B — Claude Code Subagents |
|---|---|---|
| 실행 환경 | **프로덕션 런타임** (서버 상주) | **개발자 세션** (Claude Code CLI) |
| 트리거 | NLOps 챗 POST `/api/nlops` | 개발자가 Claude Code에서 직접 호출 |
| 목적 | 더 정교한 RCA/운영 분석 | 코드 생성, 문서 작성, 코드 리뷰 보조 |
| 켜는 방법 | `.env.local`에 플래그 추가 | Claude Code CLI에서 `@agent-name` 호출 |

---

## Option A — NLOps Agent SDK (Runtime)

### 개요

기존 NLOps는 2-call 방식입니다:
1. LLM에게 "어떤 툴을 쓸지" 계획 수립 요청 → 병렬 실행 → 결과 정리

Option A는 **진짜 에이전트 루프**입니다:
1. LLM이 툴 하나 선택 → 실행 → 결과 확인 → 다음 툴 선택 → (반복, 최대 5라운드) → 최종 답변

LLM이 이전 툴 결과를 보고 다음 단계를 결정하므로, 복잡한 RCA나 다단계 진단에서 더 정확한 분석이 가능합니다.

### 전제 조건

- `ANTHROPIC_API_KEY` — Anthropic API 키 필수 (다른 provider로 대체 불가)
- SentinAI가 Docker 또는 `npm run dev`로 실행 중

### 활성화

`.env.local`에 다음 항목을 추가합니다:

```bash
# NLOps Agent SDK 활성화
USE_AGENT_SDK=true

# 사용할 모델 (기본값: claude-sonnet-4-6)
AGENT_SDK_MODEL=claude-sonnet-4-6

# 툴 호출 트레이스 저장 (디버깅용, 기본값: false)
AGENT_SDK_TRACE=false
```

서버를 재시작합니다:

```bash
npm run dev
# 또는 Docker 환경
docker compose up --build
```

### 동작 확인

대시보드(기본 `http://localhost:3002`)의 NLOps 챗에서 복잡한 질문을 입력합니다:

```
L2 블록 생산이 느려진 원인이 뭐야?
```

Option A가 활성화되면 LLM이 `getMetrics` → `getRcaHistory` → `getScalingState` 순으로 필요한 툴만 선택적으로 호출합니다. 기존 방식보다 더 구체적인 분석 결과를 반환합니다.

### 트레이스 확인 (선택)

`AGENT_SDK_TRACE=true`로 설정하면 각 에이전트 호출에서 어떤 툴을 몇 번 호출했는지 서버 로그에 기록됩니다:

```
[NLOps Agent] Round 1: tool_use → getMetrics
[NLOps Agent] Round 2: tool_use → getRcaHistory
[NLOps Agent] Round 3: end_turn
[NLOps Agent] Trace saved: abc123 (2 tool calls, 3.4s)
```

### 폴백 동작

Option A는 **안전한 폴백 구조**를 가집니다:

```
USE_AGENT_SDK=true
    → Anthropic API 호출 성공 → 에이전트 루프 실행
    → Anthropic API 호출 실패 또는 에러
        → 자동으로 기존 NLOps 엔진(processCommand)으로 전환
        → 서버 로그: [NLOps API] Agent SDK failed, falling back to legacy engine
```

`USE_AGENT_SDK=false`(기본값)이거나 `ANTHROPIC_API_KEY`가 없으면 항상 기존 엔진을 사용합니다.

### 사용 가능한 툴 (9개)

에이전트가 호출할 수 있는 툴 목록:

| 툴 이름 | 설명 |
|---------|------|
| `getMetrics` | 현재 L2 메트릭 조회 |
| `getRcaHistory` | 최근 RCA 분석 이력 조회 |
| `getScalingState` | 현재 스케일링 상태 조회 |
| `getCostReport` | 비용 리포트 조회 |
| `getAnomalies` | 이상 탐지 결과 조회 |
| `getAgentLoopStatus` | 에이전트 루프 상태 조회 |
| `executeScaling` | 스케일 업/다운 실행 (위험, 확인 필요) |
| `triggerRca` | RCA 분석 트리거 |
| `getRemediationStatus` | 자동 복구 상태 조회 |

`executeScaling`은 위험 툴로 분류되어 `confirmAction: true` 없이는 실행되지 않습니다.

---

## Option B — Claude Code Subagents (Dev-time)

### 개요

Option B는 프로덕션 런타임과 무관합니다. **개발자가 Claude Code CLI를 사용하는 동안** 보조 역할을 수행하는 4개의 전용 에이전트입니다.

Claude Code CLI에서 `@agent-name`으로 호출하면 에이전트가 코드베이스를 읽고 원하는 산출물을 생성합니다.

### 전제 조건

- [Claude Code CLI](https://claude.ai/code) 설치
- SentinAI 레포를 작업 디렉토리로 열기 (`cd /path/to/SentinAI`)

### 에이전트 목록

#### 1. `chain-plugin-scaffolder` — 신규 체인 플러그인 생성

새로운 L2 체인을 SentinAI에 추가할 때 사용합니다. Optimism 플러그인을 참조하여 4개 파일을 자동 생성합니다.

**호출 예시:**

```
@chain-plugin-scaffolder zkSync Era 체인 플러그인을 만들어줘.
Chain ID: 324, RPC: https://mainnet.era.zksync.io
```

**생성 파일:**

```
src/chains/zksync-era/
  ├── index.ts        (ChainPlugin 구현체)
  ├── components.ts   (컴포넌트 토폴로지 정의)
  ├── prompts.ts      (AI 시스템 프롬프트)
  └── playbooks.ts    (remediation 플레이북)
```

**완료 후 할 일:**

```bash
# 타입 오류 확인
npx tsc --noEmit

# 체인 플러그인 테스트 실행
npm run test -- chain-plugin
```

---

#### 2. `playbook-author` — Remediation 플레이북 작성

새로운 자동 복구 플레이북을 작성할 때 사용합니다.

**호출 예시:**

```
@playbook-author L2 블록 생산 지연 시 sequencer를 재시작하는 플레이북을 작성해줘.
safety level: medium, target chain: optimism
```

**수정 파일:**

- 체인별: `src/chains/<chain>/playbooks.ts`
- 범용: `src/playbooks/core/` (별도 파일로 생성)

**완료 후 할 일:**

```bash
# 플레이북 매처 테스트로 검증
npm run test -- playbook
```

---

#### 3. `incident-postmortem` — 인시던트 포스트모템 초안 생성

RCA 결과와 인시던트 설명을 바탕으로 포스트모템 문서를 생성합니다.

**호출 예시:**

```
@incident-postmortem 2026-04-14에 발생한 L2 블록 지연 인시던트 포스트모템을 작성해줘.
지속 시간: 23분, 영향: 블록 생산 지연 (평균 15s → 45s)
```

**생성 파일:**

```
docs/postmortem/2026-04-14-l2-block-delay.md
```

**포스트모템 포함 내용:**
- 인시던트 타임라인
- 근본 원인 분석
- 영향 범위
- 적용된 복구 조치
- 재발 방지 액션 아이템

---

#### 4. `dashboard-reviewer` — 대시보드 코드 리뷰

`src/app/page.tsx` (~2400줄)의 코드 품질 이슈를 분석하고 우선순위별 리팩터 계획을 제안합니다.

**호출 예시:**

```
@dashboard-reviewer 대시보드 코드 리뷰해줘. 특히 폴링 cleanup과 타입 안전성 위주로.
```

**리뷰 항목:**
- 컴포넌트 분리 기회 (50줄 이상 인라인 컴포넌트)
- `useEffect` 클린업 누락
- `any` 타입 사용
- 불필요한 리렌더 유발 패턴
- 에러 핸들링 누락

> **주의**: 이 에이전트는 리뷰 리포트만 생성합니다. 직접 코드를 수정하지 않습니다.

---

## 두 옵션 함께 사용하기

Option A와 Option B는 독립적이며 함께 사용할 수 있습니다.

**예시 워크플로우 — 신규 체인 추가 후 운영:**

```bash
# 1. [개발] 신규 체인 플러그인 생성 (Option B)
@chain-plugin-scaffolder Base 체인 플러그인 만들어줘.

# 2. [개발] 해당 체인 플레이북 추가 (Option B)
@playbook-author Base 체인 sequencer 재시작 플레이북 작성해줘.

# 3. [배포] 서버 시작 (Option A 활성화)
USE_AGENT_SDK=true npm run dev

# 4. [운영] NLOps 챗에서 자연어로 진단
"Base L2 트랜잭션 처리량이 갑자기 떨어진 이유가 뭐야?"
→ 에이전트가 getMetrics, getRcaHistory, getScalingState 순차 호출 후 분석

# 5. [운영 후] 인시던트가 있었다면 포스트모템 (Option B)
@incident-postmortem Base 체인 처리량 저하 인시던트 포스트모템 작성해줘.
```

---

## 문제 해결

### Option A

| 증상 | 확인 사항 |
|------|-----------|
| 응답이 기존과 동일함 | `USE_AGENT_SDK=true` 설정 확인, 서버 재시작 |
| "Agent SDK failed" 로그 | `ANTHROPIC_API_KEY` 유효성 확인 |
| 응답이 느림 | 정상 (최대 5라운드 × 툴 실행). 기존 방식보다 느릴 수 있음 |
| executeScaling 거부 | 요청에 명시적 확인 의사 포함 필요 |

### Option B

| 증상 | 확인 사항 |
|------|-----------|
| `@agent-name` 미인식 | Claude Code CLI 버전 업데이트, `.claude/agents/` 디렉토리 존재 확인 |
| 생성된 파일에 타입 오류 | `npx tsc --noEmit` 실행 후 에이전트에 오류 메시지 전달 |
| 플레이북이 매처에서 미탐 | 에이전트에 `playbook-matcher` 테스트 결과 붙여넣기 후 수정 요청 |
