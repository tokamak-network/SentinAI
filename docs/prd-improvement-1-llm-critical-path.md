# PRD: LLM을 의사결정 Critical Path에 통합

**문서 유형**: 내부 검토 / CEO 결정 검토용
**작성일**: 2026-04-14
**상태**: Draft v1.0
**분류**: SentinAI 에이전트화 개선안 #1

---

## 1. 배경 및 문제 정의

### 현재 설계의 핵심 한계

SentinAI는 현재 두 개의 병렬 경로로 운영된다.

```
이상 감지
  ├→ ExecutorAgent (~2초) : 규칙 기반 스코어링 → 즉시 K8s 행동
  └→ AnalyzerAgent (~8초) : LLM 추론 → 다음 사이클 점수에 반영
```

**문제**: LLM은 사후 설명자(observer)에 불과하다. LLM이 "이것은 스케일링이 아니라 네트워크 문제"라고 판단해도, 스케일링은 이미 완료된 이후다.

### 현재 아키텍처가 틀린 이유

| 구분 | 현재 (규칙 기반) | 실제 필요 |
|------|-----------------|-----------|
| **의사결정자** | 하드코딩 임계값 (Score ≥ 77 → 8 vCPU) | 상황 맥락을 이해하는 LLM |
| **LLM 역할** | 병렬 실행, 다음 사이클 반영 | 행동 전 승인/수정 |
| **오판 비용** | 복구 불가한 불필요한 스케일링 발생 | LLM이 차단 또는 수정 가능 |
| **AI 가중치** | 스코어의 20% (수치 변환 후 반영) | 행동 자체를 결정 |

### 대표 오판 시나리오 (현재 발생 가능)

```
상황: 네트워크 지연으로 TxPool 급증, CPU는 정상
현재: TxPool Score 100 → 총 점수 70 → 4 vCPU로 스케일업
실제 필요: "네트워크 문제, 스케일링은 도움 안 됨" → 스케일링 차단
결과 차이: 불필요한 인프라 비용 + 잘못된 대응
```

---

## 2. 목표

### 핵심 목표

> **LLM이 스케일링 행동 실행 전에 최종 결정을 내린다.**
> 규칙 기반 스코어링은 LLM의 참고 입력으로 강등된다.

### 성공 기준 (OKR)

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|-----------|
| **잘못된 스케일링 비율** | 측정 불가 (규칙이 항상 실행) | < 5% | VerifierAgent 사후 검증 |
| **LLM 결정 성공률** | 0% (critical path 미포함) | > 95% (타임아웃 전 응답) | ai-routing 레이턴시 로그 |
| **평균 결정 지연 추가** | 0ms | < 2,000ms (Qwen 3 80B 기준) | ExecutorAgent 타이밍 로그 |
| **규칙 기반 fallback 발생률** | 100% (현재 전부) | < 5% (LLM 실패 시만) | fallback 카운터 |

---

## 3. 솔루션: LLM-First ExecutorAgent

### 3.1 변경 전/후 비교

**Before (현재)**
```
anomaly-detected 이벤트
  → getRecentMetrics()
  → calculateScalingScore()  ← 규칙 기반, LLM 없음
  → determineTargetVcpu()
  → scaleOpGeth()            ← 즉시 실행
```

**After (개선)**
```
anomaly-detected 이벤트
  → getRecentMetrics()
  → calculateScalingScore()  ← 그대로 유지 (LLM 입력용)
  → LLM Decision Call        ← 신규 (Qwen 3 80B, ~1.8s)
      ├─ 입력: 메트릭 + 규칙 스코어 + 이상 상세
      └─ 출력: { action, targetVcpu, reason, confidence }
  → [LLM 실패 시] 규칙 기반 fallback
  → scaleOpGeth()            ← LLM 결정에 따라 실행
```

### 3.2 LLM 프롬프트 설계

**System Prompt**
```
You are an autonomous L2 blockchain node operations agent.
You receive real-time anomaly data and MUST make a scaling decision.
You are the final decision-maker — your output will directly trigger Kubernetes actions.

Rules:
- Respond ONLY in JSON
- Be fast and decisive (you have < 2 seconds)
- Consider whether scaling actually solves the problem
- If unsure, prefer conservative action (scale down or no-op)
```

**User Prompt 구조**
```json
{
  "instance": "op-geth-mainnet-01",
  "anomalies": [
    { "metric": "txPoolPending", "value": 1850, "zscore": 4.2, "severity": "high" }
  ],
  "current_metrics": {
    "cpuUsage": 23,
    "txPoolPending": 1850,
    "gasUsedRatio": 0.41
  },
  "rule_score": 62,
  "rule_recommendation": "2 vCPU → 4 vCPU",
  "current_vcpu": 2,
  "cooldown_remaining_sec": 0
}
```

**Expected Response**
```json
{
  "action": "scale" | "no_action" | "investigate",
  "target_vcpu": 4,
  "confidence": 0.87,
  "reason": "TxPool surge without CPU pressure suggests network congestion, not compute shortage. Scaling may not resolve. Monitoring recommended.",
  "override_rule": true
}
```

### 3.3 타임아웃 및 Fallback 전략

```
LLM 호출 시작
  ├─ 1,800ms 이내 응답: LLM 결정 사용
  ├─ 1,800ms ~ 2,500ms: 대기 (마진)
  └─ 2,500ms 초과: 규칙 기반 fallback 실행 + fallback 카운터 +1

Fallback 조건 (LLM 응답 받아도 무시):
  ├─ confidence < 0.5 (낮은 확신)
  ├─ action = "investigate" AND score ≥ 77 (critical, 기다릴 수 없음)
  └─ JSON parse 실패
```

**Fallback이 이루어지면:**
- 규칙 기반 로직 그대로 실행
- 로그에 `llm_fallback: true` 기록
- 주간 리포트에 fallback 비율 포함

### 3.4 모델 선택

Qwen 3 80B (`qwen3-80b-next`)를 1순위로 사용. 이유:

| | Qwen 3 80B | GPT-5.2 | Claude Haiku 4.5 |
|--|--|--|--|
| **레이턴시** | ~1.8s | ~8s | ~2.5s |
| **비용 (추정)** | $30/월 | $220/월 | $45/월 |
| **Critical Path 적합성** | 최적 | 부적합 | 가능 |

이미 `ai-client.ts`에 `qwen3-80b-next`가 `fast` tier로 설정되어 있어 추가 모델 설정 불필요.

---

## 4. 구현 범위

### 변경 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/core/agents/executor-agent.ts` | LLM Decision Call 삽입 (handleAnomalyDetected 함수 내) |
| `src/lib/scaling-decision.ts` | `makeScalingDecision()`에 LLM 결정 오버라이드 인터페이스 추가 |
| `src/lib/ai-client.ts` | `decideScalingAction()` 함수 신규 추가 (structured output) |
| `src/types/scaling.ts` | `LLMScalingDecision` 타입 추가 |
| `src/core/agents/analyzer-agent.ts` | 변경 없음 (역할 유지, 단 severity가 LLM 입력에 포함됨) |

### 변경하지 않는 것

- AnalyzerAgent — 역할 그대로 유지 (사후 분석, 설명 생성)
- VerifierAgent — 변경 없음
- K8s 스케일링 로직 (`k8s-scaler.ts`) — 변경 없음
- 쿨다운, 설정 범위 검사 — 변경 없음 (LLM 결정 이후에도 동일 적용)

---

## 5. 리스크

### 5.1 레이턴시 증가

- **리스크**: Qwen 3 80B가 1.8s보다 느릴 경우 critical path 지연
- **완화**: 2,500ms 하드 타임아웃으로 worst-case 보장
- **현재 critical path**: ~2,000ms (K8s 명령 포함). 타임아웃 후 fallback하면 총 ~4,500ms.
- **허용 가능 여부**: L2 노드 스케일링은 수초 단위 지연이 허용됨. 문제없음.

### 5.2 LLM 오판

- **리스크**: LLM이 잘못된 결정 (예: 스케일업 필요 상황에 no_action)
- **완화 1**: confidence < 0.5 시 규칙 기반으로 fallback
- **완화 2**: score ≥ 77 (critical) + LLM이 "investigate" 시 규칙 우선
- **완화 3**: VerifierAgent가 실제 vCPU와 결정을 비교 → 오판율 추적

### 5.3 Qwen API 장애

- **리스크**: Qwen API down → 전체 결정 블록
- **완화**: 타임아웃 2,500ms 후 자동 fallback (현재 규칙 기반)
- **실질 영향**: 장애 시 현재와 동일하게 동작 (규칙 기반 실행)

### 5.4 프롬프트 인젝션

- **리스크**: 메트릭 값에 악의적 텍스트 삽입
- **완화**: 메트릭은 숫자 타입만 허용, JSON serialization 전에 타입 검증

---

## 6. 구현 로드맵

### Phase 1: Shadow Mode (1주)

LLM 결정을 실행하지 않고 로깅만 한다. 규칙 기반 실행은 그대로.

- `executor-agent.ts`에 LLM 호출 추가 (비동기, non-blocking)
- 결과를 `llm_shadow_decision` 로그로 기록
- 목표: LLM vs 규칙 기반 일치율 측정

**완료 기준**: 100개 이상의 이벤트에서 LLM 응답률 > 95%

### Phase 2: LLM-First 전환 (1주)

LLM 결정을 실제 실행에 반영한다.

- `makeScalingDecision()`에 LLM override 적용
- Fallback 카운터 + 오버라이드 로그 추가
- VerifierAgent에 `llm_decided: true/false` 필드 추가

**완료 기준**: fallback 발생률 < 5%, 레이턴시 증가 < 2,500ms

### Phase 3: 피드백 루프 (2주)

- VerifierAgent가 LLM 결정의 정확도를 사후 평가
- 오판 사례 자동 수집 → 프롬프트 개선
- 주간 LLM 정확도 리포트 자동 생성

---

## 7. 기대 효과

### 정량적

| 항목 | 현재 | 개선 후 |
|------|------|---------|
| 불필요한 스케일링 방지 | 불가 (규칙은 항상 실행) | LLM이 차단 가능 |
| 네트워크/DB 이슈 오판 처리 | 항상 스케일업으로 오대응 | 원인별 맞춤 대응 |
| 야간 on-call 호출 | 오판으로 인한 불필요 알람 포함 | false positive 감소 |
| AI 가중치 실효성 | 다음 사이클에야 반영 (20% 영향) | 현재 사이클 100% 반영 |

### 정성적

- SentinAI가 "규칙을 실행하는 봇"에서 "상황을 이해하는 에이전트"로 전환
- 향후 더 복잡한 멀티-인스턴스 조율, 예방적 스케일링의 기반 마련
- CEO 외부 발표 시 "LLM-native autonomous agent"로 포지셔닝 가능

---

## 8. 결정 필요 사항

1. **Phase 1 Shadow Mode 승인 여부** — 현재 운영에 영향 없음, 즉시 시작 가능
2. **타임아웃 기준 확정** — 2,500ms (제안) vs 다른 기준
3. **Fallback 정책 확정** — critical score(≥77) 시 LLM 무시 여부
4. **VerifierAgent 정확도 피드백 주기** — 주간 리포트 vs 실시간 대시보드

---

*이 문서는 SentinAI 아키텍처 분석을 기반으로 작성되었으며, 코드 레벨 구현은 Phase 1 승인 후 별도 기술 설계서로 보완됩니다.*
