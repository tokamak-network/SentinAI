# SentinAI 프로덕션 전환 계획

> **TODO**: 이 문서는 `docs/todo/production-transition-roadmap.md`로 이동하여 향후 프로덕션 배포 시 참조할 수 있도록 해야 합니다.

## Context

SentinAI는 현재 개발/테스트 환경에서 시뮬레이션 모드로 운영 중입니다. 실제 프로덕션 환경에서 자율 스케일링을 수행하려면, 시뮬레이션 기능을 최소화하고 실제 K8s 클러스터와 L2 RPC에 대한 스케일링 권한을 부여해야 합니다.

**프로덕션 전환의 목표**:
- Seed scenario 및 Stress mode 같은 개발 전용 기능 비활성화
- 실제 K8s StatefulSet 스케일링 활성화 (`SCALING_SIMULATION_MODE=false`)
- 30초 Agent Loop 자율 실행으로 자동화된 스케일링 달성
- 안전장치 (Circuit Breaker, Rate Limiting, Graceful Degradation) 검증
- 프로덕션 모니터링 및 알림 설정

---

## 현재 상태: 시뮬레이션 모드 분석

### 1. **SCALING_SIMULATION_MODE** (핵심)
- **기본값**: `true` (안전 모드)
- **영향**: K8s 스케일링, L1 RPC Failover, EOA Auto-Refill, Auto-Remediation 모두 dry-run만 실행
- **변경 필요**: `SCALING_SIMULATION_MODE=false`로 설정 시 실제 `kubectl patch` 명령 실행됨

**영향받는 모듈**:
- `src/lib/k8s-scaler.ts` (Line 240-250): kubectl 실행 여부 제어
- `src/lib/l1-rpc-failover.ts` (Line 703): StatefulSet env 업데이트 스킵
- `src/lib/eoa-balance-monitor.ts` (Line 82): 트랜잭션 전송 차단
- `src/lib/remediation-engine.ts` (Line 35-37): 자동 복구 액션 차단

### 2. **Seed Scenario System** (개발 전용)
- **목적**: 실제 RPC 없이 메트릭 시뮬레이션
- **프로덕션 영향**: `NODE_ENV=production`일 때 API 자동 차단 (Line 135 in seed/route.ts)
- **정리 필요**: Redis에 남은 `sentinai:seed:scenario` 키 수동 삭제

### 3. **Stress Mode** (빠른 경로 테스트)
- **목적**: 8 vCPU 부하 시 대시보드 반응 속도 테스트
- **현재 상태**: UI 버튼 비활성화됨 (`page.tsx` Line 638-665)
- **프로덕션 영향**: 특별한 조치 불필요 (수동 호출만 가능)

### 4. **Agent Loop 활성화 조건**
- **기본값**: `L2_RPC_URL` 설정 시 자동 활성화
- **Cooldown**: Development 10초 → Production 300초 (자동 전환)

### 5. **AUTO_REMEDIATION_ENABLED** (Layer 4)
- **기본값**: `false` (안전 모드)
- **권장**: 프로덕션 초기 비활성화 → 안정화 후 단계적 활성화

### 6. **하드코딩된 값** (알려진 제한사항)
- `metrics/route.ts` Line 512: `memoryUsage` fallback = vCPU × 2 × 1024 (추정값)
- `metrics/route.ts` Line 515: `syncLag = 0` (실제 측정 없음)

---

## 프로덕션 요구사항

### 필수 환경 변수 (3개)

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com    # Agent Loop 자동 활성화
ANTHROPIC_API_KEY=sk-ant-...                    # 또는 다른 AI provider (QWEN/OPENAI/GEMINI)
AWS_CLUSTER_NAME=my-cluster-name                # K8s API URL & region 자동 탐지
```

### 실제 스케일링 활성화

```bash
SCALING_SIMULATION_MODE=false    # ⚠️ 기본값 true → false로 변경 필수
```

### AWS IAM 권한

```json
{
  "Effect": "Allow",
  "Action": ["eks:DescribeCluster", "eks:ListClusters", "sts:GetCallerIdentity"],
  "Resource": "arn:aws:eks:REGION:ACCOUNT:cluster/CLUSTER_NAME"
}
```

### EKS RBAC 매핑

EC2 IAM Role을 `aws-auth` ConfigMap에 추가:

```yaml
# kubectl edit configmap aws-auth -n kube-system
mapRoles:
  - rolearn: arn:aws:iam::ACCOUNT:role/EC2_ROLE_NAME
    username: sentinai
    groups:
      - system:masters    # 프로덕션: 최소 권한 ClusterRole 권장
```

### EC2 IMDSv2 Hop Limit (Docker 배포 시)

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-xxx \
  --http-put-response-hop-limit 2    # ≥2 필요
```

### 선택적 환경 변수

| 변수 | 기본값 | 용도 | 필수 여부 |
|------|--------|------|----------|
| `REDIS_URL` | 미설정 (InMemory) | 일일 보고서, 비용 분석, 다중 워커 | 선택 |
| `ALERT_WEBHOOK_URL` | — | Slack 이상 탐지 알림 | 선택 |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 자동 복구 | 신중하게 활성화 |
| `L1_RPC_URLS` | publicnode.com | L1 RPC failover (SentinAI 모니터링용) | 선택 |
| `BATCHER_EOA_ADDRESS` | — | Batcher 잔액 모니터링 | 선택 |
| `PROPOSER_EOA_ADDRESS` | — | Proposer 잔액 모니터링 | 선택 |
| `TREASURY_PRIVATE_KEY` | — | EOA 자동 충전 (monitor-only는 생략) | 선택 |

---

## 전환 로드맵

### Phase 0: 사전 준비 (1일)

**목표**: 프로덕션 환경 검증 및 안전장치 확인

**작업**:
1. **K8s 접근 검증**
   ```bash
   kubectl config current-context
   kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia
   kubectl auth can-i patch statefulsets -n thanos-sepolia
   ```

2. **IAM & RBAC 검증**
   - EC2 IAM Role에 EKS 권한 확인
   - `aws-auth` ConfigMap 매핑 확인
   - IMDSv2 hop-limit ≥ 2 확인

3. **AI Provider 테스트**
   ```bash
   # 개발 환경에서 AI 호출 테스트
   curl -s http://localhost:3002/api/scaler | jq '.prediction'
   ```

4. **Redis 설정 (선택사항)**
   - 일일 보고서/비용 분석 필요 시 Redis 설정
   - 가이드: `docs/guide/redis-setup.md`

**검증 기준**:
- kubectl 명령 성공
- AI prediction 응답 정상
- (선택) Redis 연결 확인

---

### Phase 1: 시뮬레이션 모드 전환 (1시간)

**목표**: 실제 스케일링 활성화하되 수동 트리거만 허용

**작업**:
1. **환경 변수 업데이트**
   ```bash
   # .env.local
   SCALING_SIMULATION_MODE=false    # 실제 K8s 패치 허용
   AGENT_LOOP_ENABLED=false          # 자동 루프 비활성화 (수동 테스트용)
   AUTO_REMEDIATION_ENABLED=false    # Layer 4 비활성화 유지
   NODE_ENV=production                # Cooldown 5분, Seed API 차단
   ```

2. **Redis 정리 (seed 데이터 제거)**
   ```bash
   redis-cli DEL sentinai:seed:scenario
   ```

3. **서버 재시작**
   ```bash
   # Docker
   docker compose restart sentinai

   # 로컬
   npm run build && npm run start
   ```

4. **수동 스케일링 테스트**
   ```bash
   # 1 → 2 vCPU 스케일링 수동 트리거
   curl -sX POST http://localhost:3002/api/scaler \
     -H "Content-Type: application/json" \
     -d '{"targetVcpu": 2}'

   # K8s StatefulSet 검증
   kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
     -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
   ```

**성공 기준**:
- API 응답: `"simulationMode": false`
- kubectl 명령 실제 실행됨 (StatefulSet CPU: "1" → "2")
- Pod 롤아웃 완료 (`kubectl rollout status`)

**롤백 방법**:
```bash
# 즉시 시뮬레이션 모드 재활성화
curl -sX PATCH http://localhost:3002/api/scaler \
  -d '{"simulationMode": true, "autoScalingEnabled": false}'
```

---

### Phase 2: 자동 스케일링 활성화 (2시간)

**목표**: Agent Loop 활성화하여 30초마다 자율 스케일링 수행

**작업**:
1. **Agent Loop 활성화**
   ```bash
   # .env.local
   AGENT_LOOP_ENABLED=true    # 또는 L2_RPC_URL 설정 시 자동 활성화
   ```

2. **서버 재시작**
   ```bash
   docker compose restart sentinai
   ```

3. **Agent Loop 동작 확인**
   ```bash
   # 서버 로그 확인
   docker compose logs -f sentinai | grep -E '\[AgentLoop\]|\[Detection\]'

   # 예상 로그:
   # [AgentLoop] Cycle complete — score: 15.2, target: 1 vCPU
   # [AgentLoop] No scaling needed (within threshold)
   ```

4. **실제 부하 주입 (검증)**
   - 가이드: `docs/guide/production-load-testing-guide.md`
   - 방법: `cast send` 버스트 트랜잭션 (200개)
   - 예상: 30~60초 내 1 → 2 vCPU 자동 스케일링

5. **스케일 다운 검증**
   - 부하 중단 후 5분 대기 (cooldown)
   - 예상: 2 → 1 vCPU 자동 축소

**성공 기준**:
- Agent Loop가 30초마다 실행됨
- 하이브리드 스코어 ≥ 30일 때 자동 확장 업
- Cooldown 300초 후 자동 축소
- K8s StatefulSet이 실제로 패치됨

**주의사항**:
- 초기 24시간은 자주 모니터링 (급속 진동 방지)
- 비용 추적: 1 vCPU ($42/월) → 4 vCPU ($166/월)

---

### Phase 3: 모니터링 & 알림 설정 (2시간)

**목표**: 프로덕션 가시성 확보

**작업**:
1. **Slack Webhook 설정 (선택)**
   ```bash
   # .env.local
   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```

   - Layer 3 이상 anomaly 탐지 시 Slack 알림
   - Cooldown: 동일 type 10분 재전송 방지

2. **Healthcheck 검증**
   ```bash
   # Docker healthcheck (자동 실행 중)
   curl http://localhost:3002/api/health
   # 예상: {"status":"ok","timestamp":"..."}
   ```

3. **대시보드 접근 설정**
   - **로컬 접근**: `http://<EC2_IP>:3002`
   - **HTTPS + Auth**: Cloudflare Tunnel (가이드: `README.md` Line 219-259)

4. **주요 모니터링 포인트**
   ```bash
   # 1. Agent Loop 상태
   curl -s http://localhost:3002/api/metrics | jq '.agentLoopState | {
     lastCycleTime,
     recentCycles: (.recentCycles[-3:] | map({
       phase,
       score: .scaling.score,
       vcpu: .scaling.targetVcpu,
       executed: .scaling.executed
     }))
   }'

   # 2. Scaling 이력
   curl -s http://localhost:3002/api/scaler | jq '.history[-5:]'

   # 3. L1 RPC Failover 이벤트
   curl -s http://localhost:3002/api/l1-failover | jq '.events[-5:]'

   # 4. Circuit Breaker 상태 (Auto-Remediation)
   curl -s http://localhost:3002/api/remediation | jq '.circuitBreakers'
   ```

**성공 기준**:
- Slack 알림 테스트 성공
- 대시보드 접근 가능 (HTTPS 권장)
- 4가지 모니터링 포인트 정상 응답

---

### Phase 4: 고급 기능 활성화 (단계적, 1주 ~ 1개월)

**목표**: EOA 모니터링, Auto-Remediation 등 고급 기능 단계적 활성화

#### 4.1. EOA Balance Auto-Refill (1주차)

```bash
# .env.local
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
TREASURY_PRIVATE_KEY=0x...           # 자동 충전용
EOA_BALANCE_CRITICAL_ETH=0.1         # 임계값
EOA_REFILL_AMOUNT_ETH=0.5            # 충전량
EOA_MAX_DAILY_REFILL_ETH=5           # 일일 한도
EOA_GAS_GUARD_GWEI=100               # 가스비 100 gwei 초과 시 충전 중지
```

**검증**:
```bash
curl -s http://localhost:3002/api/eoa-balance | jq '{
  batcher: .batcher | {balance, level, needsRefill},
  proposer: .proposer | {balance, level, needsRefill}
}'
```

#### 4.2. Auto-Remediation (2주차, 신중하게)

```bash
# .env.local
AUTO_REMEDIATION_ENABLED=true
REMEDIATION_ALLOW_GUARDED=true       # Guarded 레벨 허용 (Pod 재시작 등)
REMEDIATION_COOLDOWN_MIN=5           # 재시도 쿨다운 5분
REMEDIATION_MAX_VCPU=4               # 최대 스케일링 한도
```

**점진적 활성화**:
1. Week 1: 로그만 수집 (실행 안 함)
2. Week 2: Safe 레벨만 허용 (로그 정리, ConfigMap 확인)
3. Week 3: Guarded 레벨 허용 (Pod 재시작)
4. Week 4: Manual confirmation 레벨은 계속 수동 유지

**Circuit Breaker 모니터링**:
```bash
curl -s http://localhost:3002/api/remediation | jq '.circuitBreakers | map({
  playbook,
  isOpen,
  consecutiveFailures,
  resetAt
})'
```

#### 4.3. L1 Proxyd Integration (3주차, Proxyd 사용 시)

```bash
# .env.local (L2 nodes용 L1 RPC 관리)
L1_PROXYD_ENABLED=true
L1_PROXYD_CONFIGMAP_NAME=proxyd-config
L1_PROXYD_DATA_KEY=proxyd.toml
L1_PROXYD_UPSTREAM_GROUP=main
L1_PROXYD_SPARE_URLS=https://spare-rpc1.io,https://spare-rpc2.io
```

**가이드**: `docs/guide/proxyd-failover-setup.md`

---

## 안전장치 & 모니터링 현황

### ✅ 이미 구현된 안전장치

| 영역 | 구현 상태 | 프로덕션 준비 |
|------|----------|-------------|
| **Circuit Breaker** | Layer 4 Auto-Remediation (3회/24h) | ✅ 우수 |
| **Rate Limiting** | L1 RPC (5분), AI (5분), Remediation (시간당 3회) | ⚠️ Agent Loop 미적용 |
| **Graceful Degradation** | 모든 AI 모듈 fallback | ✅ 우수 |
| **Error Handling** | 156 try-catch, 비블로킹 설계 | ✅ 우수 |
| **Configuration Safety** | Simulation Mode, 환경변수 제어 | ✅ 우수 |
| **Input Validation** | K8s 명령 injection 방지 | ✅ 양호 |
| **Monitoring Hooks** | Agent Loop, Failover, Remediation 이력 | ⚠️ Prometheus 없음 |
| **Operational Docs** | 5개 가이드, 긴급 롤백 | ⚠️ 일부 시나리오 부재 |

### ⚠️ 프로덕션 강화 필요 항목

#### Priority 0 (필수, 배포 전 완료)

1. **Prometheus 메트릭 엔드포인트 구현**
   - **문제**: 메트릭이 API JSON으로만 노출, 시계열 DB 연동 불가
   - **해결**: `GET /metrics` 엔드포인트 신규 구현 (Prometheus format)
   - **메트릭 예시**:
     ```
     sentinai_agent_loop_cycles_total{phase="complete"} 1234
     sentinai_scaling_executions_total{vcpu="2",trigger="auto"} 45
     sentinai_ai_errors_total{provider="anthropic",module="rca"} 2
     sentinai_l1_rpc_failures_total{endpoint="publicnode"} 3
     sentinai_circuit_breaker_open{playbook="pod_restart"} 0
     ```

2. **Healthcheck 깊이 개선**
   - **현재**: 단순 OK 반환
   - **필요**: 의존성 체크 (Redis, L1/L2 RPC, K8s API, AI Provider)
   - **예시**:
     ```json
     {
       "status": "healthy",
       "checks": {
         "redis": {"status": "ok", "latency": 2},
         "l1Rpc": {"status": "ok", "activeUrl": "publicnode.com"},
         "l2Rpc": {"status": "ok", "lastBlockTime": "2s ago"},
         "k8sApi": {"status": "ok"},
         "aiProvider": {"status": "ok", "provider": "anthropic"}
       }
     }
     ```

#### Priority 1 (중요, 1주일 내 완료)

3. **Agent Loop Circuit Breaker 추가**
   - **문제**: Agent Loop가 30초마다 무조건 실행 (L2 RPC 장애 시 무한 재시도)
   - **해결**: 5회 연속 실패 시 5분 pause
   - **영향 파일**: `src/lib/agent-loop.ts`

4. **Runbook 보완**
   - **부족한 시나리오**:
     - Redis 장애 복구 → InMemory 상태 확인 방법
     - AI Provider 전환 → 수동 폴백 트리거
     - L1 RPC 전체 장애 → SentinAI 부분 기능 유지 모드
     - Circuit Breaker 수동 리셋 → API 사용 예시
     - Agent Loop 강제 중단 → 비정상 루프 탈출

#### Priority 2 (선택, 안정화 후)

5. **Alerting 임계값 실전 튜닝**
   - **현재**: 하드코딩 (Z_SCORE_THRESHOLD=2.5, circuitBreakerThreshold=3)
   - **필요**: 1주일 실제 워크로드 데이터로 false positive/negative 최소화

6. **Disaster Recovery 문서**
   - 전체 K8s 클러스터 장애 시 SentinAI 복구 순서
   - Redis 데이터 유실 시 복구 가능한 상태 범위
   - 모든 AI Provider 동시 장애 시 대체 전략

---

## 검증 절차

### 자동화 E2E 검증 스크립트

**파일**: `scripts/verify-scaling-e2e.sh` (이미 존재)

```bash
chmod +x scripts/verify-scaling-e2e.sh
SENTINAI_URL=http://localhost:3002 \
  L2_RPC_URL=https://your-rpc.com \
  LOAD_TEST_PRIVATE_KEY=0xabc... \
  bash scripts/verify-scaling-e2e.sh
```

**6-Phase 검증**:
1. Phase 0: 사전 점검 (vCPU, simulation, auto-scaling)
2. Phase 1: 부하 주입 (200개 트랜잭션)
3. Phase 2: Agent Loop 대기 (120초 내 스케일링)
4. Phase 3: K8s StatefulSet 검증
5. Phase 4: 이상 탐지 상태 확인
6. Phase 5: 확장 다운 검증 (5분 후)

**성공 기준**:
- 초기 1 vCPU → 부하 주입 후 2 vCPU (120초 내)
- K8s StatefulSet CPU requests: "1" → "2"
- Pod 롤아웃 완료
- 5분 후 자동 축소: 2 vCPU → 1 vCPU

### 수동 검증 체크리스트

| 항목 | 검증 방법 | 성공 기준 |
|------|----------|----------|
| **Simulation Mode OFF** | `curl /api/scaler \| jq .simulationMode` | `false` |
| **Agent Loop 활성화** | 서버 로그 grep `[AgentLoop]` | 30초마다 cycle 로그 |
| **실제 K8s 패치** | `kubectl get sts` | CPU requests 변경됨 |
| **Cooldown 300초** | 연속 2회 스케일링 시도 | 5분 대기 필요 |
| **AI Fallback** | AI Provider 비활성화 테스트 | 통계 기반 결정 계속 |
| **L1 RPC Failover** | publicnode rate limit 도달 | 자동 다음 endpoint 전환 |
| **Slack 알림** | anomaly 수동 트리거 | Slack 메시지 수신 |
| **Redis 영속성** | 서버 재시작 후 상태 확인 | 스케일링 이력 유지 (Redis 사용 시) |

---

## 긴급 롤백 프로시저

### Rollback Step 1: 자동 스케일링 즉시 중지

```bash
BASE=http://localhost:3002

# 자동 스케일링 비활성화 + 시뮬레이션 모드 재활성화
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": false, "simulationMode": true}'
```

### Rollback Step 2: K8s 수동 롤백 (필요 시)

```bash
# StatefulSet을 1 vCPU / 2 GiB로 강제 복원
kubectl patch statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  --type='json' -p='[
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"2Gi"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"2Gi"}
  ]'

# 롤아웃 완료 대기
kubectl rollout status statefulset/sepolia-thanos-stack-op-geth -n thanos-sepolia
```

### Rollback Step 3: Agent Loop 중지 (선택)

```bash
# .env.local 수정
AGENT_LOOP_ENABLED=false

# 서버 재시작
docker compose restart sentinai
```

---

## 비용 영향 분석

### AWS Fargate 비용 (Seoul ap-northeast-2)

| vCPU | Memory | 시간당 비용 | 월간 비용 (730h) |
|------|--------|-----------|-----------------|
| 1 | 2 GiB | $0.057 | $42 |
| 2 | 4 GiB | $0.114 | $83 |
| 4 | 8 GiB | $0.227 | $166 |

**자동 스케일링 예상 절감**:
- **Before**: 항상 4 vCPU 유지 → $166/월
- **After**: Idle 1 vCPU (60% 시간) + Normal 2 vCPU (30%) + High 4 vCPU (10%)
  - 평균 vCPU: `1 × 0.6 + 2 × 0.3 + 4 × 0.1 = 1.6 vCPU`
  - 월간 비용: $42 × 1.6 = **$67**
  - **절감**: $166 - $67 = **$99/월 (60% 절감)**

---

## 주요 파일 참조

| 파일 | 역할 | 확인 항목 |
|------|------|----------|
| `src/lib/agent-loop.ts` | 30초 자율 루프 | `isAgentLoopEnabled()` |
| `src/lib/k8s-scaler.ts` | K8s 스케일링 실행 | `isSimulationMode()` 체크 |
| `src/lib/scaling-decision.ts` | 하이브리드 스코어 계산 | 임계값 (30, 70) |
| `src/lib/l1-rpc-failover.ts` | L1 RPC 자동 전환 | 연속 실패 카운터 (3회, 10회) |
| `src/lib/remediation-engine.ts` | Layer 4 자동 복구 | Circuit Breaker (3회/24h) |
| `src/types/scaling.ts` | 설정 상수 | cooldownSeconds (10→300) |
| `.env.local.sample` | 환경 변수 템플릿 | 필수/선택 항목 |
| `docs/guide/production-load-testing-guide.md` | E2E 검증 가이드 | 6-Phase 프로세스 |

---

## 요약

### 최소 프로덕션 구성 (Phase 1-2, 1일 완료)

```bash
# .env.local
L2_RPC_URL=https://your-l2-rpc.com
ANTHROPIC_API_KEY=sk-ant-xxx
AWS_CLUSTER_NAME=my-cluster
SCALING_SIMULATION_MODE=false    # ⚠️ 핵심
AGENT_LOOP_ENABLED=true
NODE_ENV=production
```

**추가 필요사항**:
- AWS IAM 권한 (EKS DescribeCluster)
- EKS RBAC 매핑 (aws-auth ConfigMap)
- EC2 IMDSv2 hop-limit ≥ 2

### 완전한 프로덕션 구성 (Phase 1-4, 1개월)

위 + 다음 항목:
- Redis (일일 보고서, 비용 분석)
- Slack Webhook (이상 탐지 알림)
- EOA Auto-Refill (L1 가스비 관리)
- Auto-Remediation (단계적 활성화)
- Prometheus 메트릭 엔드포인트 (P0 개선 필요)
- Agent Loop Circuit Breaker (P1 개선 필요)

### 프로덕션 준비도

**현재**: 70% 완료
- ✅ 시뮬레이션 모드 제어
- ✅ Graceful Degradation
- ✅ Circuit Breaker (Remediation)
- ✅ Rate Limiting (L1 RPC, AI)
- ✅ 운영 문서 (5개 가이드)
- ⚠️ Prometheus 메트릭 없음
- ⚠️ Agent Loop Circuit Breaker 없음
- ⚠️ Disaster Recovery 문서 없음

**즉시 배포 가능 조건**:
- Phase 1-2 완료 (시뮬레이션 OFF + Agent Loop ON)
- AUTO_REMEDIATION_ENABLED=false 유지
- 초기 1주일 집중 모니터링

**완전 자율 모드 권장 조건**:
- P0/P1 항목 완료 (Prometheus, Agent Loop CB)
- 1주일 스테이징 검증
- Runbook 보완 완료
