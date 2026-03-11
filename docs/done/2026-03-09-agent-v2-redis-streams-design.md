# Agent V2 Redis Streams EventBus Design

작성일: 2026-03-09

## 1. 목표

현재 Agent V2는 process-local `EventEmitter` 기반 `AgentEventBus`를 사용한다. 이 구조는 단일 프로세스 개발 환경에서는 충분하지만, 다중 worker, 재시작 복구, 전달 보장, 재처리, 운영 추적이 필요한 환경에서는 한계가 명확하다.

이 문서의 목표는 Agent V2의 이벤트 전달 계층을 Redis Streams 기반으로 재설계하기 위한 기준안을 정의하는 것이다.

이번 문서의 범위는 "설계 확정"까지다. 실제 구현은 별도 작업으로 진행한다.

## 2. 현재 상태 요약

현재 구현 기준 이벤트 전달은 다음과 같다.

- 이벤트 발행: `src/core/agent-event-bus.ts`
- 주요 발행자:
  - `DetectorAgent` → `anomaly-detected`
  - `AnalyzerAgent` → `analysis-complete`
  - `ExecutorAgent` → `execution-complete`
  - `VerifierAgent` → `verification-complete`
  - domain/action agents → `security-alert`, `reliability-issue`, `rca-result`, `scaling-recommendation`, `remediation-complete`
- 주요 소비자:
  - `AnalyzerAgent`, `ExecutorAgent` ← `anomaly-detected`
  - `VerifierAgent` ← `execution-complete`
  - `NotifierAgent` ← `verification-complete`, `remediation-complete`, `scaling-recommendation`
  - `RemediationAgent` ← `security-alert`, `reliability-issue`, `rca-result`

현재 구조의 한계는 아래와 같다.

1. 프로세스가 내려가면 미처 처리되지 않은 이벤트가 사라진다.
2. 다른 프로세스에 있는 동일 인스턴스 agent set은 같은 이벤트를 소비할 수 없다.
3. 전달 여부를 추적할 수 없다.
4. 재시도, 보류, 재처리, DLQ 같은 운영 제어가 없다.
5. `VerifierAgent`의 원장 적재처럼 후속 단계가 이벤트 전달에 묶여 있어, 이벤트 유실이 곧 운영 이력 유실로 이어진다.

## 3. 설계 원칙

Redis Streams 설계는 다음 원칙을 따른다.

1. 이벤트는 메모리 신호가 아니라 내구성 있는 로그다.
2. 인스턴스 단위 순서 보장이 중요하다.
3. 소비자는 적어도 한 번(at-least-once) 전달을 전제로 하고, 중복 처리는 idempotency로 막는다.
4. 운영자 관점에서 pending, lag, retry, DLQ를 추적할 수 있어야 한다.
5. 개발 환경에서는 기존 메모리 버스를 fallback으로 유지할 수 있지만, 운영 기준선은 Redis Streams다.

## 4. 선택한 토폴로지

### 4.1 스트림 단위

스트림은 인스턴스별 단일 이벤트 로그로 설계한다.

- 스트림 키: `inst:{instanceId}:agent-events`

이 방식을 선택하는 이유는 다음과 같다.

1. 현재 Agent V2가 인스턴스 단위로 orchestrator와 agent set을 생성한다.
2. `correlationId` 기준 원인 추적과 후속 단계 재생이 인스턴스 맥락 안에서 가장 자연스럽다.
3. `anomaly-detected` → `execution-complete` → `verification-complete` 같은 연쇄를 한 로그에서 볼 수 있다.
4. 기존 Redis key schema인 `inst:{instanceId}:...`와 정합성이 맞다.

### 4.2 대안과 기각 이유

- 전역 단일 스트림:
  - 장점: 구현 단순
  - 단점: 인스턴스 간 이벤트가 뒤섞이고, hot instance가 전체 backlog에 영향을 준다.

- 이벤트 타입별 전역 스트림:
  - 장점: consumer group 설계 단순
  - 단점: 동일 상관관계의 연쇄가 여러 stream으로 분산되고, 인스턴스 추적성이 약해진다.

현재 코드 구조와 운영 모델을 기준으로는 인스턴스별 단일 스트림이 가장 맞다.

## 5. 이벤트 모델

### 5.1 이벤트 envelope

기존 `AgentEvent`를 확장해 아래 필드를 표준으로 사용한다.

```ts
interface DurableAgentEvent {
  eventId: string;
  type: AgentEventType;
  instanceId: string;
  correlationId: string;
  causationId?: string;
  timestamp: string;
  producer: string;
  schemaVersion: 1;
  payload: Record<string, unknown>;
}
```

필드 의미:

- `eventId`: 개별 이벤트 식별자. idempotency의 기본 키.
- `correlationId`: 하나의 incident 또는 실행 흐름을 묶는 추적 키.
- `causationId`: 바로 직전 이벤트의 `eventId`. 예: `execution-complete`는 원인이 된 `anomaly-detected.eventId`를 가진다.
- `producer`: `detector`, `executor`, `verifier` 같은 발행 주체.
- `schemaVersion`: 이벤트 파싱 호환성을 위한 버전.

### 5.2 Redis Streams field encoding

Redis Streams에는 문자열 필드로 저장한다.

권장 저장 포맷:

- `eventId`
- `type`
- `instanceId`
- `correlationId`
- `causationId`
- `timestamp`
- `producer`
- `schemaVersion`
- `payloadJson`

`payload`는 `payloadJson = JSON.stringify(payload)`로 저장한다.

## 6. Consumer Group 설계

각 인스턴스 스트림마다 agent role 단위 consumer group을 만든다.

예시:

- 스트림: `inst:abc123:agent-events`
- 그룹:
  - `analyzer`
  - `executor`
  - `verifier`
  - `remediation`
  - `notifier`

consumer name 규칙:

- `{role}:{hostname}:{pid}`

예시:

- `executor:sentinai-api-1:4312`

이 구조의 의미는 다음과 같다.

- 같은 role의 여러 프로세스가 있을 경우 경쟁 소비가 가능하다.
- role별 전달 대상이 명확하다.
- 인스턴스별 격리가 유지된다.

## 7. 이벤트 라우팅 규칙

모든 group이 모든 이벤트를 처리하는 것은 아니다. 소비자는 stream에서 이벤트를 읽되, 자신의 관심 이벤트 타입만 처리하고 나머지는 즉시 ack한다.

role별 관심 이벤트:

- `analyzer`
  - `anomaly-detected`
- `executor`
  - `anomaly-detected`
- `verifier`
  - `execution-complete`
- `remediation`
  - `security-alert`
  - `reliability-issue`
  - `rca-result`
- `notifier`
  - `verification-complete`
  - `remediation-complete`
  - `scaling-recommendation`

주의할 점:

- `AnalyzerAgent`와 `ExecutorAgent`는 같은 `anomaly-detected`를 각각 독립적으로 소비해야 하므로 같은 stream, 다른 consumer group으로 처리한다.
- `VerifierAgent`는 실행 후 검증과 operation ledger 적재를 담당하므로 `execution-complete` 처리 성공 여부가 중요하다.

## 8. 전달 보장과 재시도

### 8.1 기본 소비 순서

1. `XREADGROUP`으로 이벤트 수신
2. payload 역직렬화 및 schema 검증
3. idempotency 검사
4. business handler 실행
5. 성공 시 `XACK`
6. 실패 시 pending 유지

### 8.2 Pending 재회수

각 consumer loop는 주기적으로 `XPENDING`과 `XAUTOCLAIM`을 사용해 idle pending 이벤트를 재회수한다.

권장 기준:

- `executor`: idle 15초 초과 시 reclaim
- `analyzer`: idle 60초 초과 시 reclaim
- `verifier`: idle 30초 초과 시 reclaim
- `remediation`: idle 60초 초과 시 reclaim
- `notifier`: idle 120초 초과 시 reclaim

### 8.3 재시도 상한

전달 횟수가 일정 횟수를 넘으면 DLQ로 이동한다.

권장 기준:

- 최대 delivery count: 10

초과 시 동작:

1. 원본 이벤트를 DLQ stream에 복사
2. 실패 메타데이터를 함께 기록
3. 원본 stream entry는 `XACK`

## 9. DLQ 설계

DLQ는 인스턴스별로 분리한다.

- DLQ 키: `inst:{instanceId}:agent-events:dlq`

필드:

- `originalStreamId`
- `eventJson`
- `failedGroup`
- `failedConsumer`
- `deliveryCount`
- `lastError`
- `failedAt`

이렇게 해야 나중에 운영자가 특정 인스턴스의 유실/실패 이벤트를 그대로 복원해 재처리할 수 있다.

## 10. Idempotency 설계

Redis Streams는 적어도 한 번 전달이므로 중복 소비를 전제로 해야 한다.

idempotency 키:

- `inst:{instanceId}:agent-event-idem:{group}:{eventId}`

동작:

1. 소비 전 `SET key 1 NX EX 86400`
2. 성공하면 처리 진행
3. 이미 존재하면 중복으로 보고 `XACK`

이 방식으로 다음 문제를 막는다.

- reclaim 후 동일 이벤트 재실행
- consumer crash 직전/직후 중복 처리
- 동일 role 다중 프로세스 환경의 race

`correlationId`는 추적용이고, dedupe의 기본 키는 `eventId`로 잡는 편이 안전하다.

## 11. 생산자 인터페이스

현재 `getAgentEventBus().emit(event)` 호출은 아래 추상화로 감싼다.

```ts
interface AgentEventPublisher {
  publish(event: DurableAgentEvent): Promise<void>;
}
```

구현 모드:

- `memory`
- `redis-streams`
- `hybrid`

권장 환경 변수:

- `AGENT_EVENT_BUS_BACKEND=memory|redis-streams|hybrid`

권장 기본값:

- 개발: `memory`
- staging/canary: `hybrid`
- production: `redis-streams`

## 12. 소비자 런타임 모델

각 agent role은 내부적으로 polling loop를 가진 consumer로 바뀐다.

예시:

- `AnalyzerAgent.start()`
  - 기존: `bus.on('anomaly-detected', handler)`
  - 변경: analyzer group으로 `XREADGROUP BLOCK ...`

- `ExecutorAgent.start()`
  - 기존: `bus.on('anomaly-detected', handler)`
  - 변경: executor group으로 같은 stream을 구독

- `VerifierAgent.start()`
  - 기존: `bus.on('execution-complete', handler)`
  - 변경: verifier group으로 stream 구독

핵심은 "EventEmitter listener"가 "Redis consumer loop"로 바뀌는 것이다.

## 13. 관측성과 운영 메트릭

최소한 아래 메트릭을 노출해야 한다.

- `agent_event_publish_total{type}`
- `agent_event_consume_total{group,type,status}`
- `agent_event_pending{instanceId,group}`
- `agent_event_reclaim_total{group}`
- `agent_event_dlq_total{group,type}`
- `agent_event_consumer_lag{instanceId,group}`

로그에는 최소 아래 필드를 포함한다.

- `instanceId`
- `eventId`
- `correlationId`
- `type`
- `group`
- `consumer`
- `streamId`

## 14. 장애 시 동작

### 14.1 Redis 미구성

`REDIS_URL`이 없으면:

- 개발 환경에서는 `memory` fallback 허용
- 운영 환경에서는 Agent V2 시작을 차단하거나 degraded 상태로 명시

권장 규칙:

- `AGENT_V2=true`이고 `AGENT_EVENT_BUS_BACKEND=redis-streams`인데 Redis가 없으면 시작 실패

### 14.2 Redis 순간 장애

- publish 실패는 이벤트 유실 위험이므로 에러를 명시적으로 기록해야 한다.
- `hybrid` 모드에서는 메모리 버스로 계속 진행할 수 있지만, production 기준선으로 삼아서는 안 된다.

### 14.3 Consumer crash

- pending entry는 idle timeout 이후 다른 consumer가 reclaim
- 이미 성공했지만 ack 전 crash한 경우는 idempotency가 중복 실행을 막음

## 15. 마이그레이션 계획

### Phase 1: 추상화 도입

- `AgentEventPublisher`
- `AgentEventConsumer`
- 기존 `EventEmitter` 기반 구현을 `memory` backend로 감싼다.

### Phase 2: Redis Streams publisher 추가

- `publish()`가 stream에 `XADD`
- `hybrid` 모드에서 memory + stream 동시 기록

### Phase 3: Shadow consumer

- analyzer/executor/verifier를 shadow consumer로 붙여 stream을 읽되, 실제 side effect는 막는다.
- pending, lag, reclaim, payload 파싱 안정성을 검증한다.

### Phase 4: 역할별 cutover

순서 권장:

1. `AnalyzerAgent`
2. `NotifierAgent`
3. `VerifierAgent`
4. `ExecutorAgent`
5. `RemediationAgent`

이유:

- `AnalyzerAgent`는 side effect가 적어 전환 리스크가 낮다.
- `ExecutorAgent`와 `RemediationAgent`는 실제 조치를 수행하므로 마지막에 전환하는 편이 안전하다.

### Phase 5: memory backend 축소

- production에서는 `redis-streams`만 허용
- `memory`는 개발/테스트 fallback으로만 유지

## 16. 구현 시 주의사항

1. `eventId` 없이 `correlationId`만으로 dedupe하지 않는다.
   하나의 상관관계 안에 여러 이벤트가 존재할 수 있다.

2. publish와 side effect를 섞지 않는다.
   이벤트 발행 성공 여부와 실제 K8s/Slack/Redis side effect는 분리해서 로깅해야 한다.

3. `XACK`는 handler 성공 후에만 한다.
   선 ack는 전달 보장 의미를 없앤다.

4. stream retention 정책을 둔다.
   권장: `XADD ... MAXLEN ~ 10000`

5. DLQ replay 도구를 별도로 둔다.
   운영자가 `inst:{instanceId}:agent-events:dlq`를 검사하고 재주입할 수 있어야 한다.

## 17. 이번 설계의 결론

Agent V2의 이벤트 계층은 Redis Streams 기반 인스턴스별 단일 stream으로 수렴한다.

- stream key: `inst:{instanceId}:agent-events`
- group: role별 분리
- 전달 모델: at-least-once + `eventId` idempotency
- 실패 처리: pending reclaim + DLQ
- rollout: `memory` → `hybrid` → `redis-streams`

이 설계를 따르면 현재 process-local bus의 가장 큰 한계였던 유실, 재처리 불가, 다중 프로세스 비호환 문제를 구조적으로 해결할 수 있다.
