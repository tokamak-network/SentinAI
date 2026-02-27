# 제안 25: Claude Code 자연어 기반 L2 운영 (우선순위 로드맵)

> 작성일: 2026-02-22  
> 상태: 구현 완료 (우선순위 1-6 완료)  
> 분기: Q2 (2026-03 ~ 2026-05)

---

## 0. 구현 상태

- [x] 우선순위 1: Claude Code MCP stdio 브리지
- [x] 우선순위 3: 중앙 정책/승인 엔진
- [x] 우선순위 2: LLM+검증기 기반 목표 플래너(재계획 포함)
- [x] 우선순위 5: 폐쇄 루프 검증 및 롤백 자동화
- [x] 우선순위 4: 운영 액션 MCP 툴셋 확장
- [x] 우선순위 6: 평가 환경 및 자율성 스코어카드

---

## 1. 목표

운영 안전성을 유지하면서 Claude Code에서 실용적인 자연어 L2 운영을 가능하게 한다.

1. Claude Code가 커스텀 RPC 래퍼 없이 MCP로 SentinAI 도구를 탐색/호출
2. 목표 실행 시 정책 제약 하에서 추론/검증/재계획 수행
3. 자율 루프가 결과를 검증하고 실패 시 자동 롤백

### 성공 지표 (Q2)

| KPI | 기존 | 목표 |
|---|---:|---:|
| Claude Code MCP 직접 호환성 | 부분 | 완전 호환(`initialize`, `tools/list`, `tools/call`, stdio bridge) |
| 목표 완료율(제한된 과업) | N/A | 85% 이상 |
| 정책으로 차단된 위험 write 시도 | N/A | 100% |
| write 액션 자동 검증 커버리지 | 부분 | 100% |
| 자율 액션으로 인한 운영 사고 | N/A | 단계 배포 중 0건 |

---

## 2. 우선순위 순서

실행 순서는 고정한다.

1. 우선순위 1: Claude Code MCP 전송 어댑터(`stdio`/SSE bridge)
2. 우선순위 3: 중앙 정책/승인 엔진
3. 우선순위 2: LLM+검증기 목표 플래너(재계획)
4. 우선순위 5: 폐쇄 루프 검증/롤백 자동화
5. 우선순위 4: 운영 액션 툴셋 확장
6. 우선순위 6: 평가 환경 및 자율성 스코어카드

---

## 3. 현재 베이스라인

사전 구현 상태:

1. MCP HTTP 엔드포인트 및 라우팅 존재
2. 목표 계획/실행 기능 존재(규칙 기반 중심)
3. Agent Loop phase trace/검증 존재(스케일링 경로 중심)
4. MCP write 도구에 승인/읽기 전용 가드 존재

주요 갭:

1. Claude Code 네이티브 MCP transport 패키징 부재
2. 정책 로직이 서버 내부에 분산되어 재사용성이 낮음
3. 목표 계획이 키워드/규칙 중심
4. write 도구 전반의 검증/롤백 프레임워크 일관성 부족

---

## 4. 우선순위별 구현 계획

## 4.1 우선순위 1 — Claude Code MCP Transport Adapter

### 목적

stdio MCP 호출을 SentinAI `/api/mcp`로 안전하게 변환하는 브리지 프로세스를 제공한다.

### 산출물

1. `src/lib/mcp-bridge-client.ts`
2. `scripts/mcp-stdio-bridge.ts`
3. `package.json` 스크립트: `mcp:bridge:stdio`
4. 설정 가이드: `docs/guide/claude-code-mcp-setup.md`

### API/계약

1. `initialize`, `tools/list`, `tools/call`, `notifications/initialized` 지원
2. `x-api-key`, `x-request-id`, 승인 토큰 컨텍스트 전달
3. SentinAI 오류 코드를 stdio MCP 응답 형태로 정규화

### 검증

1. stdio 프레임 파싱/직렬화 단위 테스트
2. 브리지→`/api/mcp` 라운드트립 통합 테스트
3. Claude Code에서 `get_metrics` 스모크 테스트

### 종료 기준

1. curl 수동 래퍼 없이 Claude Code 사용 가능
2. 툴 탐색/호출 성공률 99% 이상

---

## 4.2 우선순위 3 — 중앙 정책/승인 엔진

### 목적

MCP/API/agent가 동일한 write 제약을 적용하도록 정책 판단을 중앙 모듈로 통합한다.

### 산출물

1. `src/types/policy.ts`
2. `src/lib/policy-engine.ts`
3. `src/lib/approval-engine.ts`
4. 호출부 리팩터링(`mcp-server`, `goals route`, `agent-loop`)

### 정책 모델

입력:

- actor, tool/action, risk level, read-only mode, env flags, chain context

출력:

- `allow | deny | require_approval | require_multi_approval`
- 결정 사유 코드(감사 가능)

### 검증

1. 액션/리스크/모드 매트릭스 단위 테스트
2. 기존 MCP 회귀 테스트
3. 토큰 재사용/만료/파라미터 변조 보안 테스트

### 종료 기준

1. 정책 모듈 외부 가드 중복 제거
2. 모든 write 승인/거부 결정에 기계 해석 가능한 reason code 제공

---

## 4.3 우선순위 2 — LLM+검증기 목표 플래너(재계획)

### 목적

키워드 기반 계획을 제약 기반 모델 계획으로 고도화하고, 유효성 검증과 제한된 재계획 루프를 제공한다.

### 산출물

1. `src/lib/goal-planner-llm.ts`
2. `src/lib/goal-plan-validator.ts`
3. `src/types/goal-planner.ts` 확장(`planVersion`, `replanCount`, `failureReasonCode`)
4. `src/lib/goal-planner.ts` 통합

### 플래닝 파이프라인

1. 의도 추출 → 후보 step graph 생성
2. 검증(스키마/정책/런타임 전제조건)
3. 실패 시 제한된 재계획(`maxReplans=2`)
4. 모델 경로 실패 시 규칙 기반 플래너 fallback

### 검증

1. malformed plan 거부 및 복구 테스트
2. `execute_goal_plan` 재계획 성공/실패 경로 테스트
3. `fast`/`best` 모델 비용·지연 예산 테스트

### 종료 기준

1. 표준 목표 클래스 4종 이상에서 실행 가능한 유효 계획 생성
2. 재계획 루프가 잘못된 write 계획 실행을 차단

---

## 4.4 우선순위 5 — 폐쇄 루프 검증 및 롤백

### 목적

모든 write 액션에 사후조건 검증을 부여하고, 실패 시 자동 롤백 플레이북을 실행한다.

### 산출물

1. `src/types/operation-control.ts`
2. `src/lib/operation-verifier.ts`
3. `src/lib/rollback-runner.ts`
4. MCP/goal-planner/agent-loop 연동

### 제어 흐름

1. 액션 실행(또는 dry-run)
2. 액션별 verifier 실행
3. 실패 + 롤백 가능 시 롤백 실행 및 검증
4. 결과를 decision trace/activity log에 기록

### 검증

1. 액션 타입별 verifier 규칙 단위 테스트
2. 강제 실패 시 롤백 트리거 통합 테스트
3. 롤백 성공률 메트릭/알림 임계값 검증

### 종료 기준

1. write 액션 100% verifier 정의
2. 검증 실패가 성공으로 침묵 반환되지 않음

---

## 4.5 우선순위 4 — 운영 액션 툴셋 확장

### 목적

실제 L2 운영에 필요한 액션 표면을 확장하되, 모든 액션에 가드/드라이런/롤백 인지를 강제한다.

### 산출물

1. MCP 도구 추가:
   - `restart_batcher`
   - `restart_proposer`
   - `switch_l1_rpc`
   - `update_proxyd_backend`
   - `run_health_diagnostics`
2. 실행 모듈:
   - `src/lib/l1-rpc-operator.ts`
   - `src/lib/component-operator.ts`

### 규칙

1. 신규 write 도구는 정책 체크/승인 경로/verifier+rollback 힌트 필수
2. read-only 모드 동작을 도구별로 명시

### 검증

1. 파라미터 검증/정책 매핑 단위 테스트
2. 도구 호출→실행→검증→감사 로그 통합 테스트
3. 기존 도구 회귀 테스트

### 종료 기준

1. MCP에서 운영 도구 5종 이상 제공
2. 신규 write 도구 guarded 실행 테스트 통과

---

## 4.6 우선순위 6 — 평가 환경 및 자율성 스코어카드

### 목적

운영 배포 전에 자율성 품질을 반복 가능하게 측정한다.

### 산출물

1. 평가 시나리오 세트(정상/오탐/실패/롤백)
2. `autonomy-scorecard` 계산/리포트
3. staged rollout gate 기준

### 메트릭

1. goal completion rate
2. unsafe action blocked rate
3. verifier coverage
4. rollback success rate
5. mean intervention time

### 검증

1. 재현 가능한 시나리오 실행
2. 스코어 산출 일관성 확인
3. 배포 게이트 임계값 검증

### 종료 기준

1. 운영 승격 전에 점수 기반 판정 가능
2. 자율성 개선 추세를 주간 단위로 관측 가능

---

## 5. 마일스톤 타임라인 (10주)

1. W1-W2: Priority 1
2. W2-W3: Priority 3
3. W3-W5: Priority 2
4. W5-W7: Priority 5
5. W7-W8: Priority 4
6. W8-W10: Priority 6

---

## 6. 테스트 전략

### Unit

- transport/policy/planner/verifier/tool validation

### Integration

- bridge↔mcp, plan↔execute, verify↔rollback

### Acceptance

1. 안전 정책 위반 없이 자연어 운영 가능
2. 실패 액션 자동 롤백 및 기록
3. 단계 배포 중 운영 사고 0건

---

## 7. 배포 및 롤백

### Rollout

1. 개발/스테이징에서 shadow mode
2. 제한된 write 범위로 canary
3. 정책 게이트 기준 통과 시 확대

### Rollback

1. 브리지/자율 실행 플래그 비활성화
2. 기존 수동/반자동 경로 즉시 복귀
3. 실패 케이스 감사 로그 보존

---

## 8. 리스크 및 대응

1. 정책 누락으로 인한 위험 실행 → 중앙 정책 엔진 단일화
2. LLM 계획 품질 변동 → validator + bounded replan + fallback
3. 검증/롤백 커버리지 공백 → write 액션 100% verifier 계약 강제
4. 운영 복잡도 증가 → scorecard 기반 단계 승격

