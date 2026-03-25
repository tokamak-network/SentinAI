# Slack Alert Reference

NotifierAgent가 Operator에게 전송하는 Slack 알림의 발생 기준, 메시지 형식, 쿨다운을 케이스별로 정리한 문서입니다.

> **설계 원칙**: 에이전트가 자율적으로 처리할 수 있는 이벤트는 알림을 보내지 않습니다.
> Operator에게 알림이 도달했다면 **에이전트가 실패했거나**, **중요한 상태 변경이 실행된 것**입니다.

---

## 알림 케이스

### 1. Scaling Applied (스케일링 실행 완료)

| 항목 | 내용 |
|---|---|
| **이벤트** | `scaling-recommendation` |
| **발생 조건** | `source === 'cost-insight'` && `execution.executed === true` |
| **쿨다운** | 1시간 |
| **헤더** | :chart_with_upwards_trend: SentinAI Scaling Applied |
| **메시지 내용** | 변경 vCPU (이전 → 목표), 트리거(Cost-based schedule), 예상 절감액 |

스케줄 생성만 되고 실행되지 않은 경우는 알림을 보내지 않습니다.

---

### 2. Verification Failed (검증 실패)

| 항목 | 내용 |
|---|---|
| **이벤트** | `verification-complete` |
| **발생 조건** | `record.executed === true` && `record.passed === false` |
| **쿨다운** | 10분 |
| **헤더** | :warning: SentinAI Action Required — Verification Failed |
| **메시지 내용** | 예상 vCPU vs 실제 관측 vCPU, 상세 사유 |

검증 성공 시에는 알림을 보내지 않습니다. 실패 시에만 Operator 개입을 요청합니다.

---

### 3. EOA Refill 성공

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | `action === 'eoa-refill'` && 모든 refill `success === true` |
| **쿨다운** | 10분 |
| **헤더** | :fuelpump: SentinAI EOA Refill Complete |
| **메시지 내용** | role별 리필 상세 (이전 잔고 → 새 잔고 ETH, tx hash) |

EOA refill은 성공/실패 모두 알림을 보냅니다. Operator가 L1 계정 잔고 변동을 인지해야 하기 때문입니다.

---

### 4. EOA Refill 실패

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | `action === 'eoa-refill'` && 모든 refill `success === false` |
| **쿨다운** | 10분 |
| **헤더** | :rotating_light: SentinAI Action Required — EOA Refill Failed |
| **메시지 내용** | 트리거, 실패 사유, 사유별 가이던스 |

수동 개입이 필요합니다.

#### EOA Refill 실패 사유별 가이던스

| Reason Key | 가이던스 | 조치 |
|---|---|---|
| `treasury-low` | Treasury 지갑 ETH 잔액이 최소값(`EOA_TREASURY_MIN_ETH`) 이하 | Treasury 지갑 충전 |
| `treasury-check-failed` | Treasury 잔액 조회 실패 | L1 RPC 연결 및 엔드포인트 설정 확인 |
| `no-signer` | `TREASURY_PRIVATE_KEY` 환경변수 미설정 | 서명 키 설정 |
| `cooldown` | 리필 쿨다운 기간(`EOA_REFILL_COOLDOWN_MIN`) 중 | 쿨다운 만료 후 자동 재시도 (대기) |
| `daily-limit` | 일일 리필 한도(`EOA_REFILL_MAX_DAILY_ETH`) 도달 | 다음 날 리셋 대기 또는 한도 조정 |
| `gas-high` | L1 가스비가 가드 임계값(`EOA_GAS_GUARD_GWEI`) 초과 | 가스비 하락 시 자동 재시도 (대기) |
| `tx-reverted` | 리필 트랜잭션 revert | Treasury 잔액 및 대상 EOA 주소 확인 |
| `tx-timeout` | 리필 트랜잭션 timeout | L1 네트워크 상태 확인 |

---

### 5. EOA Refill 부분 실패

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | `action === 'eoa-refill'` && 성공/실패 혼재 |
| **쿨다운** | 10분 |
| **헤더** | :warning: SentinAI EOA Refill — Partial Failure |
| **메시지 내용** | role별 성공/실패 상세 |

복수 EOA에 대해 일부만 성공한 경우입니다.

---

### 6. L1 RPC Failover 성공

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | `action === 'l1-failover'` && `success === true` |
| **쿨다운** | 10분 |
| **헤더** | :white_check_mark: SentinAI L1 RPC Failover Complete |
| **메시지 내용** | Failover 상세 내용 |

Operator가 엔드포인트 전환 결과를 인지해야 하므로 성공 시에도 알림합니다.

---

### 7. L1 RPC Failover 실패

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | `action === 'l1-failover'` && `success === false` |
| **쿨다운** | 10분 |
| **헤더** | :rotating_light: SentinAI Action Required — L1 RPC Failover Failed |
| **메시지 내용** | 실패 상세 내용 |

수동 개입이 필요합니다.

---

### 8. Remediation Failed (기타 자동 복구 실패)

| 항목 | 내용 |
|---|---|
| **이벤트** | `remediation-complete` |
| **발생 조건** | EOA refill, L1 failover가 아닌 일반 remediation에서 `failureCount > 0` |
| **쿨다운** | 10분 |
| **헤더** | :rotating_light: SentinAI Action Required — Remediation Failed |
| **메시지 내용** | 트리거, 실패 action 목록, 실패 사유별 가이던스 |

---

### 9. Proxyd Backend Replaced (프록시 백엔드 교체)

| 항목 | 내용 |
|---|---|
| **이벤트** | `reliability-issue` |
| **발생 조건** | `issue.type === 'proxyd-backend-replaced'` |
| **쿨다운** | 5분 |
| **헤더** | :arrows_counterclockwise: SentinAI L1 Proxyd Backend Replaced |
| **메시지 내용** | 교체된 백엔드 상세 |

L1 RPC health-check 실패(`l1-rpc-unhealthy`, `l1-consecutive-failures`)는 알림을 보내지 않습니다. Auto-failover가 처리하며, 그 결과(케이스 6, 7)로만 알림됩니다.

---

## 알림 억제(Suppressed) 케이스

아래 이벤트는 에이전트가 자율 처리하므로 Slack 알림을 보내지 않습니다.

| 케이스 | 억제 사유 |
|---|---|
| Cost insight (스케줄 생성만, 미실행) | Cost Agent가 자동 적용 |
| 기타 Remediation 성공 (EOA refill, L1 failover 제외) | 에이전트 자동 처리 완료 |
| L1 RPC health-check 실패 | Auto-failover가 처리, failover 결과만 알림 |
| Verification 성공 | 정상 동작 확인, 알림 불필요 |
| Scaling schedule 생성 (미실행) | 실행 시점에만 알림 |

---

## 쿨다운 요약

| 이벤트 타입 | 쿨다운 |
|---|---|
| `scaling-recommendation` | 1시간 |
| `verification-complete` | 10분 |
| `remediation-complete` | 10분 |
| `reliability-issue` | 5분 |
| 기타 (기본값) | 10분 |

동일 이벤트 타입의 알림이 쿨다운 내에 재발생하면 억제됩니다.

---

## Webhook 설정

Slack 알림을 받으려면 다음 중 하나를 설정해야 합니다:

1. **Redis Store**: `alertConfig.webhookUrl`에 Slack Incoming Webhook URL 저장
2. **환경변수**: `ALERT_WEBHOOK_URL`에 Slack Incoming Webhook URL 설정

Redis Store 설정이 우선 적용되며, 실패 시 환경변수로 fallback합니다. Webhook 타임아웃은 5초입니다.
