# Proposal 8: Auto-Remediation Engine - Auto-Remediation Engine

> **Created date**: 2026-02-09
> **Prerequisite**: Proposal 2 (Anomaly Detection), Proposal 3 (RCA Engine) implementation completed
> **Purpose**: Anomaly detection → Complete the loop from notification to automatic recovery without operator intervention

---

## index

1. [Overview](#1-Overview)
2. [Limitations of the current pipeline](#2-Limitations of the current-pipeline)
3. [Architecture](#3-Architecture)
4. [Recovery Action Classification System](#4-Recovery-Action-Classification-System)
5. [Playbook system](#5-playbook-system)
6. [Escalation Ladder](#6-Escalation-Ladder)
7. [Safety device](#7-Safety device)
8. [Type-Definition](#8-Type-Definition)
9. [New module specification](#9-new-module-specification)
10. [Modify existing module](#10-Existing-module-Modify)
11. [API specification](#11-api-specification)
12. [Environment Variables](#12-Environment-Variables)
13. [Test Verification](#13-Test-Verification)
14. [Dependency](#14-Dependency)

---

## 1. Overview

### 1.1 Problem

Currently, SentinAI's pipeline breaks at stage 3:

```
Layer 1: Z-Score abnormality detection
  ↓
Layer 2: AI Deep Analysis
  ↓
Layer 3: Slack/Webhook notifications
  ↓
❌ The operator checks Slack → Accesses the dashboard → Manually triggers RCA → Reads recommendations → Manually runs kubectl
```

Although the RCA engine provides `RemediationAdvice` (immediate action + preventive action) as text, actual execution is entirely dependent on the operator. If an op-geth OOM occurs at 3 am, the operator must wake up and respond manually.

### 1.2 Goal

**Layer 4: Auto-Remediation Engine** is added to automatically complete the detection-analysis-recovery loop.

1. **Playbook-based automatic recovery**: Automatically executes recovery procedures according to predefined failure patterns
2. **Safety Classification**: Classifies recovery actions into 3 levels: Safe / Guarded / Manual.
3. **Escalation Ladder**: Automatic recovery → Retry → Request for operator approval → Escalation of emergency notification
4. **Execution Tracking**: Records the execution history, success rate, and time taken of all recovery operations.
5. **Feedback Loop**: Learn the results of recovery success/failure and reflect them in future decisions.

### 1.3 Core principles

- **Do No Harm**: Operates conservatively to ensure that automatic recovery does not worsen the failure.
- **Observable**: All automated actions are trackable and audit logged.
- **Escapable**: Automatic recovery can be disabled by the operator at any time
- **Gradual**: Start with Safe actions and expand to Guarded actions as trust builds.

---

## 2. Limitations of the current pipeline

### 2.1 Broken loop

| steps | Current status | Automation or not |
|------|----------|------------|
| Anomaly Detection | Z-Score + AI analysis | ✅ Automatic |
| Send notification | Slack/Webhooks | ✅ Automatic |
| Root Cause Analysis | RCA Engine | ⚠️ Manual trigger |
| Recovery recommended | RemediationAdvice text | ⚠️ Read only |
| Run Recovery | Running kubectl manually | ❌ Manual |
| Check results | Manually check dashboard | ❌ Manual |

### 2.2 Reusable building blocks

Already implemented K8s tasks can be reused as executors for self-healing:

| module | Possible Actions |
|------|-----------|
| `k8s-scaler.ts` | StatefulSet Resource Patch (vCPU/Memory) |
| `zero-downtime-scaler.ts` | Parallel Pod Swap Non-disruptive scaling |
| `k8s-config.ts` | Run kubectl command (get/patch/delete/exec) |

---

## 3. Architecture

### 3.1 Overall flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Layer 4: Auto-Remediation                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [Input: AnomalyEvent + DeepAnalysisResult + RCAResult(optional)]         │
│                          │                                                 │
│                          ▼                                                 │
│  ┌────────────────────────────────────────────┐                           │
│  │         Playbook Matcher                    │                           │
│  │                                             │                           │
│ │ AnomalyEvent pattern matching │ │
│ │ → Select matching Playbook │ │
│ │ → AI-based action extraction when matching fails │ │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Safety Classifier                   │                           │
│  │                                             │                           │
│ │ Check the safety rating for each action: │ │
│ │ • Safe → Run immediately │ │
│ │ • Guarded → Execute when conditions are met │ │
│ │ • Manual → Wait for operator approval │ │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Action Executor                     │                           │
│  │                                             │                           │
│  │   k8s-scaler.ts / zero-downtime-scaler.ts  │                           │
│ │ / call k8s-config.ts │ │
│ │ Collect execution results │ │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Result Monitor                      │                           │
│  │                                             │                           │
│ │ Recheck metrics after recovery (wait 30 seconds to 2 minutes) │ │
│ │ • Normalization → Completion + Notification │ │
│ │ • Unresolved → Escalation │ │
│  └────────────────────────────────────────────┘                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data flow

```
alert-dispatcher.ts (Layer 3)
  │
  ├─ severity: high/critical
  │
  ▼
remediation-engine.ts (Layer 4)
  │
├─ playbook-matcher.ts → Failure pattern → Select Playbook
├─ action-executor.ts → K8s task execution
└─ remediation-store.ts → Save execution history
  │
├─ Success → Slack recovery completion notification
└─ Failure → Escalation (retry / call operator)
```

---

## 4. Recovery action classification system

### 4.1 Level 3 safety level

| Rating | Description | Conditions | Example |
|------|------|------|------|
| **Safe** | Diagnosis/light recovery without side effects | Run automatically unconditionally | Log collection, health check, Pod status inquiry |
| **Guarded** | Service Impact Possible Recovery | Cooldown + automatic when hourly count limit is met | Pod restart, resource scale-up |
| **Manual** | Risk of data loss or downtime | Operator approval required | Delete StatefulSet, change settings, rollback |

### 4.2 List of predefined actions

```
Safe Actions:
├─ collect_logs Collect and store logs
├─ health_check Check Pod/RPC status
├─ check_l1_connection Check L1 RPC connection
└─ describe_pod View Pod detailed status

Guarded Actions:
├─ restart_pod Restart Pod (delete → auto-recreate)
├─ scale_up Increase resources (vCPU/Memory)
├─ scale_down Decrease resources
└─ zero_downtime_swap Non-disruptive Pod replacement

Manual Actions:
├─ config_change Change environment variables/settings
├─ rollback_deployment Roll back to previous version
└─ force_restart_all Restart all components
```

---

## 5. Playbook system

### 5.1 Concept

Playbook is a declarative mapping of **failure pattern → recovery procedure**. Optimism Rollup Predefines proven recovery procedures for known failure patterns for each component.

### 5.2 Playbook definition

#### Playbook 1: op-geth OOM / High CPU

```yaml
name: op-geth-resource-exhaustion
trigger:
  component: op-geth
  indicators:
    - metric: cpuPercent > 90 (sustained 3+ checks)
    - metric: memoryPercent > 85
    - log_pattern: "out of memory" | "OOM killed"
actions:
  - type: scale_up          # Guarded
    target: op-geth
    params: { targetVcpu: "next_tier" }
- type: health_check # Safe (recovery confirmation)
    target: op-geth
    wait: 30s
fallback:
- type: restart_pod # Guarded (if unresolved even after scale-up)
    target: op-geth
escalate_after: 2 attempts
```

#### Playbook 2: op-node Derivation Stall

```yaml
name: op-node-derivation-stall
trigger:
  component: op-node
  indicators:
    - metric: l2BlockNumber stagnant (3+ checks)
    - log_pattern: "derivation pipeline" | "reset"
actions:
  - type: check_l1_connection  # Safe
  - type: restart_pod           # Guarded
    target: op-node
    wait: 60s
- type: health_check # Safe (check block number increase)
escalate_after: 1 attempt
```

#### Playbook 3: op-batcher Backlog

```yaml
name: op-batcher-backlog
trigger:
  component: op-batcher
  indicators:
    - metric: txPoolSize monotonic increase (5+ checks)
    - log_pattern: "failed to submit" | "insufficient funds"
actions:
- type: check_l1_connection # Safe (check L1 gas status)
  - type: collect_logs           # Safe
    target: op-batcher
  - type: restart_pod            # Guarded
    target: op-batcher
escalate_after: 1 attempt # L1 gas problem cannot be resolved automatically
```

#### Playbook 4: Overall lack of resources

```yaml
name: general-resource-pressure
trigger:
  component: system
  indicators:
    - metric: hybridScore >= 70 (sustained)
    - metric: cpuPercent > 80
actions:
  - type: scale_up                # Guarded
    target: op-geth
    params: { targetVcpu: "next_tier" }
- type: zero_downtime_swap # Guarded (if possible)
escalate_after: 1 attempt
```

#### Playbook 5: L1 connection failure

```yaml
name: l1-connectivity-failure
trigger:
  component: l1
  indicators:
    - metric: l1BlockNumber stagnant
    - log_pattern: "connection refused" | "timeout" | "ECONNRESET"
actions:
- type: check_l1_connection   # Safe (진단)
  - type: collect_logs           # Safe
    target: [op-node, op-batcher, op-proposer]
escalate_after: 0 attempts # Automatic recovery is not possible for L1 problems → Immediate escalation
```

### 5.3 Matching logic

```
1. Check affectedMetrics + severity of AnomalyEvent
2. Identify components from recent log patterns
3. If RCAResult exists, use rootCause.component first
4. Select matching Playbook (when multiple matching, priority is given to the one with higher severity)
5. No matching → AI-based fallback (extract only Safe action from RCA’s RemediationAdvice)
```

---

## 6. Escalation Ladder

Escalating response system in case of automatic recovery failure:

```
Level 0: Auto-Remediation
│ Automatic execution of Safe + Guarded actions in Playbook
│ Success → Slack notification: "✅ [Automatic recovery completed] op-geth resource expansion (2→4 vCPU)"
  │
│ Failure ↓
  │
Level 1: Retry with Fallback
│ Execute fallback action in Playbook
│ Success → Slack notification: "✅ [Automatic recovery completed] Recovery by op-geth restart"
  │
│ Failure ↓
  │
Level 2: Operator Approval Request
│ Slack notification: "⚠️ [Approval required] Automatic recovery failed. Manual action required:"
│ + Summary of RCA results + Provides recommended kubectl commands
│ + Dashboard link
  │
│ No response (30 minutes) ↓
  │
Level 3: Urgent Escalation
Slack @channel mention + Webhook repeat notification
"🚨 [Urgent] op-geth failure unresolved (30 minutes passed). Needs immediate confirmation."
```

---

## 7. Safety device

### 7.1 Execution Limits

| Limited | value | Description |
|------|----|------|
| Cooldown | 5 minutes | Recovery Interval to Same Target |
| Max runs per hour | Episode 3 | Number of executions per hour for the same Playbook |
| Daily Max Run | Episode 10 | Total daily number of full automatic recoveries |
| Maximum concurrent execution | 1 case | Serialize recovery operations (avoid collisions) |
| Scale-up upper limit | 4 vCPUs | Maximum vCPU that can be automatically increased |

### 7.2 Circuit Breaker

```
If automatic recovery fails three times in a row for the same fault:
→ Deactivate the Playbook for 24 hours
→ Notify operator: "Automatic recovery repetition failed. Manual intervention required."
→ Display Circuit Breaker status on dashboard
```

### 7.3 Kill Switch

```
AUTO_REMEDIATION_ENABLED=false # Stop all automatic recovery immediately
```

Administrators can toggle it in the dashboard UI as well.

### 7.4 Dry Run Mode

When `SCALING_SIMULATION_MODE=true` (existing environment variable), all recovery actions leave only logs and are not actually executed.

---

## 8. Type definition

### 8.1 File: `src/types/remediation.ts` (new)

```typescript
/**
 * Auto-Remediation Engine Type Definitions
 */

import type { RCAComponent } from './rca';
import type { AISeverity } from './scaling';

// ============================================================
// Action Types
// ============================================================

/** Safety level of recovery action */
export type SafetyLevel = 'safe' | 'guarded' | 'manual';

/** Predefined recovery action type */
export type RemediationActionType =
  // Safe
  | 'collect_logs'
  | 'health_check'
  | 'check_l1_connection'
  | 'describe_pod'
  // Guarded
  | 'restart_pod'
  | 'scale_up'
  | 'scale_down'
  | 'zero_downtime_swap'
  // Manual
  | 'config_change'
  | 'rollback_deployment'
  | 'force_restart_all';

/** Single recovery action */
export interface RemediationAction {
  type: RemediationActionType;
  safetyLevel: SafetyLevel;
  target?: RCAComponent;
  params?: Record<string, unknown>;
/** Wait time after execution (ms) */
  waitAfterMs?: number;
}

// ============================================================
// Playbook Types
// ============================================================

/** Trigger condition */
export interface PlaybookTrigger {
  component: RCAComponent;
  indicators: PlaybookIndicator[];
}

export interface PlaybookIndicator {
  type: 'metric' | 'log_pattern';
/** Metric condition (e.g. "cpuPercent > 90") or log pattern (regular expression) */
  condition: string;
}

/** Playbook definition */
export interface Playbook {
  name: string;
  description: string;
  trigger: PlaybookTrigger;
  actions: RemediationAction[];
  fallback?: RemediationAction[];
/** Maximum number of attempts before escalation */
  maxAttempts: number;
}

// ============================================================
// Execution Types
// ============================================================

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'escalated';

/** Execution result of a single action */
export interface ActionResult {
  action: RemediationAction;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

/** Complete record of Playbook execution */
export interface RemediationExecution {
  id: string;
  playbookName: string;
  triggeredBy: 'auto' | 'manual';
  anomalyEventId?: string;
  status: ExecutionStatus;
  actions: ActionResult[];
  escalationLevel: number;
  startedAt: string;
  completedAt?: string;
}

// ============================================================
// Escalation Types
// ============================================================

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationState {
  level: EscalationLevel;
/** Start time waiting for operator response after Level 2 */
  awaitingSince?: string;
/** Whether operator responds */
  acknowledged: boolean;
}

// ============================================================
// Configuration Types
// ============================================================

export interface RemediationConfig {
  enabled: boolean;
/** Whether to allow automatic execution of guarded actions */
  allowGuardedActions: boolean;
  cooldownMinutes: number;
  maxExecutionsPerHour: number;
  maxExecutionsPerDay: number;
/** Auto scale up max vCPU */
  maxAutoScaleVcpu: number;
/** Circuit breaker: Deactivation threshold for consecutive failures */
  circuitBreakerThreshold: number;
}

/** Circuit Breaker status */
export interface CircuitBreakerState {
  playbookName: string;
  consecutiveFailures: number;
  isOpen: boolean;
  openedAt?: string;
/** Deactivation time */
  resetAt?: string;
}
```

---

## 9. New module specifications

### 9.1 `src/lib/remediation-engine.ts`

Main orchestrator of Layer 4. Receive abnormal events and perform Playbook matching → execution → monitoring.

```typescript
/**
 * Layer 4: Auto-Remediation Engine
* Anomaly detection → automatic recovery loop completion
 */

// === Public API ===

/** Run automatic recovery for abnormal events */
export async function executeRemediation(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult,
  rca?: RCAResult
): Promise<RemediationExecution>;

/** Manual Playbook execution */
export async function executePlaybook(
  playbookName: string,
  triggeredBy: 'manual'
): Promise<RemediationExecution>;

/** View/edit current settings */
export function getRemediationConfig(): RemediationConfig;
export function updateRemediationConfig(partial: Partial<RemediationConfig>): RemediationConfig;

/** Check execution history */
export function getExecutionHistory(limit?: number): RemediationExecution[];

/** Check Circuit Breaker status */
export function getCircuitBreakerStates(): CircuitBreakerState[];

/** Circuit Breaker manual reset */
export function resetCircuitBreaker(playbookName: string): void;
```

**Core logic:**

```
1. Config 확인 (enabled? simulation mode?)
2. Check Cooldown (recent runs and intervals)
3. Check rate limit (number of executions per hour/daily)
4. Check circuit breaker (whether the corresponding Playbook is active)
5. Playbook matching (pattern-based)
6. Check safety level for each action
- Safe → Run immediately
- Guarded → allowGuardedActions && Execute after checking restrictions
- Manual → Skip and escalate
7. Sequential execution of actions (including waitAfterMs)
8. Recheck metrics after execution (wait 30 seconds)
9. Run fallback or escalate if unresolved
10. Save results + notifications
```

### 9.2 `src/lib/playbook-matcher.ts`

A module that matches failure patterns to Playbooks.

```typescript
/**
 * Playbook Matcher
* AnomalyEvent + Metric/Log Pattern → Select appropriate Playbook
 */

/** List of registered Playbooks (hardcoded in code) */
export const PLAYBOOKS: Playbook[];

/** Find a Playbook matching an event */
export function matchPlaybook(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult,
  rca?: RCAResult
): Playbook | null;
```

**Matching Priority:**
1. `rootCause.component` based matching of RCA results (most accurate)
2. Matching based on DeepAnalysis’s `severity` + `affectedMetrics`
3. Matching based on the `anomalies` field of AnomalyEvent
4. No matching → Return `null` (AI fallback is handled by remediation-engine)

### 9.3 `src/lib/action-executor.ts`

Modules that execute individual recovery actions. Wrapping an existing K8s module.

```typescript
/**
 * Action Executor
* RemediationAction → Execute actual K8s action
 */

/** Execute a single action */
export async function executeAction(
  action: RemediationAction,
  config: K8sConfig
): Promise<ActionResult>;
```

**Execution logic for each action:**

| action | How it runs |
|------|---------|
| `collect_logs` | Calling existing log-ingester.ts |
| `health_check` | Check status with kubectl get pod + RPC call |
| `check_l1_connection` | L1 blockNumber lookup with viem |
| `describe_pod` | kubectl describe pod |
| `restart_pod` | kubectl delete pod (StatefulSet auto-regenerates) |
| `scale_up` | Calling `scaleOpGeth()` in k8s-scaler.ts |
| `scale_down` | Calling `scaleOpGeth()` in k8s-scaler.ts |
| `zero_downtime_swap` | zero-downtime-scaler.ts의 `zeroDowntimeScale()` 호출 |

### 9.4 `src/lib/remediation-store.ts`

Execution history and Circuit Breaker status are managed in-memory.

```typescript
/**
 * Remediation Store
* Execution history + Circuit Breaker status management (in-memory)
 */

/** Save execution records (store up to 100 records) */
export function addExecution(execution: RemediationExecution): void;

/** Check recent execution history */
export function getExecutions(limit?: number): RemediationExecution[];

/** Query the latest execution time of a specific Playbook (for cooldown) */
export function getLastExecutionTime(playbookName: string): Date | null;

/** Check the number of executions per hour/daily (for rate limit) */
export function getExecutionCount(windowMs: number): number;

/** Circuit Breaker status management */
export function recordFailure(playbookName: string): void;
export function recordSuccess(playbookName: string): void;
export function isCircuitOpen(playbookName: string): boolean;
export function getCircuitStates(): CircuitBreakerState[];
export function resetCircuit(playbookName: string): void;
```

---

## 10. Modify existing modules

### 10.1 Modify `src/lib/alert-dispatcher.ts`

Add a connection point to trigger Layer 4 automatic recovery after sending a Layer 3 notification:

```typescript
// Add to the end of the dispatch() function:
// Layer 4: Auto-Remediation trigger
if (config.autoRemediation !== false) {
  const { executeRemediation } = await import('./remediation-engine');
// Run asynchronously (does not block notification response)
  executeRemediation(event, analysis).catch(err =>
    console.error('[Layer4] Remediation failed:', err)
  );
}
```

### 10.2 Modify `src/types/anomaly.ts`

Add auto-recovery toggle to AlertConfig:

```typescript
// Add fields to AlertConfig:
export interface AlertConfig {
// ... existing field
/** Enable Layer 4 automatic recovery (default: false) */
  autoRemediation?: boolean;
}
```

---

## 11. API specification

### 11.1 `GET /api/remediation`

Check automatic recovery status and execution history.

**Response:**
```json
{
  "config": {
    "enabled": true,
    "allowGuardedActions": true,
    "cooldownMinutes": 5,
    "maxExecutionsPerHour": 3,
    "maxExecutionsPerDay": 10,
    "maxAutoScaleVcpu": 4,
    "circuitBreakerThreshold": 3
  },
  "circuitBreakers": [
    {
      "playbookName": "op-geth-resource-exhaustion",
      "consecutiveFailures": 0,
      "isOpen": false
    }
  ],
  "recentExecutions": [
    {
      "id": "rem_abc123",
      "playbookName": "op-geth-resource-exhaustion",
      "triggeredBy": "auto",
      "status": "success",
      "actions": [...],
      "escalationLevel": 0,
      "startedAt": "2026-02-09T06:30:00Z",
      "completedAt": "2026-02-09T06:31:15Z"
    }
  ]
}
```

### 11.2 `POST /api/remediation`

Manual Playbook execution.

**Request:**
```json
{
  "playbookName": "op-geth-resource-exhaustion"
}
```

### 11.3 `PATCH /api/remediation`

Change settings.

**Request:**
```json
{
  "enabled": true,
  "allowGuardedActions": false
}
```

---

## 12. Environment variables

| variable | default | Description |
|------|--------|------|
| `AUTO_REMEDIATION_ENABLED` | `false` | Auto-Recovery Kill Switch |
| `REMEDIATION_ALLOW_GUARDED` | `true` | Allow automatic execution of guarded actions |
| `REMEDIATION_COOLDOWN_MIN` | `5` | Same-target recovery interval (minutes) |
| `REMEDIATION_MAX_VCPU` | `4` | Automatic scale-up max vCPU |

**Reuse of existing environment variables:**
- `SCALING_SIMULATION_MODE=true` → All recovery actions Dry Run
- `ALERT_WEBHOOK_URL` → Send recovery result notification

---

## 13. Test verification

### 13.1 Unit testing

| test file | Verification target |
|------------|----------|
| `playbook-matcher.test.ts` | Pattern matching accuracy, priority, matching failure cases |
| `action-executor.test.ts` | Execution of each action type (simulation mode) |
| `remediation-engine.test.ts` | Cooldown, rate limit, circuit breaker 동작 |
| `remediation-store.test.ts` | History storage/search, circular buffer |

### 13.2 Integration test scenario

```
Scenario 1: op-geth OOM → automatic scale-up → normalization confirmation
Scenario 2: Failure 3 times in a row → Check Circuit Breaker operation
Scenario 3: Rate limit exceeded → Confirmation of execution refusal
Scenario 4: Manual action → Skip and confirm escalation
Scenario 5: Simulation mode → Check to leave only logs and not run
```

---

## 14. Dependency

```
Existing modules (use without changes):
├─ k8s-scaler.ts          → scale_up, scale_down 실행
├─ k8s-config.ts → Run kubectl command
├─ zero-downtime-scaler.ts → zero_downtime_swap 실행
└─ anomaly-event-store.ts → Refer to event ID

Existing modules (minor modifications):
├─ alert-dispatcher.ts → Add Layer 4 trigger connection point
└─ types/anomaly.ts → Add autoRemediation field to AlertConfig

New modules:
├─ types/remediation.ts → Type definition
├─ remediation-engine.ts → Orchestrator
├─ playbook-matcher.ts → Pattern matching
├─ action-executor.ts → Action execution
└─ remediation-store.ts → Save history

New API:
  └─ /api/remediation        → GET/POST/PATCH
```

```
Dependent direction:
  alert-dispatcher.ts
    └─▶ remediation-engine.ts
           ├─▶ playbook-matcher.ts
           ├─▶ action-executor.ts
│ ├─▶ k8s-scaler.ts (existing)
│ ├─▶ zero-downtime-scaler.ts (existing)
│ └─▶ k8s-config.ts (existing)
           └─▶ remediation-store.ts
```
