# 프로덕션 부하 테스트 & 스케일링 검증 가이드

라이브 K8s 클러스터에서 SentinAI의 자율 스케일링을 검증하기 위한 실제 부하 주입 가이드.

---

## 왜 Seed API를 쓸 수 없나?

seed API (`POST /api/metrics/seed`)는 프로덕션 클러스터에서 사용할 수 없습니다:

1. **프로덕션에서 차단됨** — `NODE_ENV=production`일 때 `405` 반환
2. **에이전트 루프가 덮어씀** — 30초마다 에이전트 루프가 실제 RPC 메트릭을 수집하여 주입된 데이터 대체
3. **스케일링이 실시간 데이터 사용** — 결정 엔진이 저장된 seed 데이터가 아닌 실시간 메트릭을 평가

**해결책**: 실제 L2 부하를 생성하여 CPU, 가스 및 txPool 메트릭을 자연스럽게 증가시킵니다.

---

## 사전 조건

### 클러스터 접근

```bash
# kubectl 컨텍스트 검증
kubectl config current-context
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia

# SentinAI 실행 확인
curl -s http://<SENTINAI_HOST>:3002/api/health
```

### 지갑 설정

트랜잭션 전송을 위해 테스트넷 ETH가 있는 L2 지갑이 필요합니다.

```bash
# Foundry 설치 (설치되지 않은 경우)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# L2에서 잔액 확인
cast balance <YOUR_WALLET_ADDRESS> --rpc-url $L2_RPC_URL
```

### 환경 설정

`.env.local`에 다음 항목이 있어야 합니다:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-...

# 중요: 실제 스케일링을 위해 이것들을 설정해야 함
SCALING_SIMULATION_MODE=false    # 실제 K8s 패치 허용
AGENT_LOOP_ENABLED=true          # 서버 측 자율 루프
```

---

## 단계 0: 사전 점검

부하 주입 전 현재 상태를 검증합니다.

```bash
BASE=http://localhost:3002

# 1. 현재 스케일링 상태
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  autoScaling: .autoScalingEnabled,
  simulationMode: .simulationMode,
  cooldown: .cooldownRemaining
}'

# 2. 에이전트 루프 상태
curl -s $BASE/api/health

# 3. Pod 리소스 상태 검증
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
```

**예상 결과**: `currentVcpu: 1`, `autoScaling: true`, `simulationMode: false`

### 자동 스케일링 활성화 (비활성화된 경우)

```bash
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true, "simulationMode": false}'
```

---

## 단계 1: 스케일링 트리거 이해

에이전트 루프는 30초마다 **하이브리드 스코어(0–100)**를 평가합니다:

| 요소 | 가중치 | 스코어 계산 | 최대값 |
|------|--------|-----------|--------|
| CPU 사용률 | 30% | `cpuUsage` (0–100%) | 100 |
| 가스 비율 | 30% | `gasUsedRatio` × 100 | 100 |
| TxPool 대기 중 | 20% | `txPoolPending / 200` × 100 | 100 |
| AI 심각도 | 20% | 심각도 매핑 | 100 |

**스케일링 임계값:**

| 스코어 범위 | 대상 vCPU | 레이블 |
|-----------|---------|--------|
| 0 – 29 | 1 vCPU | Idle |
| 30 – 69 | 2 vCPU | Normal |
| 70 – 100 | 4 vCPU | High |

**핵심 인사이트**: 1 → 2 vCPU로 확장하려면 하이브리드 스코어 ≥ 30이 필요합니다. 4 vCPU에 도달하려면 ≥ 70이 필요합니다.

### 스코어 예제

| 시나리오 | CPU | 가스 | TxPool | AI | 스코어 | 대상 |
|---------|-----|------|--------|---|--------|------|
| Idle | 10% | 0.1 | 5 | — | 10×0.3 + 10×0.3 + 2.5×0.2 = 6.5 | 1 vCPU |
| Moderate | 50% | 0.5 | 100 | — | 50×0.3 + 50×0.3 + 50×0.2 = 40 | 2 vCPU |
| Heavy | 80% | 0.8 | 200 | high | 80×0.3 + 80×0.3 + 100×0.2 + 66×0.2 = 81.2 | 4 vCPU |

---

## 단계 2: 실제 부하 주입

### 방법 A: `cast`로 버스트 트랜잭션 (가장 간단함)

txPool을 채우고 가스 사용량을 증가시키기 위해 많은 트랜잭션을 빠르게 전송합니다.

```bash
#!/bin/bash
# load-burst.sh — L2에 버스트 트랜잭션 전송
RPC_URL="${L2_RPC_URL}"
PRIVATE_KEY="${LOAD_TEST_PRIVATE_KEY}"
TO_ADDRESS="0x000000000000000000000000000000000000dead"

echo "=== 버스트 부하 테스트 시작 ==="
echo "Target: $RPC_URL"

# 200개 트랜잭션 전송 (스케일링 트리거를 위해 txPool 채우기)
for i in $(seq 1 200); do
  cast send $TO_ADDRESS \
    --value 0.00001ether \
    --private-key $PRIVATE_KEY \
    --rpc-url $RPC_URL \
    --async \
    2>/dev/null &

  # 20개씩 배치
  if (( i % 20 == 0 )); then
    wait
    echo "전송: $i / 200 트랜잭션"
  fi
done
wait
echo "=== 버스트 완료 ==="
```

**작동 원리**: 200+ 대기 중인 트랜잭션 → txPoolScore = 100 → 20포인트 기여. 처리에서 나온 가스 사용량과 함께 → 확장 업 트리거.

### 방법 B: `viem` 스크립트로 지속적 부하

지속적이고 구성 가능한 부하를 위한 Node.js 스크립트를 작성합니다.

```typescript
// scripts/load-test.ts
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimismSepolia } from 'viem/chains'; // 또는 L2 체인

const RPC_URL = process.env.L2_RPC_URL!;
const PRIVATE_KEY = process.env.LOAD_TEST_PRIVATE_KEY as `0x${string}`;
const TARGET = '0x000000000000000000000000000000000000dead' as const;

// 설정
const TPS = 10;          // 초당 트랜잭션 수
const DURATION_SEC = 120; // 지속적 부하 2분
const VALUE = parseEther('0.00001');

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });

  let nonce = await publicClient.getTransactionCount({ address: account.address });
  let sent = 0;
  const startTime = Date.now();

  console.log(`지속적 부하 시작: ${TPS} TPS for ${DURATION_SEC}s`);

  const interval = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed >= DURATION_SEC) {
      clearInterval(interval);
      console.log(`\n완료: ${sent} 트랜잭션 in ${elapsed.toFixed(0)}s`);
      return;
    }

    // 배치 전송
    const promises = [];
    for (let i = 0; i < TPS; i++) {
      promises.push(
        client.sendTransaction({
          to: TARGET,
          value: VALUE,
          nonce: nonce++,
        }).catch(() => {}) // 개별 실패 무시
      );
    }
    await Promise.allSettled(promises);
    sent += TPS;
    process.stdout.write(`\r  전송: ${sent} txs | 경과: ${elapsed.toFixed(0)}s`);
  }, 1000);
}

main().catch(console.error);
```

```bash
# ts-node 또는 tsx로 실행
npx tsx scripts/load-test.ts
```

### 방법 C: 무거운 계산 (가스 최대화)

`gasUsedRatio`를 최대화하기 위해 무거운 계산을 수행하는 컨트랙트를 배포합니다.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract GasBurner {
    uint256 public counter;

    // 약 `iterations * 20000` 가스를 소모
    function burn(uint256 iterations) external {
        for (uint256 i = 0; i < iterations; i++) {
            counter = uint256(keccak256(abi.encodePacked(counter, i, block.timestamp)));
        }
    }
}
```

```bash
# 배포
forge create GasBurner --rpc-url $L2_RPC_URL --private-key $LOAD_TEST_PRIVATE_KEY

# burn() 반복 호출 (높은 가스 소비)
CONTRACT=<deployed_address>
for i in $(seq 1 50); do
  cast send $CONTRACT "burn(uint256)" 500 \
    --rpc-url $L2_RPC_URL \
    --private-key $LOAD_TEST_PRIVATE_KEY \
    --async &
done
wait
```

---

## 단계 3: 에이전트 루프 응답 모니터링

부하가 주입되면 에이전트 루프는 30~60초 내에 변화를 감지해야 합니다.

### 서버 로그 감시

```bash
# 로컬에서 실행 중인 경우
npm run dev 2>&1 | grep -E '\[AgentLoop\]|\[Detection\]'

# 예상 로그 진행:
# [AgentLoop] Cycle complete — score: 45.2, target: 2 vCPU
# [AgentLoop] Predictive override: 1 → 2 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### Scaler API 폴링

```bash
# 10초마다 루프로 실행
while true; do
  echo "--- $(date +%H:%M:%S) ---"
  curl -s $BASE/api/scaler | jq '{
    vcpu: .currentVcpu,
    autoScaling: .autoScalingEnabled,
    simulation: .simulationMode,
    cooldown: .cooldownRemaining,
    prediction: (if .prediction then {
      trend: .prediction.trend,
      predicted: .prediction.predictedVcpu,
      confidence: .prediction.confidence,
      action: .prediction.recommendedAction
    } else "waiting for data" end)
  }'
  sleep 10
done
```

### 메트릭 + 이상 폴링

```bash
curl -s $BASE/api/metrics | jq '{
  cpu: .metrics.cpuUsage,
  gas: .metrics.gasUsedRatio,
  txPool: .metrics.txPoolCount,
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[]? | {metric, zScore: (.zScore | . * 100 | round / 100)}]
}'
```

---

## 단계 4: 실제 K8s 스케일링 검증

에이전트 루프가 스케일링을 트리거한 후 StatefulSet이 패치되었는지 검증합니다.

```bash
# StatefulSet 리소스 확인
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq .

# 확장 업 후 예상:
# {
#   "limits": { "cpu": "2", "memory": "4Gi" },
#   "requests": { "cpu": "2", "memory": "4Gi" }
# }

# Pod 롤아웃 감시
kubectl rollout status statefulset/sepolia-thanos-stack-op-geth -n thanos-sepolia

# Pod 상태 확인
kubectl get pods -n thanos-sepolia -l app=op-geth -o wide
```

### SentinAI API를 통해 검증

```bash
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastScaling: .lastScalingTime,
  history: [.history[]? | {time: .timestamp, from: .fromVcpu, to: .toVcpu, trigger: .triggeredBy}]
}'
```

---

## 단계 5: 확장 다운 검증 (복구)

부하가 중단된 후 시스템은 쿨다운 기간(300초) 이후에 축소되어야 합니다.

```bash
# 1. 부하 주입 중지 (스크립트 종료)

# 2. 쿨다운 대기 (5분)
echo "쿨다운 5분 대기 중..."
sleep 300

# 3. 확인 — 에이전트 루프가 낮은 부하를 감지하고 축소해야 함
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastDecision: .lastDecision | {score, reason, targetVcpu}
}'

# 4. K8s 상태 검증
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
# 예상: "1" (축소됨)
```

---

## 단계 6: 전체 E2E 검증 스크립트

전체 흐름을 실행하는 자동화 스크립트:

```bash
#!/bin/bash
# scripts/verify-scaling-e2e.sh
set -euo pipefail

BASE="${SENTINAI_URL:-http://localhost:3002}"
RPC_URL="${L2_RPC_URL:?L2_RPC_URL required}"
PRIVATE_KEY="${LOAD_TEST_PRIVATE_KEY:?LOAD_TEST_PRIVATE_KEY required}"
TO="0x000000000000000000000000000000000000dead"

echo "========================================="
echo " SentinAI Scaling E2E Verification"
echo "========================================="

# Phase 0: 사전 점검
echo ""
echo "=== Phase 0: 사전 점검 ==="
STATE=$(curl -s $BASE/api/scaler)
VCPU=$(echo $STATE | jq -r '.currentVcpu')
SIM=$(echo $STATE | jq -r '.simulationMode')
AUTO=$(echo $STATE | jq -r '.autoScalingEnabled')

echo "  현재 vCPU: $VCPU"
echo "  시뮬레이션:   $SIM"
echo "  자동 스케일링: $AUTO"

if [ "$SIM" = "true" ]; then
  echo "  [!] 시뮬레이션 모드가 켜짐. 실제 모드 활성화 중..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"simulationMode": false, "autoScalingEnabled": true}' > /dev/null
  echo "  [OK] 실제 모드 활성화됨"
fi

if [ "$AUTO" = "false" ]; then
  echo "  [!] 자동 스케일링 비활성화됨. 활성화 중..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"autoScalingEnabled": true}' > /dev/null
  echo "  [OK] 자동 스케일링 활성화됨"
fi

INITIAL_VCPU=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
echo "  초기 vCPU: $INITIAL_VCPU"

# Phase 1: 부하 주입
echo ""
echo "=== Phase 1: 부하 주입 (200개 트랜잭션) ==="
for i in $(seq 1 200); do
  cast send $TO --value 0.00001ether --private-key $PRIVATE_KEY --rpc-url $RPC_URL --async 2>/dev/null &
  if (( i % 50 == 0 )); then
    wait
    echo "  전송: $i / 200"
  fi
done
wait
echo "  [OK] 부하 주입 완료"

# Phase 2: 에이전트 루프 대기
echo ""
echo "=== Phase 2: 에이전트 루프 대기 (최대 120초) ==="
TIMEOUT=120
ELAPSED=0
SCALED=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  CURRENT=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
  echo "  [$ELAPSED s] vCPU: $CURRENT"

  if [ "$CURRENT" != "$INITIAL_VCPU" ]; then
    echo "  [OK] 확장 업 감지됨: $INITIAL_VCPU → $CURRENT vCPU"
    SCALED=true
    break
  fi
done

if [ "$SCALED" = "false" ]; then
  echo "  [FAIL] ${TIMEOUT}초 내에 스케일링 없음"
  echo "  서버 로그 확인: 콘솔 출력에서 '[AgentLoop]' grep"
  exit 1
fi

# Phase 3: K8s 패치 검증
echo ""
echo "=== Phase 3: K8s StatefulSet 검증 ==="
K8S_CPU=$(kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || echo "unknown")
echo "  K8s CPU 요청: $K8S_CPU"

ROLLOUT=$(kubectl rollout status statefulset/sepolia-thanos-stack-op-geth \
  -n thanos-sepolia --timeout=120s 2>&1 || echo "timeout")
echo "  롤아웃: $ROLLOUT"

# Phase 4: 이상 탐지 확인
echo ""
echo "=== Phase 4: 이상 탐지 상태 ==="
curl -s $BASE/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[]? | {metric, zScore: (.zScore * 100 | round / 100)}]
}'

# Phase 5: 요약
echo ""
echo "========================================="
echo " 결과"
echo "========================================="
FINAL_STATE=$(curl -s $BASE/api/scaler)
echo "  초기 vCPU:  $INITIAL_VCPU"
echo "  최종 vCPU:    $(echo $FINAL_STATE | jq -r '.currentVcpu')"
echo "  마지막 스케일링:  $(echo $FINAL_STATE | jq -r '.lastScalingTime')"
echo "  시뮬레이션:    $(echo $FINAL_STATE | jq -r '.simulationMode')"
echo ""
echo "  확장 다운 검증하려면: 5분 대기 후 vCPU 재확인"
echo "========================================="
```

```bash
chmod +x scripts/verify-scaling-e2e.sh
SENTINAI_URL=http://localhost:3002 \
  L2_RPC_URL=https://your-rpc.com \
  LOAD_TEST_PRIVATE_KEY=0xabc... \
  bash scripts/verify-scaling-e2e.sh
```

---

## 안전성 & 롤백

### 긴급 롤백

```bash
# 1. 즉시 자동 스케일링 비활성화
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": false}'

# 2. 시뮬레이션 모드 재활성화
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": true}'

# 3. 수동 K8s 롤백 (필요시)
kubectl patch statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  --type='json' -p='[
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"2Gi"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"2Gi"}
  ]'
```

### 안전 체크리스트

| 항목 | 확인 |
|------|------|
| 부하 테스트 지갑이 제한된 자금을 가짐 | 실수로 인한 비용 초과 방지 |
| `maxVcpu: 4` 스케일링 설정 | 무제한 확장 업 방지 |
| 쿨다운: 300초 | 급속 진동 방지 |
| K8s 리소스 쿼터 설정됨 | 클러스터 수준 보호 |
| 모니터링 활성화됨 | 테스트 중 `kubectl top pods` 감시 |

### 비용 인식

| vCPU | 메모리 | Fargate 비용 (Seoul) |
|------|--------|---------------------|
| 1 | 2 GiB | $0.057/시간 |
| 2 | 4 GiB | $0.114/시간 |
| 4 | 8 GiB | $0.227/시간 |

1 → 4 vCPU로 확장하면 시간당 비용이 ~4배 증가합니다. 확장 다운이 검증되었는지 확인하세요.

---

## 문제 해결

### 스케일링이 트리거되지 않음

```bash
# 하이브리드 스코어 계산 확인
curl -s $BASE/api/scaler | jq '.lastDecision | {score, reason, breakdown}'
```

- **Score < 30**: 부하가 충분하지 않습니다. 트랜잭션 볼륨을 증가시키세요.
- **Score ≥ 30이지만 스케일링 없음**: `autoScalingEnabled`, `simulationMode` 및 쿨다운을 확인하세요.

### 에이전트 루프가 실행되지 않음

```bash
# 서버 로그에서 cron 초기화 확인
# 찾기: [Scheduler] Agent loop started (every 30s)

# 환경 검증
echo $AGENT_LOOP_ENABLED  # "true"이거나 L2_RPC_URL이 설정되어야 함
```

### K8s 패치 실패

```bash
# kubectl 접근 수동으로 테스트
kubectl auth can-i patch statefulsets -n thanos-sepolia

# RBAC 확인
kubectl get clusterrolebinding | grep sentinai
```

### 트랜잭션 실패

```bash
# 지갑 잔액 확인
cast balance $WALLET_ADDRESS --rpc-url $L2_RPC_URL

# Nonce 확인
cast nonce $WALLET_ADDRESS --rpc-url $L2_RPC_URL

# 체인 ID 확인
cast chain-id --rpc-url $L2_RPC_URL
```
