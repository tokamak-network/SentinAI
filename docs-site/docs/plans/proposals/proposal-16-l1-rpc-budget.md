# Proposal 16: L1 RPC 호출 예산 관리자

## 1. 개요

### 문제 정의

L2 네트워크 컴포넌트(op-node, op-batcher, op-proposer)는 Proxyd를 통해 L1에 접근하며, Proxyd는 요청을 여러 백엔드(`infura_theo1`, `infura_theo2`, `infura_theo3` 등)에 분산한다. 각 백엔드는 사용 한도가 있다:

| 제공자 | 무료 한도 | 초과 비용 |
|--------|-----------|-----------|
| Infura | 100K 요청/일 | $50/월 (Growth Plan) |
| Alchemy | 300M CU/월 | $49/월 (Growth Plan) |

현재 SentinAI는 429 에러가 **발생한 후에야** 반응한다 (Proposal: Proxyd Backend 429 자동 교체, `l1-rpc-failover.ts` 구현). **사전** 할당량 추적이 없어 백엔드가 예상치 못하게 한도에 도달하면:

- Failover 완료 전까지 일시적인 L1 연결 끊김 발생
- 예방 가능한 할당량 소진으로 인한 예비 URL 낭비
- 백엔드별 사용량 가시성 없음

### 해결책 요약

다음을 수행하는 **L1 RPC 예산 관리자**를 구현한다:
1. 프로브 횟수 집계와 실사용량 추정으로 백엔드별 호출량 추적
2. 설정 가능한 한도로 백엔드별 일간/월간 예산 설정
3. 할당량 90% 도달 시 Proxyd `backend_groups`에서 해당 백엔드 선제 제거
4. 할당량 초기화(일간/월간) 시 백엔드 자동 복구
5. 80% 사용 시 알림 발송

### 목표

- 할당량 초과 요금 방지 (월 $50~99 절감)
- 불필요한 429 → 예비 URL 소비 사이클 제거
- 백엔드별 RPC 사용량 가시성 확보
- 초기 예산 설정 후 무인 운영

### 비목표

- 요청별 정확한 추적 (프로브 속도 기반 추정으로 충분)
- Proxyd 내부 라우팅 로직 수정
- Infura/Alchemy 이외 제공자 지원 (범용 예산 모델)

### 월간 절감 추산

| 항목 | 비용 |
|------|------|
| Infura 초과 방지 (Growth Plan) | **$50/월** |
| Alchemy 초과 방지 (Growth Plan) | **$49/월** |
| 예비 URL 소비 감소 | 운영 안정성 향상 |

---

## 2. 아키텍처

### 데이터 흐름

```
┌─ Agent Loop (30초 사이클, 기존) ───────────────────────────┐
│                                                            │
│  Phase 1.5: checkProxydBackends() (기존)                   │
│       └─> probeBackend(url) — 429 횟수 집계                │
│                                                            │
│  Phase 1.6: checkRpcBudgets() (신규)                       │
│       ├─> estimateBackendUsage(probeResults)                │
│       ├─> [80% 도달] → sendBudgetAlert()                   │
│       ├─> [90% 도달] → removeFromBackendGroup()            │
│       └─> [할당량 초기화] → restoreToBackendGroup()         │
└────────────────────────────────────────────────────────────┘

Budget State (IStateStore):
┌───────────────────────────────────────────────────────────┐
│  infura_theo1: { daily: 85000/100000, monthly: 2.1M/3M }  │
│  infura_theo2: { daily: 42000/100000, monthly: 1.0M/3M }  │
│  infura_theo3: { daily: 98000/100000, monthly: 2.9M/3M }  │ ← 위험
│  alchemy:      { daily: 12000/∞,      monthly: 50M/300M } │
└───────────────────────────────────────────────────────────┘
```

### 연동 지점

| 모듈 | 파일 | 사용 방식 |
|------|------|-----------|
| L1 RPC Failover | `src/lib/l1-rpc-failover.ts` | `checkProxydBackends()` 프로브 데이터, `replaceBackendInToml()`, ConfigMap 접근 |
| Agent Loop | `src/lib/agent-loop.ts` | Phase 1.6 통합 (기존 Phase 1.5 이후) |
| Alert Dispatcher | `src/lib/alert-dispatcher.ts` | Webhook 알림 패턴 재사용 |
| State Store | `src/lib/redis-store.ts` | 예산 카운터 영속화 |
| Scheduler | `src/lib/scheduler.ts` | 월간/일간 초기화 cron |

### 상태 관리

`IStateStore` 확장:
- `getRpcBudgetState(): Promise<RpcBudgetState | null>`
- `setRpcBudgetState(state: RpcBudgetState): Promise<void>`

---

## 3. 상세 설계

### 3.1 신규 타입

**파일: `src/types/rpc-budget.ts`** (신규)

```typescript
/**
 * L1 RPC Budget Manager Types
 * Per-backend quota tracking and proactive budget management.
 */

/** Budget configuration for a single backend */
export interface BackendBudget {
  name: string;                    // e.g., 'infura_theo1'
  dailyLimit: number;              // Max requests per day (0 = unlimited)
  monthlyLimit: number;            // Max requests per month (0 = unlimited)
  warningPct: number;              // Alert threshold (default: 80)
  criticalPct: number;             // Auto-remove threshold (default: 90)
}

/** Runtime usage counters for a single backend */
export interface BackendUsageCounter {
  name: string;
  dailyCount: number;              // Estimated requests today
  monthlyCount: number;            // Estimated requests this month
  lastResetDaily: string;          // ISO date (YYYY-MM-DD) of last daily reset
  lastResetMonthly: string;        // ISO date (YYYY-MM) of last monthly reset
  removedFromGroup: boolean;       // Whether this backend was removed from backend_groups
  removedAt?: string;              // ISO timestamp of removal
  estimatedDailyRate: number;      // Requests/hour estimated rate
}

/** Budget alert event */
export interface BudgetAlertEvent {
  timestamp: string;
  backendName: string;
  level: 'warning' | 'critical';
  usagePct: number;
  dailyCount: number;
  dailyLimit: number;
  monthlyCount: number;
  monthlyLimit: number;
  action: 'alert-only' | 'removed-from-group' | 'restored';
  message: string;
}

/** Overall budget state */
export interface RpcBudgetState {
  counters: BackendUsageCounter[];
  budgets: BackendBudget[];
  alerts: BudgetAlertEvent[];       // Recent alerts (ring buffer, max 50)
  lastCheckTime: number;            // Unix timestamp of last check
}

/** Budget check result */
export interface BudgetCheckResult {
  backendsChecked: number;
  alertsSent: number;
  backendsRemoved: string[];
  backendsRestored: string[];
}

/** Configuration via environment */
export interface RpcBudgetConfig {
  enabled: boolean;
  /** JSON config string, e.g.:
   *  [{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000},
   *   {"name":"infura_theo2","dailyLimit":100000,"monthlyLimit":3000000}]
   */
  budgets: BackendBudget[];
  /** Estimation multiplier: actual_requests ≈ probe_count × multiplier
   *  Since agent loop probes every 30s, and actual L2 components make many more calls,
   *  default multiplier = 100 (1 probe ≈ 100 actual requests)
   */
  estimationMultiplier: number;
}

export const DEFAULT_RPC_BUDGET_CONFIG: RpcBudgetConfig = {
  enabled: false,
  budgets: [],
  estimationMultiplier: 100,
};
```

### 3.2 핵심 모듈

**파일: `src/lib/rpc-budget-manager.ts`** (신규, ~250줄)

```typescript
/**
 * L1 RPC Budget Manager
 * Tracks per-backend call volume and proactively manages quota usage.
 *
 * Integration: Called from agent-loop.ts after checkProxydBackends().
 * Uses probe data from l1-rpc-failover.ts to estimate actual usage.
 */

import { getStore } from '@/lib/redis-store';
import { getL1FailoverState, replaceBackendInToml } from '@/lib/l1-rpc-failover';
import { runK8sCommand } from '@/lib/k8s-config';
import type {
  RpcBudgetState,
  BackendBudget,
  BackendUsageCounter,
  BudgetAlertEvent,
  BudgetCheckResult,
  RpcBudgetConfig,
} from '@/types/rpc-budget';

// ============================================================
// Constants
// ============================================================

const MAX_ALERT_EVENTS = 50;
const DEFAULT_WARNING_PCT = 80;
const DEFAULT_CRITICAL_PCT = 90;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 백엔드별 알림 간격: 1시간

// ============================================================
// Configuration
// ============================================================

/**
 * Parse budget configuration from environment.
 *
 * L1_RPC_BUDGET_ENABLED=true
 * L1_RPC_BUDGET_CONFIG=[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000}]
 * L1_RPC_BUDGET_MULTIPLIER=100
 */
export function parseBudgetConfig(): RpcBudgetConfig

// ============================================================
// Core Logic
// ============================================================

/**
 * Initialize or load budget state.
 */
export async function initBudgetState(config: RpcBudgetConfig): Promise<RpcBudgetState>

/**
 * Check and reset daily/monthly counters if date has changed.
 * Returns list of restored backend names.
 */
export async function checkAndResetCounters(state: RpcBudgetState): Promise<string[]>
```

**`checkAndResetCounters()` 로직:**
1. 현재 날짜 `YYYY-MM-DD`와 월 `YYYY-MM` 취득
2. 각 카운터에 대해:
   - `lastResetDaily !== today` → `dailyCount = 0` 초기화, `lastResetDaily` 업데이트
   - `lastResetMonthly !== thisMonth` → `monthlyCount = 0` 초기화, `lastResetMonthly` 업데이트
   - `removedFromGroup` 상태이고 일간 초기화 발생 → 그룹 복구 (월간 한도 초과 아닌 경우만)
3. 복구된 백엔드 이름 목록 반환

```typescript
/**
 * Estimate backend usage from probe intervals.
 * Called each agent loop cycle (every 30s).
 *
 * Estimation: Each probe cycle accounts for `multiplier` actual requests.
 */
export function incrementUsage(
  state: RpcBudgetState,
  activeBackendNames: string[],
  multiplier: number
): void
```

**`incrementUsage()` 로직:**
1. 현재 그룹의 활성 백엔드 이름별로:
   - 해당 카운터 탐색
   - `counter.dailyCount += multiplier`
   - `counter.monthlyCount += multiplier`
   - `counter.estimatedDailyRate = counter.dailyCount / hoursSinceLastDailyReset`

```typescript
/**
 * Check budgets and take action (alert/remove/restore).
 * Main function called from agent loop.
 */
export async function checkRpcBudgets(): Promise<BudgetCheckResult | null>
```

**`checkRpcBudgets()` 로직:**
1. 설정 파싱 → 비활성화 시 null 반환
2. 스토어에서 상태 로드 (없으면 초기화)
3. `checkAndResetCounters()` 호출 → 할당량 초기화 시 백엔드 복구
4. 활성 백엔드 이름으로 `incrementUsage()` 호출
5. 예산이 있는 각 백엔드:
   - `dailyPct = dailyCount / dailyLimit * 100` 계산
   - `monthlyPct = monthlyCount / monthlyLimit * 100` 계산
   - `usagePct = max(dailyPct, monthlyPct)`
   - `usagePct >= criticalPct (90%)` 이고 아직 미제거 시:
     - ConfigMap TOML의 `backend_groups`에서 제거
     - `kubectl patch configmap` + Proxyd 파드 재시작
     - 알림 이벤트 기록
   - `usagePct >= warningPct (80%)` 시:
     - Webhook 알림 발송 (쿨다운 만료 시)
     - 알림 이벤트 기록
6. 스토어에 상태 저장
7. `BudgetCheckResult` 반환

```typescript
/**
 * Remove a backend from the Proxyd backend_groups (ConfigMap TOML).
 * Does NOT delete the [backends.NAME] section — only removes from groups list.
 */
async function removeFromBackendGroup(
  backendName: string,
  configMapName: string,
  dataKey: string,
  targetGroup: string
): Promise<boolean>
```

**`removeFromBackendGroup()` 로직:**
1. kubectl로 ConfigMap TOML 읽기
2. TOML 파싱 → `backend_groups[targetGroup].backends` 탐색
3. 백엔드 배열에서 `backendName` 필터링
4. 문자열화 후 ConfigMap 패치
5. Proxyd 파드 재시작: `kubectl rollout restart deployment proxyd -n {namespace}`

```typescript
/**
 * Restore a backend to the Proxyd backend_groups.
 */
async function restoreToBackendGroup(
  backendName: string,
  configMapName: string,
  dataKey: string,
  targetGroup: string
): Promise<boolean>
```

**`restoreToBackendGroup()` 로직:**
1. ConfigMap TOML 읽기
2. 파싱 → `backend_groups[targetGroup].backends`에 `backendName` 재추가
3. ConfigMap 패치 + Proxyd 파드 재시작

```typescript
/**
 * Send budget alert via webhook (same format as alert-dispatcher.ts).
 */
async function sendBudgetAlert(event: BudgetAlertEvent): Promise<boolean>
```

**`sendBudgetAlert()` 로직:**
1. 환경변수에서 `ALERT_WEBHOOK_URL` 취득
2. 예산 상세 정보를 Slack Block Kit 메시지로 포맷
3. Webhook URL에 POST
4. 성공/실패 반환

```typescript
/**
 * Get current budget state for API/dashboard.
 */
export async function getBudgetState(): Promise<RpcBudgetState | null>
```

### 3.3 Agent Loop 통합

**파일: `src/lib/agent-loop.ts`** (수정)

기존 Phase 1.5(Proxyd 백엔드 헬스 체크) 이후에 추가:

```typescript
// === 기존 IMPORT에 추가: ===
import { checkRpcBudgets } from '@/lib/rpc-budget-manager';

// === runAgentCycle() 내부, Phase 1.5 Proxyd 헬스 체크 이후: ===

// Phase 1.6: RPC Budget check (non-blocking)
try {
  const budgetResult = await checkRpcBudgets();
  if (budgetResult && budgetResult.backendsRemoved.length > 0) {
    console.log(new Date().toISOString(), `[AgentLoop] RPC budget: removed backends: ${budgetResult.backendsRemoved.join(', ')}`);
  }
  if (budgetResult && budgetResult.backendsRestored.length > 0) {
    console.log(new Date().toISOString(), `[AgentLoop] RPC budget: restored backends: ${budgetResult.backendsRestored.join(', ')}`);
  }
} catch {
  // Non-blocking — continue cycle
}
```

### 3.4 API 엔드포인트

**파일: `src/app/api/rpc-budget/route.ts`** (신규)

```typescript
import { NextResponse } from 'next/server';
import { getBudgetState, parseBudgetConfig } from '@/lib/rpc-budget-manager';

// GET /api/rpc-budget — 현재 예산 상태 조회
export async function GET() {
  const config = parseBudgetConfig();
  if (!config.enabled) {
    return NextResponse.json({
      enabled: false,
      message: 'RPC budget manager is disabled. Set L1_RPC_BUDGET_ENABLED=true',
    });
  }
  const state = await getBudgetState();
  return NextResponse.json({ enabled: true, state });
}
```

### 3.5 대시보드 UI

대시보드 변경 없음. 예산 데이터는 `/api/rpc-budget`으로 조회 가능.

### 3.6 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `L1_RPC_BUDGET_ENABLED` | `false` | 백엔드별 RPC 할당량 추적 활성화 |
| `L1_RPC_BUDGET_CONFIG` | `[]` | `BackendBudget` 객체 JSON 배열 |
| `L1_RPC_BUDGET_MULTIPLIER` | `100` | 추정 배수 (프로브 → 실제 요청) |

`.env.local.sample`에 추가:
```bash
# === L1 RPC Budget Manager (선택 사항) ===
# 백엔드별 RPC 할당량 사용량 추적 및 선제 관리.
# L1_RPC_BUDGET_ENABLED=true
# L1_RPC_BUDGET_CONFIG=[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000},{"name":"infura_theo2","dailyLimit":100000,"monthlyLimit":3000000}]
# L1_RPC_BUDGET_MULTIPLIER=100  # 프로브 1회 ≈ L2 컴포넌트 실제 요청 100회
```

---

## 4. 구현 가이드

### 파일 변경 목록

| # | 파일 | 작업 | 변경 내용 |
|---|------|------|-----------|
| 1 | `src/types/rpc-budget.ts` | 신규 생성 | 타입 정의 (~80줄) |
| 2 | `src/lib/rpc-budget-manager.ts` | 신규 생성 | 핵심 모듈 (~250줄) |
| 3 | `src/lib/agent-loop.ts` | 수정 | Phase 1.6 통합 (+12줄) |
| 4 | `src/types/redis.ts` | 수정 | IStateStore 확장 (+2줄) |
| 5 | `src/lib/state-store.ts` | 수정 | InMemoryStateStore (+10줄) |
| 6 | `src/lib/redis-state-store.ts` | 수정 | RedisStateStore (+15줄) |
| 7 | `src/app/api/rpc-budget/route.ts` | 신규 생성 | API 엔드포인트 (~25줄) |
| 8 | `src/lib/__tests__/rpc-budget-manager.test.ts` | 신규 생성 | 테스트 (~200줄) |
| 9 | `.env.local.sample` | 수정 | 환경변수 추가 (+5줄) |
| 10 | `CLAUDE.md` | 수정 | 환경변수 + API 라우트 추가 (+4줄) |

### 재사용 가능한 함수

```typescript
// l1-rpc-failover.ts에서
import { getL1FailoverState, replaceBackendInToml } from '@/lib/l1-rpc-failover';
// getL1FailoverState() → L1FailoverState (proxydHealth[] 포함)
// replaceBackendInToml(toml, backendName, newUrl) → { updatedToml, previousUrl }

// k8s-config.ts에서
import { runK8sCommand, getNamespace } from '@/lib/k8s-config';
// runK8sCommand(command, options?) → { stdout, stderr }

// redis-store.ts에서
import { getStore } from '@/lib/redis-store';
```

### IStateStore 확장

`src/types/redis.ts`에 추가:
```typescript
getRpcBudgetState(): Promise<RpcBudgetState | null>;
setRpcBudgetState(state: RpcBudgetState): Promise<void>;
```

### 구현 순서

1. 타입 → 2. IStateStore 확장 → 3. 스토어 구현체 → 4. 핵심 모듈 → 5. Agent Loop → 6. API → 7. 테스트 → 8. 설정

---

## 5. 테스트 명세

**파일: `src/lib/__tests__/rpc-budget-manager.test.ts`** (신규)

### Mock 전략

```typescript
vi.mock('@/lib/l1-rpc-failover', () => ({
  getL1FailoverState: vi.fn().mockReturnValue({
    proxydHealth: [
      { name: 'infura_theo1', rpcUrl: 'https://mainnet.infura.io/v3/key1', consecutive429: 0, healthy: true, replaced: false },
      { name: 'infura_theo2', rpcUrl: 'https://mainnet.infura.io/v3/key2', consecutive429: 0, healthy: true, replaced: false },
    ],
    spareUrls: [],
  }),
  replaceBackendInToml: vi.fn(),
}));

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  getNamespace: vi.fn().mockReturnValue('default'),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getRpcBudgetState: vi.fn().mockResolvedValue(null),
    setRpcBudgetState: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### 테스트 케이스

```
describe('rpc-budget-manager')
  describe('parseBudgetConfig')
    it('환경변수 미설정 시 비활성화 설정 반환')
    it('유효한 JSON 예산 설정 파싱')
    it('잘못된 JSON 안전하게 처리')
    it('기본 warning/critical 임계값 적용')

  describe('checkAndResetCounters')
    it('날짜 변경 시 일간 카운터 초기화')
    it('월 변경 시 월간 카운터 초기화')
    it('일간 초기화 시 제거된 백엔드 복구')
    it('월간 한도 초과 시 복구하지 않음')

  describe('incrementUsage')
    it('일간/월간 카운터 증가')
    it('예상 일간 속도 계산')
    it('활성 백엔드만 증가')

  describe('checkRpcBudgets')
    it('비활성화 시 null 반환')
    it('80% 사용 시 경고 알림 발송')
    it('90% 사용 시 백엔드 그룹에서 제거')
    it('이미 제거된 백엔드 중복 제거 방지')
    it('할당량 초기화 시 백엔드 복구')
    it('알림 쿨다운 준수 (1시간)')

  describe('removeFromBackendGroup')
    it('ConfigMap TOML 정상 업데이트')
    it('그룹에 없는 백엔드 안전하게 처리')

  describe('restoreToBackendGroup')
    it('TOML의 그룹에 백엔드 재추가')
    it('이미 있는 경우 중복 추가 방지')
```

### 최소 커버리지 목표

- 구문 커버리지: ≥ 80%
- 분기 커버리지: ≥ 75%

---

## 6. 검증

### Step 1: 빌드

```bash
npm run build
```

### Step 2: 단위 테스트

```bash
npx vitest run src/lib/__tests__/rpc-budget-manager.test.ts
```

### Step 3: 통합 테스트

```bash
# 예산 설정 및 활성화
export L1_RPC_BUDGET_ENABLED=true
export L1_RPC_BUDGET_CONFIG='[{"name":"infura_theo1","dailyLimit":100000,"monthlyLimit":3000000}]'
npm run dev

# 예산 상태 확인
curl http://localhost:3002/api/rpc-budget | jq .
```

### Step 4: 전체 테스트 스위트

```bash
npm run test:run
```
