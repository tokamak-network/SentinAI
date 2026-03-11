# Abstract Playbook Layer

> Date: 2026-03-11
> Status: Draft
> Depends on: proposal-32 (Self-Evolving Playbook System)
> Enables: proposal-32가 특정 체인에 종속되지 않고 모든 체인/인프라에서 작동

---

## 0. 코드 현황 (구현 전 확인)

### 이미 존재하는 것 (건드리지 않음)

| 항목 | 위치 | 비고 |
|------|------|------|
| `ChainPlugin.nodeLayer` | `src/chains/types.ts:128` | `'l1' \| 'l2' \| 'both'` |
| `RemediationActionType` | `src/types/remediation.ts` | `restart_pod`, `scale_up`, `switch_l1_rpc` 등 |
| `Playbook` 인터페이스 | `src/types/remediation.ts` | 기존 플레이북 타입, 변경 없음 |
| `AnomalyResult` 필드 | `src/types/anomaly.ts` | `metric`, `value`, `zScore`, `direction`, `rule` |
| `mapMetricToComponent()` | `ChainPlugin` 메서드 | 메트릭 → 컴포넌트 이름 매핑 |

### 추가가 필요한 것

- `ComponentRole` 타입 + `roleMap` 필드 (`ChainPlugin`)
- `MetricCondition` + `AbstractPlaybook` 인터페이스
- `evaluateConditions()` 함수 (playbook-matcher)
- 코어 플레이북 정적 파일 (`src/playbooks/core/`)
- Redis 동적 플레이북 로더

---

## 1. 문제: 플레이북이 체인에 묶여 있다

현재 플레이북은 체인별로 하드코딩된 정적 파일이다.

```
src/chains/thanos/playbooks.ts    ← 'op-geth', 'op-batcher' 하드코딩
src/chains/arbitrum/playbooks.ts  ← 'nitro-sequencer' 하드코딩
src/chains/l1-evm/playbooks.ts    ← 'l1-execution' 하드코딩
```

매칭도 컴포넌트 이름 기반이다:

```typescript
// playbook-matcher.ts (현재)
const candidates = getPlaybooks().filter(p => p.trigger.component === component)
// component = 'op-geth' | 'l1-execution' | ... (체인마다 다른 문자열)
```

결과:
- proposal-32 학습 루프가 생성한 플레이북도 특정 체인 컴포넌트 이름을 알아야 함
- 동일한 장애 패턴(CPU 과부하, sync 지연)이 체인마다 별도 플레이북으로 중복 작성
- 새 체인 추가 = 플레이북 전부 새로 작성

---

## 2. 설계 결정

### 결정 1: `AbstractPlaybook`은 기존 `Playbook`을 대체하지 않는다

```
기존 Playbook       → 그대로 유지, 체인 특화 플레이북에 계속 사용
AbstractPlaybook    → 새로 추가, 코어·동적 플레이북에 사용
playbook-matcher    → 두 타입 모두 조회 (3-레이어)
```

브레이킹 체인지 없음. 기존 체인 플레이북 파일 수정 불필요.

### 결정 2: `AbstractAction`은 기존 `RemediationActionType`을 재사용한다

새 액션 타입 이름을 발명하지 않는다. 기존 `restart_pod`, `scale_up`, `switch_l1_rpc`를 그대로 쓰되, `target`에 `role` 기반 참조를 추가한다.

```typescript
// 기존 RemediationAction.target = RCAComponent (문자열 'op-geth')
// 추가:
interface AbstractRemediationAction extends RemediationAction {
  targetRole?: ComponentRole  // role 기반 참조 (roleMap으로 resolve)
}
// targetRole이 있으면 executor가 roleMap으로 실제 컴포넌트 이름으로 변환
// target (기존 문자열)과 targetRole 중 하나만 사용
```

### 결정 3: AbstractPlaybook은 컴포넌트 필터 없이 조건만으로 매칭한다

기존 `Playbook`은 `trigger.component`로 먼저 필터링한다.
`AbstractPlaybook`은 `MetricCondition[]`만으로 매칭한다. 컴포넌트 식별은 조건 내 metric으로 암묵적으로 이루어진다.

---

## 3. 타입 정의

### 3.1 ComponentRole

```typescript
// src/playbooks/types.ts (신규 파일)

export type ComponentRole =
  | 'tx-submitter'          // op-batcher, nitro-batcher, zk-batcher
  | 'block-producer'        // op-geth (sequencer), nitro-sequencer, l1 geth/reth
  | 'state-root-poster'     // op-proposer, nitro-validator, zk-state-keeper
  | 'proof-generator'       // op-challenger (fault proof), zk-prover
  | 'l1-execution-client'   // l1 geth/reth/nethermind/besu
  | 'rpc-gateway'           // proxyd
  | 'sync-node'             // read-only replica nodes
```

### 3.2 MetricCondition

```typescript
// src/playbooks/types.ts

/**
 * op: 'gt' | 'lt' | 'gte' | 'lte'  — AnomalyResult.value와 직접 비교
 * op: 'z_score_gt'                  — AnomalyResult.zScore의 절대값과 비교
 * op: 'rule'                         — AnomalyResult.rule과 비교
 */
export interface MetricCondition {
  metric: string           // AnomalyResult.metric과 매칭
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'z_score_gt' | 'rule'
  threshold?: number       // gt/lt/gte/lte/z_score_gt 에 사용
  rule?: AnomalyRule       // op: 'rule' 에 사용
}

export type AnomalyRule =
  | 'z-score'
  | 'zero-drop'
  | 'plateau'
  | 'monotonic-increase'
  | 'threshold-breach'
```

### 3.3 AbstractRemediationAction

```typescript
// src/playbooks/types.ts

import type { RemediationAction } from '@/types/remediation'

export interface AbstractRemediationAction extends RemediationAction {
  /**
   * Role-based target reference.
   * Executor resolves via ChainPlugin.roleMap.
   * Takes precedence over `target` (existing string field) if set.
   */
  targetRole?: ComponentRole
}
```

### 3.4 AbstractPlaybook

```typescript
// src/playbooks/types.ts

export interface AbstractPlaybook {
  id: string
  name: string
  description: string

  /**
   * Playbook origin:
   * - 'hardcoded': 정적 코어 플레이북
   * - 'pattern': PatternMiner가 통계적으로 발견
   * - 'ai-assisted': AI가 초안 생성
   */
  source: 'hardcoded' | 'pattern' | 'ai-assisted'

  // ---- 체인 필터 (없으면 모든 체인 적용) ----

  /** nodeLayer 필터. 미지정 시 l1/l2/both 모두 매칭 */
  applicableNodeLayers?: Array<'l1' | 'l2' | 'both'>

  /** 이 역할이 roleMap에 없는 체인에서는 매칭 제외 */
  requiredRoles?: ComponentRole[]

  // ---- 매칭 조건 (AND: 모두 만족해야 매칭) ----
  conditions: MetricCondition[]

  // ---- 실행 ----
  actions: AbstractRemediationAction[]
  fallback?: AbstractRemediationAction[]
  maxAttempts: number

  // ---- proposal-32 학습 필드 (Phase 4에서 채워짐) ----
  confidence?: number
  reviewStatus?: 'draft' | 'pending' | 'approved' | 'trusted' | 'archived' | 'suspended'
  performance?: {
    totalApplications: number
    successRate: number
    avgResolutionMs: number
    lastApplied?: string
    lastOutcome?: 'success' | 'failure' | 'partial'
  }
}
```

### 3.5 ChainPlugin 확장 — roleMap

```typescript
// src/chains/types.ts에 추가 (기존 인터페이스에 필드 추가)

import type { ComponentRole } from '@/playbooks/types'

export interface ChainPlugin {
  // ... 기존 필드들 유지 ...

  /**
   * Role → 실제 컴포넌트 이름 매핑.
   * 없는 role을 참조하는 AbstractPlaybook 액션은 자동으로 건너뜀.
   */
  readonly roleMap?: Partial<Record<ComponentRole, ChainComponent>>
}
```

각 체인 플러그인의 roleMap 값:

```typescript
// thanos (OP Stack)
roleMap: {
  'tx-submitter':       'op-batcher',
  'block-producer':     'op-geth',
  'state-root-poster':  'op-proposer',
  'proof-generator':    'op-challenger',
  'rpc-gateway':        'proxyd',
}

// arbitrum
roleMap: {
  'tx-submitter':       'nitro-batcher',
  'block-producer':     'nitro-sequencer',
  'state-root-poster':  'nitro-validator',
}

// zkstack
roleMap: {
  'tx-submitter':       'zk-batcher',
  'state-root-poster':  'zk-state-keeper',
  'proof-generator':    'zk-prover',
}

// l1-evm
roleMap: {
  'l1-execution-client': 'l1-execution',
  'block-producer':      'l1-execution',
}
```

---

## 4. evaluateConditions() 구현 명세

```typescript
// src/playbooks/evaluate.ts (신규 파일)

import type { MetricCondition } from './types'
import type { AnomalyEvent, AnomalyResult } from '@/types/anomaly'

/**
 * AnomalyEvent에서 모든 AnomalyResult를 평탄화
 * (L1 anomalies + L2 anomalies 통합)
 */
function flattenResults(event: AnomalyEvent): AnomalyResult[] {
  return [
    ...event.anomalies,
    ...(event.l1Anomalies ?? []),
  ]
}

/**
 * 단일 MetricCondition을 AnomalyEvent에 대해 평가
 */
export function evaluateCondition(
  cond: MetricCondition,
  event: AnomalyEvent
): boolean {
  const results = flattenResults(event)
  const match = results.find(r => r.metric === cond.metric)

  // 해당 metric이 이번 사이클에 이상 감지되지 않았으면 false
  if (!match || !match.isAnomaly) return false

  switch (cond.op) {
    case 'gt':        return match.value > (cond.threshold ?? 0)
    case 'lt':        return match.value < (cond.threshold ?? 0)
    case 'gte':       return match.value >= (cond.threshold ?? 0)
    case 'lte':       return match.value <= (cond.threshold ?? 0)
    case 'z_score_gt':return Math.abs(match.zScore) > (cond.threshold ?? 3.0)
    case 'rule':      return match.rule === cond.rule
    default:          return false
  }
}

/**
 * 모든 조건이 만족되면 true (AND 조건)
 * conditions가 빈 배열이면 false (항상 매칭되는 플레이북 방지)
 */
export function evaluateConditions(
  conditions: MetricCondition[],
  event: AnomalyEvent
): boolean {
  if (conditions.length === 0) return false
  return conditions.every(c => evaluateCondition(c, event))
}
```

---

## 5. 기존 조건 문자열 → MetricCondition 변환 매핑표

Phase 2 마이그레이션 시 이 표를 참조해 변환한다.

| 기존 조건 문자열 | MetricCondition |
|-----------------|----------------|
| `'cpuUsage > 90'` | `{ metric: 'cpuUsage', op: 'gt', threshold: 90 }` |
| `'cpuUsage > 80'` | `{ metric: 'cpuUsage', op: 'gt', threshold: 80 }` |
| `'memoryPercent > 85'` | `{ metric: 'memoryPercent', op: 'gt', threshold: 85 }` |
| `'txPoolPending monotonic increase'` | `{ metric: 'txPoolPending', op: 'rule', rule: 'monotonic-increase' }` |
| `'txPoolPending > threshold'` | `{ metric: 'txPoolPending', op: 'rule', rule: 'threshold-breach' }` |
| `'l2BlockHeight stagnant'` | `{ metric: 'l2BlockHeight', op: 'rule', rule: 'plateau' }` |
| `'syncGap increasing'` | `{ metric: 'syncGap', op: 'rule', rule: 'monotonic-increase' }` |
| `'batcherBalance < critical'` | `{ metric: 'batcherBalance', op: 'rule', rule: 'threshold-breach' }` |
| `'proposerBalance < critical'` | `{ metric: 'proposerBalance', op: 'rule', rule: 'threshold-breach' }` |
| `'challengerBalance < warning'` | `{ metric: 'challengerBalance', op: 'z_score_gt', threshold: 2.0 }` |
| `'hybridScore >= 70'` | ⚠️ 직접 변환 불가 — 별도 처리 (아래 참조) |
| `'pod restart count > 3'` | ⚠️ K8s 데이터 필요 — AbstractPlaybook 범위 외, 기존 Playbook 유지 |
| `'gameDeadlineProximity < 1h'` | ⚠️ 도메인 특화 — 기존 Playbook 유지 |
| `'proofGenerationLatency > 300s'` | ⚠️ 도메인 특화 — 기존 Playbook 유지 |

**⚠️ 변환 불가 조건 처리 방침**:
- K8s 데이터, 도메인 특화 메트릭을 참조하는 플레이북은 기존 `Playbook` 타입으로 유지
- `AbstractPlaybook`으로 마이그레이션 대상은 `AnomalyResult`에 있는 메트릭만 참조하는 것

**`hybridScore >= 70` 특수 처리**:
```typescript
// hybridScore는 AnomalyResult가 아닌 스케일링 점수 — evaluateCondition으로 평가 불가
// 대안: conditions 배열에 여러 metric 조건 조합으로 표현
conditions: [
  { metric: 'cpuUsage', op: 'gt', threshold: 80 },      // OR
  { metric: 'txPoolPending', op: 'rule', rule: 'monotonic-increase' },
]
// 단, 현재 evaluateConditions는 AND 로직 → hybridScore 대체는 OR 로직 필요
// → Phase 3에서 conditions에 'any' | 'all' mode 추가 고려
```

---

## 6. playbook-matcher 변경 명세

```typescript
// src/lib/playbook-matcher.ts 변경 내용

import { getCorePlaybooks } from '@/playbooks/core'
import { loadDynamicPlaybooks } from '@/playbooks/redis-loader'
import { evaluateConditions } from '@/playbooks/evaluate'
import { resolveAbstractAction } from '@/playbooks/resolver'
import type { AbstractPlaybook } from '@/playbooks/types'

/**
 * 기존 matchPlaybook 시그니처 유지 (브레이킹 체인지 없음)
 * 반환 타입을 Playbook | AbstractPlaybook | null로 확장
 */
export async function matchPlaybook(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): Promise<Playbook | AbstractPlaybook | null> {
  const plugin = getChainPlugin()

  // --- 레이어 1: 동적 플레이북 (Redis, proposal-32 생성) ---
  const dynamic = await loadDynamicPlaybooks(plugin.nodeLayer, plugin.roleMap)
  const dynamicMatch = dynamic.find(p => {
    if (!isApplicable(p, plugin)) return false
    return evaluateConditions(p.conditions, event)
  })
  if (dynamicMatch) return dynamicMatch

  // --- 레이어 2: 기존 체인 특화 플레이북 (변경 없음) ---
  const component = identifyComponent(event, analysis)
  const chainMatch = plugin.getPlaybooks()
    .filter(p => p.trigger.component === component)
    .find(p => {
      const metricMatch = p.trigger.indicators
        .filter(i => i.type === 'metric')
        .some(i => matchesMetricCondition(i.condition, event))
      return metricMatch
    })
  if (chainMatch) return chainMatch

  // --- 레이어 3: 코어 플레이북 (AbstractPlaybook, 정적) ---
  const coreMatch = getCorePlaybooks().find(p => {
    if (!isApplicable(p, plugin)) return false
    return evaluateConditions(p.conditions, event)
  })
  return coreMatch ?? null
}

/**
 * AbstractPlaybook이 현재 체인 플러그인에 적용 가능한지 확인
 */
function isApplicable(p: AbstractPlaybook, plugin: ChainPlugin): boolean {
  // nodeLayer 필터
  if (p.applicableNodeLayers && !p.applicableNodeLayers.includes(plugin.nodeLayer)) {
    return false
  }
  // requiredRoles 필터 — roleMap에 해당 role이 없으면 제외
  if (p.requiredRoles && plugin.roleMap) {
    const hasAllRoles = p.requiredRoles.every(r => plugin.roleMap![r] !== undefined)
    if (!hasAllRoles) return false
  }
  return true
}
```

---

## 7. action-executor 변경 명세

```typescript
// src/lib/action-executor.ts 추가

import type { AbstractRemediationAction } from '@/playbooks/types'

/**
 * AbstractRemediationAction의 targetRole을 실제 컴포넌트 이름으로 resolve
 * roleMap에 해당 role이 없으면 { skip: true } 반환
 */
export function resolveAbstractAction(
  action: AbstractRemediationAction,
  plugin: ChainPlugin
): RemediationAction | { skip: true; reason: string } {
  if (!action.targetRole) {
    // targetRole 없으면 기존 RemediationAction 그대로 사용
    return action as RemediationAction
  }

  const componentName = plugin.roleMap?.[action.targetRole]
  if (!componentName) {
    return {
      skip: true,
      reason: `role '${action.targetRole}' not in roleMap for ${plugin.chainType}`,
    }
  }

  return { ...action, target: componentName }
}
```

기존 `executeAction()` 함수 앞에 resolve 단계 추가:

```typescript
// 기존 executeAction 호출 전
const resolved = resolveAbstractAction(action, getChainPlugin())
if ('skip' in resolved) {
  console.warn(`[action-executor] Skipping: ${resolved.reason}`)
  return { success: true, message: `Skipped: ${resolved.reason}` }
}
await executeAction(resolved, config)
```

---

## 8. Redis 동적 플레이북 스키마

```typescript
// src/playbooks/redis-loader.ts (신규 파일)

// Redis 키 패턴
// playbook:dynamic:{instanceId}:{playbookId}
// 예: playbook:dynamic:inst-abc123:core-tx-submit-failure-v2

// TTL: 없음 (영구 저장, 명시적 삭제만)

// 인덱스 키 (조회용)
// playbook:dynamic:{instanceId}:index → Set<playbookId>

export async function loadDynamicPlaybooks(
  nodeLayer: 'l1' | 'l2' | 'both',
  roleMap?: Partial<Record<ComponentRole, ChainComponent>>
): Promise<AbstractPlaybook[]> {
  const store = await getStore()
  const instanceId = process.env.SENTINAI_INSTANCE_ID ?? 'default'
  const indexKey = `playbook:dynamic:${instanceId}:index`

  const ids = await store.smembers(indexKey)
  const playbooks: AbstractPlaybook[] = []

  for (const id of ids) {
    const raw = await store.get(`playbook:dynamic:${instanceId}:${id}`)
    if (!raw) continue
    try {
      const p = JSON.parse(raw) as AbstractPlaybook
      // reviewStatus가 approved/trusted인 것만 실행
      if (p.reviewStatus === 'approved' || p.reviewStatus === 'trusted') {
        playbooks.push(p)
      }
    } catch {
      // 파싱 실패 무시
    }
  }

  return playbooks
}
```

---

## 9. 코어 플레이북 예시

Phase 2에서 작성할 파일 예시 (기존 문자열 조건 → MetricCondition으로 변환):

```typescript
// src/playbooks/core/resource-pressure.ts

import type { AbstractPlaybook } from '../types'

export const resourcePressure: AbstractPlaybook = {
  id: 'core-resource-pressure',
  name: 'Resource Pressure Recovery',
  description: 'High CPU or memory — scale up then health check',
  source: 'hardcoded',
  applicableNodeLayers: ['l1', 'l2'],
  conditions: [
    { metric: 'cpuUsage', op: 'gt', threshold: 90 },
  ],
  actions: [
    {
      type: 'scale_up',
      safetyLevel: 'guarded',
      targetRole: 'block-producer',
      params: { targetVcpu: 'next_tier' },
    },
    {
      type: 'health_check',
      safetyLevel: 'safe',
      targetRole: 'block-producer',
      waitAfterMs: 30000,
    },
  ],
  fallback: [
    {
      type: 'restart_pod',
      safetyLevel: 'guarded',
      targetRole: 'block-producer',
    },
  ],
  maxAttempts: 2,
}
```

---

## 10. 구현 계획

### Phase 1 — 타입 정의 (브레이킹 체인지 없음)

- [ ] `src/playbooks/types.ts` 신규 생성
  - `ComponentRole`, `AnomalyRule`, `MetricCondition`
  - `AbstractRemediationAction` (extends `RemediationAction`)
  - `AbstractPlaybook`
- [ ] `src/chains/types.ts`: `ChainPlugin`에 `roleMap?` 필드 추가 (옵셔널)
- [ ] `npm run test:run` 전체 통과 확인

### Phase 2 — 코어 플레이북 + roleMap 작성

마이그레이션 대상: 섹션 5의 변환 가능 조건을 사용하는 플레이북

- [ ] `src/playbooks/evaluate.ts` 신규 생성 (`evaluateConditions`)
- [ ] `src/playbooks/core/resource-pressure.ts` (cpuUsage > 90)
- [ ] `src/playbooks/core/tx-pool-backlog.ts` (txPoolPending monotonic-increase)
- [ ] `src/playbooks/core/sync-stall.ts` (l2BlockHeight plateau)
- [ ] `src/playbooks/core/eoa-balance-low.ts` (batcherBalance threshold-breach)
- [ ] `src/playbooks/core/index.ts` (getCorePlaybooks export)
- [ ] 각 체인 플러그인에 `roleMap` 추가:
  - [ ] `src/chains/thanos/index.ts`
  - [ ] `src/chains/arbitrum/index.ts`
  - [ ] `src/chains/zkstack/index.ts`
  - [ ] `src/chains/zkl2-generic/index.ts`
  - [ ] `src/chains/l1-evm/index.ts`
- [ ] 테스트: 각 roleMap이 올바른 컴포넌트로 resolve되는지

### Phase 3 — playbook-matcher 통합

- [ ] `src/playbooks/redis-loader.ts` 신규 생성
- [ ] `src/playbooks/resolver.ts` 신규 생성 (`resolveAbstractAction`)
- [ ] `src/lib/playbook-matcher.ts` 수정 (3-레이어 조회, `isApplicable`)
- [ ] `src/lib/action-executor.ts` 수정 (resolve 단계 추가)
- [ ] 테스트:
  - [ ] roleMap에 없는 role → skip 동작 확인
  - [ ] conditions 불일치 → 다음 레이어 폴백 확인
  - [ ] 기존 Playbook 매칭 동작 변화 없음 확인

### Phase 4 — proposal-32 연동

- [ ] `PlaybookEvolver`가 `AbstractPlaybook` 스키마로 플레이북 생성
- [ ] Redis 저장 (`loadDynamicPlaybooks`와 연동)
- [ ] 승인 게이트 API (`POST /api/v2/instances/{id}/playbooks/{id}/approve`)
- [ ] `reviewStatus` 필터링 (approved/trusted만 실행)

---

## 11. 안전장치

### AI 생성 플레이북 액션 화이트리스트

```
초안(draft) 상태 기본 허용:
  escalate_operator   ← 항상 허용
  collect_logs        ← 항상 허용
  health_check        ← 항상 허용
  switch_l1_rpc       ← 허용 (인프라 변경 없음)

approved 이후 추가 허용:
  restart_pod         ← 재시작
  scale_up / scale_down
  refill_eoa

영구 금지 (AI 생성 불가):
  rollback_deployment
  force_restart_all
  config_change
```

### nodeLayer 게이팅

```typescript
// action-executor.ts에서 추가 검사
if (plugin.nodeLayer === 'l1' && action.type === 'scale_up') {
  // L1 외부 인프라에 K8s 스케일링 명령 차단
  return { success: false, message: 'scale_up blocked for l1 nodeLayer' }
}
```

---

## 12. proposal-32와의 관계

```
이 문서 (Abstract Playbook Layer)     proposal-32 (Self-Evolving Playbook)
─────────────────────────────────     ────────────────────────────────────
AbstractPlaybook 데이터 모델           OperationLedger (실행 결과 기록)
ComponentRole + roleMap               PatternMiner (통계 패턴 발견)
3-레이어 저장소 구조                   PlaybookEvolver (플레이북 생성/강화)
evaluateConditions() 평가 로직         confidence 생명주기
Redis 동적 플레이북 로더               자율성 수준 점진적 상승

→ 이 문서의 Phase 3 완료 후 proposal-32 구현 시작 가능
→ proposal-32가 생성하는 플레이북은 AbstractPlaybook 스키마를 따름
```

---

## 13. 구현 우선순위

Phase 1, 2는 기존 동작에 영향 없음.
Phase 3부터 playbook-matcher 시그니처가 `async`로 변경되므로 호출부 확인 필요.

```
Phase 1 (타입)      ─── 영향 범위: 없음
Phase 2 (코어)      ─── 영향 범위: playbook-matcher 추가 조회
Phase 3 (통합)      ─── 영향 범위: matchPlaybook 비동기화, remediation-engine 호출부
Phase 4 (학습 연동) ─── 영향 범위: 신규 API 엔드포인트
```

Phase 1–2는 `feat/abstract-playbook` 브랜치에서 병행 가능.
Phase 3은 `remediation-engine.ts`에서 `matchPlaybook` 호출 방식 변경 필요:
```typescript
// 변경 전 (동기)
const playbook = matchPlaybook(event, analysis)

// 변경 후 (비동기)
const playbook = await matchPlaybook(event, analysis)
```
