# Phase 6: PlaybookEvolver - Dynamic Playbook Learning and Evolution System

**Date**: 2026-03-15
**Status**: Design Complete - Ready for Implementation
**Phase**: 6 (follows Phase 5: Abstract Playbook Layer Integration)

---

## Executive Summary

Phase 6 introduces an **automatic playbook evolution system** that learns from remediation execution results and generates optimized playbooks using Claude API. The system continuously monitors operation ledgers, identifies success/failure patterns, generates improved playbooks, validates them via A/B testing, and safely promotes winners while maintaining version rollback capabilities.

**Key Innovation**: Closed-loop feedback from execution metrics → pattern analysis → LLM-driven playbook generation → parallel A/B testing → safe promotion/rollback.

---

## 1. Architecture Overview

### Execution Flow

```
AnomalyEvent (detected)
    ↓
RemediationEngine (Phase 5)
    ├─ Execute current playbook
    ├─ Record result → OperationRecord (Redis)
    └─ Return RemediationExecution
    ↓
[Accumulate 20+ records OR 4h elapsed]
    ↓
PatternMiner (triggered)
    ├─ Analyze operation ledger
    ├─ Extract success/failure patterns
    ├─ Identify effective actions & anomaly correlations
    └─ Store patterns (Redis: marketplace:patterns:*)
    ↓
PlaybookEvolver (Claude API)
    ├─ Build LLM context (patterns + metrics + chain config)
    ├─ Call Claude API → generate new playbook
    ├─ Validate structure & type safety
    └─ Store evolved playbook v-N (Redis)
    ↓
ABTestController (parallel execution)
    ├─ On next anomaly: trigger A/B test
    ├─ 50/50 split execution (existing vs evolved)
    ├─ Collect metrics in real-time
    ├─ Calculate confidence (Fisher's exact test)
    └─ Auto-promote when confidence ≥ 85%
    ↓
RollbackManager (version control)
    ├─ Maintain 10-version history
    ├─ Track playbook metadata (confidence, A/B results)
    ├─ Enable manual rollback from dashboard
    └─ Auto-rollback on confidence < 70%
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Phase 5 (existing)                   │
│            RemediationEngine & Operation Ledger         │
│  (generates operation records + execution metrics)      │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ↓                             ↓
    ┌───────────────┐           ┌──────────────┐
    │ PatternMiner  │           │   Redis      │
    │               │───────→   │ Operation    │
    │ (analyze      │           │ Ledger       │
    │  20+ records) │           │ Storage      │
    └───────┬───────┘           └──────────────┘
            │
            ↓ (patterns extracted)
    ┌──────────────────────────┐
    │  PlaybookEvolver         │
    │  (Claude API + LLM)      │
    │  Generate playbook v-N   │
    └────────┬─────────────────┘
             │
             ↓
    ┌──────────────────────────┐      ┌─────────────────┐
    │  ABTestController        │      │ RollbackManager │
    │  (50/50 parallel exec)   │─────→│ (version ctrl)  │
    │  Compute confidence      │      │ (10 versions)   │
    └────────┬─────────────────┘      └─────────────────┘
             │
        ┌────┴─────┐
        ↓          ↓
   [≥85%]     [<70%]
      │          │
      ↓          ↓
   Promote   Rollback
   (v-N)     (v-N-1)
```

### Component Responsibilities

| Component | Responsibility |
|-----------|-----------------|
| **PatternMiner** | Analyze operation ledger → extract patterns |
| **PlaybookEvolver** | Generate improved playbooks via Claude API |
| **ABTestController** | Execute & compare playbooks in parallel |
| **RollbackManager** | Manage versions, enable safe rollback |

---

## 2. Key Components

### 2.1 PatternMiner

**Purpose**: Extract actionable patterns from operation ledger.

**Input**: OperationRecord[] (20+ records with success/failure metrics)

**Output**: IncidentPattern[] (success rates, effective actions, anomaly correlations)

```typescript
import { z } from 'zod';

export interface IncidentPattern {
  anomalyType: string;           // 'high_cpu', 'high_memory', etc.
  effectiveAction: string;       // 'scale_up', 'scale_down', etc.
  successRate: number;           // 0-100%
  executionCount: number;        // number of successful executions
  avgDuration: number;           // milliseconds
  correlationStrength: number;   // 0-1 (anomaly → action success)
}

// Zod runtime validation
export const IncidentPatternSchema = z.object({
  anomalyType: z.string().min(1),
  effectiveAction: z.string().min(1),
  successRate: z.number().min(0).max(100),
  executionCount: z.number().min(0),
  avgDuration: z.number().min(0),
  correlationStrength: z.number().min(0).max(1),
});
```

**Key Operations**:
- Count successes per (anomaly_type, action) pair
- Calculate success_rate = successes / total
- Identify highest success_rate action per anomaly type
- Detect anomaly patterns (e.g., high_cpu always responds well to scale_up)

### 2.2 PlaybookEvolver

**Purpose**: Generate improved playbooks using Claude API.

**Input**:
- Patterns (from PatternMiner)
- Current metrics context (success rates, chain config)
- Playbook constraints (max actions, timeout)

**Output**: EvolvedPlaybook (validated structure, ready for A/B testing)

**EvolvedPlaybook Type Definition**:

```typescript
import { z } from 'zod';

// Extends Phase 5 Playbook with evolution metadata
export interface EvolvedPlaybook extends Playbook {
  // From Phase 5 Playbook
  // id: string;
  // name: string;
  // description: string;
  // actions: RemediationAction[];
  // fallbacks: RemediationAction[];
  // timeout: number;

  // New fields for Phase 6
  versionId: string;                    // "v-5", "v-4", etc.
  parentVersionId: string;              // "v-4" (evolved from this)
  generatedAt: Date;
  generatedBy: 'claude-sonnet-4-5-20250929' | 'manual';
  confidenceSource: 'llm_generation' | 'pattern_analysis';

  // LLM usage tracking
  generationPromptUsage: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number; // in cents
  };

  // Pattern context used for generation
  patternContext: {
    patterns: IncidentPattern[];
    successRateBaseline: number;  // Previous playbook success rate
  };
}

// RemediationAction schema (from Phase 5)
const RemediationActionSchema = z.object({
  type: z.enum(['scale', 'evict', 'restart', 'drain']),
  target: z.string().min(1),
  params: z.record(z.any()).optional(),
  timeout: z.number().min(1000).max(30000),
});

// Zod schema for runtime validation
export const EvolvedPlaybookSchema = z.object({
  // Existing Playbook fields (inferred from base)
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  actions: z.array(RemediationActionSchema).min(1).max(3),
  fallbacks: z.array(RemediationActionSchema).min(1).max(2),
  timeout: z.number().min(1000).max(60000),

  // Phase 6 fields
  versionId: z.string().regex(/^v-\d+$/),
  parentVersionId: z.string().regex(/^v-\d+$/),
  generatedAt: z.date(),
  generatedBy: z.enum(['claude-sonnet-4-5-20250929', 'manual']),
  confidenceSource: z.enum(['llm_generation', 'pattern_analysis']),
  generationPromptUsage: z.object({
    inputTokens: z.number().min(0),
    outputTokens: z.number().min(0),
    totalCost: z.number().min(0),
  }),
  patternContext: z.object({
    patterns: z.array(IncidentPatternSchema),
    successRateBaseline: z.number().min(0).max(100),
  }),
});

export type EvolvedPlaybook = z.infer<typeof EvolvedPlaybookSchema>;
```

**LLM Prompt Context**:
```
You are a Kubernetes remediation expert.
Given success/failure patterns from execution history,
generate an improved playbook with:
1. Actions ordered by effectiveness
2. Fallback actions if primary fails
3. Timeouts & retry logic
4. Chain-specific constraints (e.g., Optimism L2)

Constraints:
- Max 3 primary actions
- Each action must have fallback
- Confidence: based on pattern success_rate
- Must execute within 30s
```

**Validation**: Zod schema + type safety (0 TypeScript errors)

### 2.3 ABTestController

**Purpose**: Compare existing vs evolved playbook via parallel A/B testing.

**Execution Model**:
- New anomaly detected → trigger A/B test
- Each execution: 50% chance existing, 50% chance evolved
- Collect metrics: success (yes/no), duration, actions taken
- Compute confidence dynamically

**Confidence Calculation** (Fisher's Exact Test):
```
p_existing = successes_existing / total_existing
p_evolved = successes_evolved / total_evolved

If p_evolved > p_existing:
  confidence = z_score(p_evolved, p_existing) / z_max
  if confidence ≥ 85%: promote evolved
```

**Output**: ABTestResult with winner + confidence score

### 2.4 RollbackManager

**Purpose**: Manage playbook versions, enable safe rollback.

**Version Storage** (Redis):
```
marketplace:playbooks:current              # active playbook
marketplace:playbooks:versions:v-N         # version details
marketplace:playbooks:history              # [v-5, v-4, v-3, ...]
```

**Features**:
- Keep 10 most recent versions
- Track: createdAt, promotedAt, confidenceScore, A/B metrics
- Atomic version switch (Redis transaction)
- Manual rollback from dashboard
- Auto-rollback on confidence < 70%

---

## 3. Data Flow

### Trigger Point: Pattern Mining Initiation

**Location**: `src/lib/remediation-engine.ts` (Phase 5 integration point)

```typescript
// After RemediationExecution completes
async function executeRemediation(anomaly: AnomalyEvent, analysis: Analysis) {
  const execution = await playbook.execute(anomaly);

  // 1. Record operation result
  await operationLedger.record({
    executionId: execution.id,
    success: execution.status === 'success',
    action: execution.action,
    duration: execution.duration,
  });

  // 2. Check evolution trigger (non-blocking)
  const shouldEvolve = await PatternMiner.shouldTriggerEvolution();
  if (shouldEvolve) {
    // Async: don't block remediation
    PatternMiner.analyzeAndEvolve().catch(err => {
      logger.error('Evolution failed (non-blocking)', { err });
      // Monitoring alert: evolution failure
    });
  }

  return execution;
}

// src/lib/pattern-miner.ts
export async function shouldTriggerEvolution(): Promise<boolean> {
  const recordCount = await store.getOperationRecordCount();
  const lastEvolution = await store.getLastEvolutionTime();
  const timeSinceLastEvolution = Date.now() - lastEvolution;

  const RECORD_THRESHOLD = 20;
  const TIME_THRESHOLD = 4 * 60 * 60 * 1000; // 4h

  return recordCount >= RECORD_THRESHOLD || timeSinceLastEvolution >= TIME_THRESHOLD;
}

export async function analyzeAndEvolve(): Promise<Result<EvolvedPlaybook, EvolutionError>> {
  // Non-blocking, runs in background
  // If fails: existing playbook remains active (graceful fallback)
}
```

### Normal Flow (Successful Evolution)

```
1. RemediationEngine executes playbook
   └─→ Record OperationRecord
   └─→ Check: (recordCount ≥ 20) OR (4h elapsed)?
       ├─ YES: Trigger PatternMiner.analyzeAndEvolve() [async, non-blocking]
       └─ NO: Continue

2. PatternMiner.analyzeAndEvolve()
   Input: 20+ OperationRecord from Redis
   Output: IncidentPattern[] (5-10 patterns)
   Storage: marketplace:patterns:* (TTL: 24h)

3. PlaybookEvolver
   Input: Patterns + context
   LLM Call: Claude API (2000 max tokens)
   Output: EvolvedPlaybook (validated)
   Storage: marketplace:playbooks:v-5 (TTL: ∞)
   Current: Updated to v-5

4. Next Anomaly
   A/B Test Initialize: 50/50 split starts

5. Execution Loop
   For each execution:
     - Record success (yes/no)
     - Update metrics in Redis
     - Recalculate confidence

6. Confidence ≥ 85%
   └─→ Promote v-5 as current
   └─→ Move v-4 to history (kept for rollback)

7. Dashboard
   Shows: "A/B Test Complete. Evolved wins (87% confidence)"
```

### Error Flow (With Fallback)

```
PlaybookEvolver
├─ Claude API timeout
│  ├─ Retry 3x (exponential backoff)
│  └─ Fallback: Use existing playbook
│
├─ Invalid JSON response
│  └─ Fallback: Use existing playbook
│
└─ Type validation fail
   └─ Fallback: Use existing playbook

A/B Test
├─ Metric collection incomplete
│  └─ Use partial results (lower confidence)
│
└─ Execution timeout
   └─ Record as failure, continue

Rollback
├─ Version restore fails
│  ├─ Retry 3x (exponential backoff)
│  └─ Eventually restore via Redis backup
```

### Storage & Cleanup Policy

**Retention & TTL**:
```
marketplace:playbooks:current         # Active playbook (TTL: ∞)
marketplace:playbooks:versions:v-N    # Version details (TTL: ∞, keep 10 latest)
marketplace:playbooks:history         # Version IDs list (TTL: ∞)
marketplace:patterns:*                # Extracted patterns (TTL: 24h)
marketplace:ab-tests:*                # A/B test results (TTL: 7d)
```

**Cleanup Schedule** (Daily, 3 AM):
```typescript
// src/lib/redis-cleanup.ts
export async function cleanupOldVersions(maxVersions = 10) {
  const history = await store.getPlaybookHistory();
  if (history.length > maxVersions) {
    const toDelete = history.slice(maxVersions);
    for (const versionId of toDelete) {
      await store.deletePlaybookVersion(versionId);
      logger.info(`Deleted old version ${versionId}`);
    }
  }
}

export async function cleanupExpiredPatterns(maxAge = 24 * 60 * 60 * 1000) {
  // Redis expires patterns automatically via TTL
  logger.info('Patterns expired by Redis TTL (24h)');
}

// Scheduled: cron('0 3 * * *') - daily at 3 AM
```

### History & Versioning

```
marketplace:playbooks:history
  [v-5, v-4, v-3, v-2, v-1, v0, ...]  (max 10 items)

marketplace:playbooks:versions:v-5
  {
    id: "v-5",
    playbookData: {...},
    createdAt: "2026-03-15T10:00:00Z",
    promotedAt: "2026-03-15T11:30:00Z",
    evolvedFrom: "v-4",
    confidenceScore: 87.3,
    abTestDuration: 3600000,
    successMetrics: {
      existing: { successRate: 90%, count: 100 },
      evolved: { successRate: 95%, count: 100 }
    },
    rollbackReason: null
  }

marketplace:playbooks:versions:v-4
  {
    id: "v-4",
    ...,
    status: "rolled_back",
    rolledBackAt: "2026-03-15T11:25:00Z",
    rollbackReason: "User manual rollback"
  }
```

---

## 4. PlaybookEvolver Workflow

### Trigger Conditions (Hybrid Schedule)

**Trigger PlaybookEvolver when**:
1. **20+ operation records** accumulated (immediate), OR
2. **4 hours elapsed** since last evolution (scheduled)

**Implementation**:
```typescript
// src/lib/evolution-scheduler.ts
const RECORD_THRESHOLD = 20;
const TIME_THRESHOLD = 4 * 60 * 60 * 1000; // 4h

async function shouldTriggerEvolution(): Promise<boolean> {
  const recordCount = await store.getOperationRecordCount();
  const lastEvolution = await store.getLastEvolutionTime();
  const timeSinceLastEvolution = Date.now() - lastEvolution;

  return recordCount >= RECORD_THRESHOLD
    || timeSinceLastEvolution >= TIME_THRESHOLD;
}
```

### LLM Prompt Design

```
System: You are a Kubernetes remediation playbook expert specializing in L2 blockchain infrastructure.

Context:
- Observed Patterns from Operation Ledger:
  * high_cpu + scale_up: 92% success (n=50)
  * high_cpu + scale_down: 15% success (n=20)
  * high_memory + evict_pods: 78% success (n=45)
  * high_memory + restart_service: 62% success (n=30)
  * low_throughput + restart_sequencer: 55% success (n=20) ⚠️ risky, avoid if possible

- Current Baseline:
  - Existing playbook success: 87% (100/115 executions)
  - Your goal: Generate playbook with 95%+ success rate

- Target Chain Configuration:
  - Chain: Optimism L2 (OP Stack)
  - Constraints:
    ✓ Can scale pods up (proven safe: 92% success)
    ✓ Can evict pods (moderate risk: 78% success)
    ✓ Can restart services (moderate risk: 62% success)
    ✗ NEVER force-restart sequencer (breaks L2 finality, data loss risk)
    ✗ NEVER delete transaction pool (unrecoverable)
    ✗ NEVER modify rollup configuration without state migration
    ✓ Prefer gradual scaling (rolling updates, not abrupt)
  - Max concurrent actions: 1 (sequential, not parallel)
  - Max actions per playbook: 3 primary + 2 fallback
  - Action timeout: 30s per action, 120s total
  - Estimated cost: < $5 per execution

Task: Generate an improved playbook that:
1. Prioritizes actions by success rate (sort descending)
2. Includes 2+ fallback actions for high-impact anomalies
3. Avoids risky actions (low success rate < 60%)
4. Respects all chain-specific constraints
5. Matches the EvolvedPlaybook TypeScript schema exactly

Output format: Valid JSON only, no markdown or comments
```

### LLM Response Validation

```typescript
// src/lib/playbook-evolver.ts
async function evolvePlaybook(
  patterns: IncidentPattern[],
  context: LLMContext
): Promise<Result<EvolvedPlaybook, EvolutionError>> {
  try {
    // Call Claude API (with retries)
    const response = await withRetry(
      () => anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(patterns, context) }],
      }),
      { maxAttempts: 3, backoff: "exponential" }
    );

    // Parse JSON
    const json = JSON.parse(response.content[0].text);

    // Validate against Zod schema
    const validation = EvolvedPlaybookSchema.safeParse(json);
    if (!validation.success) {
      return Err(new ValidationError("Invalid playbook structure"));
    }

    // Type-safe result
    return Ok(validation.data);
  } catch (error) {
    logger.error("Playbook evolution failed", { error });
    return Err(new EvolutionError("LLM generation failed"));
  }
}
```

### Confidence Scoring Logic

```typescript
export function computeConfidence(results: {
  existing: ExecutionResult[];
  evolved: ExecutionResult[];
}): { confidence: number; winner: 'existing' | 'evolved' } {
  const p_existing = results.existing.filter(r => r.success).length / results.existing.length;
  const p_evolved = results.evolved.filter(r => r.success).length / results.evolved.length;

  // Fisher's exact test approximation
  const z_score = Math.abs(p_evolved - p_existing) / Math.sqrt(
    (p_existing * (1 - p_existing) / results.existing.length) +
    (p_evolved * (1 - p_evolved) / results.evolved.length)
  );

  // Normalize to 0-100%
  const confidence = Math.min(100, (z_score / 2.576) * 100); // z=2.576 → 99% CI

  return {
    confidence,
    winner: p_evolved > p_existing ? 'evolved' : 'existing',
  };
}
```

---

## 5. A/B Testing

### Test Initialization

**On next anomaly after playbook generation**:
```typescript
async function initializeABTest(
  currentPlaybook: Playbook,
  evolvedPlaybook: EvolvedPlaybook
): Promise<ABTest> {
  return {
    id: `ab-test-${Date.now()}`,
    status: 'in_progress',
    existingPlaybook: currentPlaybook,
    evolvedPlaybook: evolvedPlaybook,
    results: { existing: [], evolved: [] },
    startedAt: new Date(),
    confidence: 50, // initial
  };
}
```

### A/B Test State Machine

**Confidence threshold & decision logic**:

```
State: COLLECTING
├─ 0% ≤ confidence < 70%   → Continue collecting
│                          → Show "In Progress" on dashboard
│
├─ 70% ≤ confidence < 85%  → WARNING state
│                          → Show "Caution" flag
│                          → Allow manual early stop
│
└─ confidence ≥ 85%        → DECISION_READY
                            ├─ IF evolved_winner → PROMOTE evolved ✅
                            ├─ IF existing_winner → STOP test, keep existing
                            └─ Notify dashboard operator

Auto-Rollback (emergency):
├─ IF confidence drops < 70% mid-test
│  ├─ Rollback to existing playbook
│  ├─ Send alert to oncall
│  └─ Mark as "rolled_back"

Sample Size Requirement:
├─ Minimum: 30 total executions (n ≥ 30)
├─ Fisher's exact test requires n ≥ 30 for validity
├─ Below 30: Low confidence even if > 85%
└─ Goal: 60+ samples for 99% confidence
```

**Confidence Validity Check**:
```typescript
const MIN_SAMPLE_SIZE = 30;  // Fisher's exact test minimum
const RECOMMENDED_SAMPLE_SIZE = 60;  // For 99% confidence

function isStatisticallyValid(results: ABTestResults): boolean {
  const n = results.existing.length + results.evolved.length;
  return n >= MIN_SAMPLE_SIZE;
}

function canPromote(confidence: number, results: ABTestResults): boolean {
  // Both conditions must be true
  return confidence >= 85 && isStatisticallyValid(results);
}
```

### Parallel Execution

**50/50 split logic**:
```typescript
async function selectPlaybookForExecution(
  abTest: ABTest
): Promise<'existing' | 'evolved'> {
  const shouldUseEvolved = Math.random() < 0.5;
  return shouldUseEvolved ? 'evolved' : 'existing';
}
```

**Execution recording**:
```typescript
async function recordExecution(
  abTestId: string,
  result: { playbook: 'existing' | 'evolved'; success: boolean; duration: number }
): Promise<void> {
  const test = await store.getABTest(abTestId);
  test.results[result.playbook].push(result);

  // Recalculate confidence
  const confidence = computeConfidence(test.results);
  await store.updateABTest(abTestId, { confidence });

  // Auto-promote if confidence >= 85%
  if (confidence >= 85 && result.playbook === 'evolved') {
    await promotePlaybook(test.evolvedPlaybook, confidence);
  }
}
```

### Dashboard Display

```typescript
// src/app/v2/marketplace/components/ABTestStatus.tsx
<ABTestStatus>
  <h3>A/B Test in Progress</h3>
  <ProgressBar existing={48} evolved={52} />
  <Metrics
    existingSuccess={90}
    evolvedSuccess={95}
  />
  <ConfidenceScore
    value={82}
    threshold={85}
    status={confidence >= 85 ? 'Ready to Promote' : 'Collecting'}
  />
  <Button onClick={handleEarlyPromote}>Promote Now</Button>
  <Button onClick={handleStopTest}>Stop Test</Button>
</ABTestStatus>
```

---

## 6. E2E Test Coverage (Playwright)

### 5 Core E2E Scenarios

**Scenario 1: Trigger & Execution** (4-5min)
```typescript
test('should trigger playbook evolution on anomaly detection', async ({ page }) => {
  await page.goto('http://localhost:3002/v2/marketplace');

  // Simulate high CPU anomaly
  await page.evaluate(() => window.__triggerAnomaly('high_cpu'));

  // Verify remediation execution
  await expect(page.locator('text=Remediation in progress')).toBeVisible();

  // Check operation record saved
  const records = await page.evaluate(() => fetch('/api/operation-records').then(r => r.json()));
  expect(records.length).toBeGreaterThan(0);
});
```

**Scenario 2: Pattern Mining & Playbook Generation** (5-10min)
```typescript
test('should evolve playbook after collecting 20 operation records', async ({ page }) => {
  // Accumulate 20 records (or skip to simulate)
  await page.evaluate(() => window.__simulateRecords(20));

  // Trigger evolution
  await page.click('[data-action=trigger-evolution]');

  // Wait for Claude API response
  await expect(page.locator('text=Evolved playbook generated')).toBeVisible({ timeout: 30000 });

  // Verify version history updated
  const versions = await page.evaluate(() => fetch('/api/playbook-versions').then(r => r.json()));
  expect(versions[0].status).toBe('testing');
});
```

**Scenario 3: A/B Test Initialization** (2-3min)
```typescript
test('should initialize A/B test with new anomaly', async ({ page }) => {
  // Trigger new anomaly
  await page.evaluate(() => window.__triggerAnomaly('high_memory'));

  // Verify A/B test started
  await expect(page.locator('text=A/B Test Status')).toBeVisible();
  await expect(page.locator('text=50%')).toBeVisible(); // 50/50 split

  // Check initial state
  const test = await page.evaluate(() => fetch('/api/ab-test/current').then(r => r.json()));
  expect(test.status).toBe('in_progress');
  expect(test.confidence).toBe(50);
});
```

**Scenario 4: Parallel Execution & Confidence Update** (6-8min)
```typescript
test('should collect metrics and update confidence during A/B testing', async ({ page }) => {
  // A/B test running
  // Simulate 60 executions (30 existing, 30 evolved) - meets MIN_SAMPLE_SIZE
  await page.evaluate(() => window.__simulateABExecutions(60, { existing: 0.9, evolved: 0.95 }));

  // Wait for confidence calculation (with explicit timeout)
  await expect(page.locator('[data-testid=confidence-score]')).toContainText(/8[5-9]%|9\d%|100%/, {
    timeout: 30000,  // Wait up to 30s for metrics update
  });

  // Verify confidence is displayed (≥ 85%)
  const confidenceText = await page.locator('[data-testid=confidence-score]').textContent();
  const confidence = parseInt(confidenceText || '0');
  expect(confidence).toBeGreaterThanOrEqual(85);

  // Check evolved is marked as winner
  const test = await page.evaluate(() => fetch('/api/ab-test/current').then(r => r.json()));
  expect(test.winner).toBe('evolved');
  expect(test.status).toBe('ready_to_promote');
});
```

**Scenario 5: Rollback & Recovery** (3-4min)
```typescript
test('should successfully rollback to previous playbook version', async ({ page }) => {
  // Navigate to version history
  await page.goto('http://localhost:3002/v2/marketplace/versions');

  // Click rollback on v-3
  await page.click('[data-version=v-3] [data-action=rollback]');

  // Confirm rollback
  await page.click('button:has-text("Confirm")');

  // Verify rollback succeeded
  await expect(page.locator('text=Rollback succeeded')).toBeVisible({ timeout: 5000 });

  // Check current version
  const current = await page.evaluate(() => fetch('/api/current-playbook').then(r => r.json()));
  expect(current.id).toBe('v-3');
});
```

### Test Support Infrastructure

**E2E Test Hooks Setup** (`src/test-utils/anomaly-triggers.ts`):

```typescript
// src/test-utils/anomaly-triggers.ts
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __triggerAnomaly: (type: string, severity?: string) => Promise<void>;
    __simulateRecords: (count: number) => Promise<void>;
    __simulateABExecutions: (count: number, successRates: { existing: number; evolved: number }) => Promise<void>;
  }
}

export function setupAnomalyTriggers(page: Page) {
  return page.addInitScript(() => {
    if (typeof window === 'undefined') return;

    // Trigger anomaly detection (calls /api/test/anomaly)
    window.__triggerAnomaly = async (type: string, severity: string = 'critical') => {
      const response = await fetch('/api/test/anomaly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anomalyType: type, severity }),
      });
      if (!response.ok) throw new Error(`Failed to trigger anomaly: ${response.statusText}`);
      return response.json();
    };

    // Simulate N operation records (calls /api/test/operation-records)
    window.__simulateRecords = async (count: number) => {
      const response = await fetch('/api/test/operation-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      if (!response.ok) throw new Error(`Failed to simulate records: ${response.statusText}`);
      return response.json();
    };

    // Simulate A/B test executions with target success rates
    window.__simulateABExecutions = async (count: number, successRates: { existing: number; evolved: number }) => {
      const response = await fetch('/api/test/ab-executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, successRates }),
      });
      if (!response.ok) throw new Error(`Failed to simulate A/B executions: ${response.statusText}`);
      return response.json();
    };
  });
}
```

**Integration in Playwright tests**:
```typescript
// website/e2e/playbook-evolution.spec.ts
import { test, expect } from '@playwright/test';
import { setupAnomalyTriggers } from '@/test-utils/anomaly-triggers';

test.beforeEach(async ({ page }) => {
  await setupAnomalyTriggers(page);
});
```

### Test Support API Endpoints

**Available only in test/dev mode (`process.env.NODE_ENV === 'test'`)**:

```typescript
// src/app/api/test/anomaly/route.ts
// POST /api/test/anomaly
// Payload: { anomalyType: string; severity?: 'low' | 'medium' | 'critical' }
// Response: { anomalyId: string; recorded: boolean }

// src/app/api/test/operation-records/route.ts
// POST /api/test/operation-records
// Payload: { count: number }
// Response: { simulated: number; totalRecords: number }

// src/app/api/test/ab-executions/route.ts
// POST /api/test/ab-executions
// Payload: { count: number; successRates: { existing: number; evolved: number } }
// Response: { executions: number; distributionValid: boolean }
```

### Test Execution

```bash
npm run test:e2e -- website/e2e/playbook-evolution.spec.ts

# Expected output:
# ✓ Trigger & Execution (5s)
# ✓ Pattern Mining & Playbook Generation (12s)
# ✓ A/B Test Initialization (3s)
# ✓ Parallel Execution & Confidence Update (8s)
# ✓ Rollback & Recovery (4s)
#
# 5 passed (32s)
```

---

## 7. Error Handling & Fallback

### Error Scenarios & Responses

| Error | Detection | Action | Result |
|-------|-----------|--------|--------|
| Claude API timeout | PlaybookEvolver | Retry 3x (exponential backoff) | Fall back to existing playbook |
| Invalid LLM response | JSON parse error | Log error & fallback | Existing playbook retained |
| Redis connection fail | State store error | Fall back to in-memory cache | Graceful degradation |
| A/B metrics incomplete | Missing execution data | Use partial results (lower confidence) | Conservative decision |
| Evolved playbook invalid | Type validation fail | Discard & fallback | Existing playbook safe |
| Rollback fails | Version restore error | Retry 3x with exponential delay | Eventually restore from backup |

### Implementation Patterns

```typescript
// Retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; backoff: 'exponential' | 'linear' }
): Promise<T> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === options.maxAttempts - 1) throw error;
      const delay = options.backoff === 'exponential'
        ? Math.pow(2, attempt) * 1000
        : (attempt + 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// Fallback pattern
async function evolvePlaybook(patterns, context): Promise<Result<EvolvedPlaybook>> {
  try {
    return await PlaybookEvolver.generate(patterns, context);
  } catch (error) {
    logger.error('Evolution failed, using existing playbook', { error });
    return Err(new EvolutionError('LLM generation failed'));
    // Caller will use existing playbook as fallback
  }
}
```

### Monitoring & Alerts

```typescript
export interface EvolutionMetrics {
  evolutionAttempts: number;
  evolutionSuccesses: number;
  evolutionFailures: number;     // Fallback triggered
  rollbackCount: number;
  abTestTimeouts: number;
  lastErrorTime: Date | null;
  lastErrorMessage: string | null;
}

// Dashboard display:
// "Evolutions: 10/12 succeeded (83.3%)"
// "Last rollback: 2 hours ago"
// "Current confidence: 87%"
```

---

## 8. Rollback Mechanism

### Version Storage & ID Scheme (Redis)

**Version ID Format**: `v-N` where N is sequential integer (starting from 0 for Phase 5 baseline)

```
Phase 5 Initial State (baseline):
  marketplace:playbooks:current → { id: "v0", name: "baseline-playbook" }

Phase 6 Evolution Timeline:
  1st Evolution: v0 → v1 (parentVersionId: "v0")
  2nd Evolution: v1 → v2 (parentVersionId: "v1")
  3rd Evolution: v2 → v3 (parentVersionId: "v2")
  [Only 10 most recent kept in history]

Storage Keys:
marketplace:playbooks:current             # Active playbook (TTL: ∞)
  ├─ id: "v3"
  ├─ status: "active"
  ├─ promotedAt: timestamp
  └─ ...

marketplace:playbooks:versions:v3         # Version details (TTL: ∞)
  ├─ playbookData: {...}
  ├─ createdAt: timestamp
  ├─ promotedAt: timestamp
  ├─ parentVersionId: "v2"
  ├─ confidenceScore: 87.3
  ├─ successMetrics: { existing: 90%, evolved: 95% }
  └─ rollbackReason: null

marketplace:playbooks:history             # [v3, v2, v1, v0] (max 10)
  [v3, v2, v1, v0]

marketplace:patterns:*                    # TTL: 24h
marketplace:ab-tests:*                    # TTL: 7d
```

### Rollback Scenarios

**Scenario 1: Auto Rollback (Low Confidence)**
```
A/B Test: confidence drops below 70%
  ↓
Auto-rollback triggered
  ↓
Previous version restored
  ↓
Dashboard notifies operator
```

**Scenario 2: Manual Rollback (Dashboard)**
```
Operator clicks [Rollback to v-3]
  ↓
RollbackManager.rollbackToVersion('v-3', reason)
  ↓
Version restored atomically (Redis transaction)
  ↓
Confirmation & notification
```

**Scenario 3: Emergency Rollback**
```
Monitoring alert: "85% execution failure rate"
  ↓
Auto-promote last stable version (confidence > 85%)
  ↓
Oncall notified immediately
```

### RollbackManager Implementation

```typescript
async function rollbackToVersion(
  versionId: string,
  reason?: string,
  options?: { force?: boolean; maxRetries?: number }
): Promise<Result<PlaybookVersion>> {
  const { force = false, maxRetries = 3 } = options || {};

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1. Verify version exists
      const targetVersion = await store.getPlaybookVersion(versionId);
      if (!targetVersion) {
        return Err(new RollbackError(`Version ${versionId} not found`));
      }

      // 2. Backup current version
      const currentPlaybook = await store.getCurrentPlaybook();
      if (currentPlaybook && !force) {
        await store.markPlaybookVersion(currentPlaybook.id, {
          status: 'rolled_back',
          rollbackReason: reason || 'Manual rollback',
          rolledBackTo: versionId,
        });
      }

      // 3. Atomic version switch
      await store.setCurrentPlaybook({
        ...targetVersion.playbookData,
        id: versionId,
        status: 'active',
        promotedAt: new Date(),
      });

      // 4. Update history
      await addToHistory(versionId);

      logger.info(`Rollback to ${versionId} succeeded`, { reason });
      return Ok(targetVersion);
    } catch (error) {
      logger.warn(`Rollback attempt ${attempt + 1}/${maxRetries} failed`, { error, versionId });

      if (attempt < maxRetries - 1) {
        await delay(Math.pow(2, attempt) * 1000);
        continue;
      }
    }
  }

  return Err(new RollbackError(`Rollback failed after ${maxRetries} attempts`));
}
```

### Version History UI

```
[v-5] ACTIVE (87% confidence)
  Created: 2h ago | Promoted: 1h 45m ago
  Parent: v-4 | Success Rate: 95%
  [Rollback] [Compare]

[v-4] ROLLED BACK (82% confidence)
  Created: 4h ago | Rolled Back: 15m ago
  Reason: Manual rollback by operator
  [Restore] [Compare]

[v-3] STABLE (85% confidence)
  Created: 8h ago | Success Rate: 88%
  [Restore]
```

---

## 9. Testing Strategy

### Test Pyramid

```
           ┌─ E2E (Playwright) ─────────────┐
           │ Full user journey               │
           │ 5 scenarios, ~30s total         │
           │ Target: 100% pass               │
           ├─────────────────────────────────┤
           │                                 │
      ┌────┴─ Integration Tests (Vitest) ───┤
      │    │ PatternMiner + Redis store      │
      │    │ PlaybookEvolver + operation     │
      │    │ A/B Testing + metrics           │
      │    │ Rollback + version history      │
      │    │ Target: 85%+ coverage           │
      │    ├─────────────────────────────────┤
      │    │                                 │
┌─────┴────┴─ Unit Tests (Vitest) ────────┐
│     │    Pattern extraction              │
│     │    LLM mocking & validation         │
│     │    Confidence calculation           │
│     │    Version management               │
│     │    Target: 80%+ coverage            │
└─────┴────────────────────────────────────┘
```

### Unit Test Coverage Goals

| Module | Target | Layer |
|--------|--------|-------|
| `pattern-miner.ts` | 85%+ | Unit + Integration |
| `playbook-evolver.ts` | 80%+ | Unit + Integration (LLM mocked) |
| `ab-test-controller.ts` | 85%+ | Unit + Integration |
| `rollback-manager.ts` | 90%+ | Unit + Integration |
| `playbook-evolution.spec.ts` | Full cycle | E2E (Playwright) |
| **Overall** | **80%+** | All layers |

### Unit Test Examples

```typescript
// pattern-miner.test.ts
describe('PatternMiner', () => {
  it('should extract success patterns', () => {
    const patterns = PatternMiner.extractPatterns([
      { anomalyType: 'high_cpu', action: 'scale_up', success: true },
      { anomalyType: 'high_cpu', action: 'scale_up', success: true },
    ]);
    expect(patterns.find(p => p.action === 'scale_up')?.successRate).toBe(100);
  });

  it('should handle edge case: 0 records', () => {
    const patterns = PatternMiner.extractPatterns([]);
    expect(patterns).toEqual([]);
  });

  it('should handle edge case: 1 record (no statistical power)', () => {
    const patterns = PatternMiner.extractPatterns([
      { anomalyType: 'high_cpu', action: 'scale_up', success: true },
    ]);
    expect(patterns[0].successRate).toBe(100);
    expect(patterns[0].executionCount).toBe(1);
    // Note: confidence should be low for n=1
  });

  it('should handle edge case: all failures (0% success)', () => {
    const patterns = PatternMiner.extractPatterns([
      { anomalyType: 'high_cpu', action: 'scale_down', success: false },
      { anomalyType: 'high_cpu', action: 'scale_down', success: false },
    ]);
    expect(patterns.find(p => p.action === 'scale_down')?.successRate).toBe(0);
  });
});

// playbook-evolver.test.ts (with LLM mocking)
describe('PlaybookEvolver', () => {
  beforeEach(() => {
    vi.mock('anthropic', () => ({
      Anthropic: vi.fn(() => ({
        messages: { create: vi.fn().mockResolvedValue(...) },
      })),
    }));
  });

  it('should generate valid playbook', async () => {
    const result = await PlaybookEvolver.evolvePlaybook(patterns, context);
    expect(result.isOk()).toBe(true);
  });
});

// ab-test-controller.test.ts
describe('ABTestController', () => {
  it('should split execution 50/50 with statistical validity', async () => {
    const choices = [];
    for (let i = 0; i < 200; i++) {
      const choice = ABTestController.selectPlaybook(existing, evolved);
      choices.push(choice === 'existing' ? 0 : 1);
    }

    // Verify ±15% distribution (200 samples)
    const existingCount = choices.filter(c => c === 0).length;
    const evolvedCount = choices.filter(c => c === 1).length;
    const existingRatio = existingCount / 200;
    const evolvedRatio = evolvedCount / 200;

    expect(Math.abs(existingRatio - 0.5)).toBeLessThan(0.15); // Within ±15%
    expect(Math.abs(evolvedRatio - 0.5)).toBeLessThan(0.15);
    expect(existingCount + evolvedCount).toBe(200);
  });
});

// rollback-manager.test.ts
describe('RollbackManager', () => {
  it('should atomically switch versions', async () => {
    await manager.rollbackToVersion('v-3');
    const current = await store.getCurrentPlaybook();
    expect(current.id).toBe('v-3');
  });
});
```

### Integration Test Examples

```typescript
// playbook-evolution-integration.test.ts
describe('Full Evolution Cycle', () => {
  let redis: RedisClient;
  let store: RedisMarketplaceStore;

  beforeEach(async () => {
    redis = new Redis({ host: 'localhost', port: 6379 });
    store = new RedisMarketplaceStore(redis);
  });

  it('should complete collect → mine → evolve → test cycle', async () => {
    // 1. Collect 20 records (triggers evolution)
    for (let i = 0; i < 20; i++) {
      await store.addOperationRecord({
        executionId: `exec-${i}`,
        success: i % 2 === 0,
        action: 'scale_up',
        duration: 500 + Math.random() * 100,
      });
    }

    // 2. Mine patterns
    const patterns = await PatternMiner.analyzeOperationLedger(store);
    expect(patterns.length).toBeGreaterThan(0);

    // 3. Evolve playbook
    const evolved = await PlaybookEvolver.evolvePlaybook(patterns, context);
    expect(evolved.isOk()).toBe(true);

    // 4. Initialize A/B test
    const abTest = await ABTestController.initializeTest(
      await store.getCurrentPlaybook(),
      evolved.value
    );
    expect(abTest.status).toBe('in_progress');

    // 5. Execute & collect metrics (60 samples for statistical validity)
    for (let i = 0; i < 60; i++) {
      await ABTestController.recordExecution(abTest.id, {
        playbook: i % 2 === 0 ? 'existing' : 'evolved',
        success: Math.random() > (i % 2 === 0 ? 0.1 : 0.05), // existing: 90%, evolved: 95%
      });
    }

    // 6. Verify confidence meets promotion threshold
    const result = await ABTestController.evaluateTest(abTest.id);
    expect(result.confidence).toBeGreaterThanOrEqual(85);
    expect(result.winner).toBe('evolved');
  });

  it('should handle Redis error and fallback to in-memory cache', async () => {
    // Simulate Redis connection error
    vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('Redis timeout'));

    const record = {
      executionId: 'exec-1',
      success: true,
      action: 'scale_up',
      duration: 500,
    };

    const result = await store.addOperationRecord(record);

    // Should fallback to in-memory, retry scheduled
    expect(result.cached).toBe(true);
    expect(result.retryScheduled).toBe(true);
  });

  it('should fallback to existing playbook on LLM error', async () => {
    // Setup: 20 operation records ready
    for (let i = 0; i < 20; i++) {
      await store.addOperationRecord({
        executionId: `exec-${i}`,
        success: true,
        action: 'scale_up',
        duration: 500,
      });
    }

    // Record current playbook before evolution attempt
    const beforeEvolution = await store.getCurrentPlaybook();
    const originalVersionId = beforeEvolution.id;

    // Simulate Claude API timeout
    vi.spyOn(PlaybookEvolver, 'generate').mockRejectedValueOnce(
      new Error('Claude API timeout')
    );

    // Evolution should fail gracefully
    const result = await PatternMiner.analyzeAndEvolve();
    expect(result.isErr()).toBe(true);

    // Existing playbook should remain unchanged
    const current = await store.getCurrentPlaybook();
    expect(current.id).toBe(originalVersionId);
    // Verify it's not a newly evolved version
    expect(current.generatedBy).not.toBe('claude-sonnet-4-5-20250929');
  });

  it('should auto-rollback when A/B test confidence drops below 70%', async () => {
    // Setup: evolved playbook performing poorly
    const evolved = await createPoorPerformingPlaybook();
    const abTest = await ABTestController.initializeTest(current, evolved);

    // Simulate poor execution metrics
    for (let i = 0; i < 30; i++) {
      await ABTestController.recordExecution(abTest.id, {
        playbook: i % 2 === 0 ? 'existing' : 'evolved',
        success: i % 2 === 0 ? true : false, // evolved: 0%, existing: 100%
      });
    }

    const result = await ABTestController.evaluateTest(abTest.id);
    expect(result.confidence).toBeLessThan(70);

    // Should trigger auto-rollback
    await ABTestController.maybeAutoRollback(abTest.id);

    const rollbackStatus = await store.getABTestStatus(abTest.id);
    expect(rollbackStatus.rolledBack).toBe(true);
  });
});
```

### E2E Playwright Test Suite

```typescript
// website/e2e/playbook-evolution.spec.ts
test.describe('Playbook Evolution E2E', () => {
  test('complete cycle: anomaly → evolution → A/B test → promotion', async ({ page }) => {
    // (Full test as defined in section 6)
  });

  test('rollback scenario', async ({ page }) => {
    // (Full test as defined in section 6)
  });
});
```

---

## 10. Success Criteria

### Implementation Complete

| Criterion | Condition | Verification |
|-----------|-----------|---------------|
| PatternMiner | Extract patterns from 20+ records | Unit test 100% pass |
| PlaybookEvolver | Generate valid playbook via LLM | Unit test 100% pass |
| ABTestController | Execute playbooks 50/50, compute confidence | Unit test 100% pass |
| RollbackManager | Manage versions, safe rollback | Unit test 100% pass |
| Error Handling | Graceful fallback for all failures | Integration tests |
| Redis Integration | All state persisted correctly | Integration tests |
| TypeScript Safety | 0 type errors, strict mode | `npm run build` |
| Test Coverage | 80%+ across all modules | `npm run test:coverage` |

### Feature Validation Checklist

**PatternMiner**
- [ ] Analyze 20+ operation records
- [ ] Calculate success rates per action
- [ ] Identify effective actions per anomaly type
- [ ] Extract anomaly correlations
- [ ] Store patterns in Redis

**PlaybookEvolver**
- [ ] Call Claude API (max tokens: 2000)
- [ ] Include patterns + metrics + chain context
- [ ] Generate valid playbook structure
- [ ] Validate against Zod schema
- [ ] Retry 3x on failure
- [ ] Fall back to existing playbook on error

**A/B Testing**
- [ ] Initialize on next anomaly
- [ ] Execute 50/50 split
- [ ] Collect metrics in real-time
- [ ] Calculate confidence dynamically
- [ ] Auto-promote at 85% confidence
- [ ] Update dashboard in real-time

**Rollback**
- [ ] Maintain 10-version history
- [ ] Record version metadata (created, promoted, confidence)
- [ ] Enable manual rollback from dashboard
- [ ] Auto-rollback on confidence < 70%
- [ ] Atomic version switching (Redis transaction)
- [ ] Track rollback history (reason, timestamp)

### E2E Test Verification

```bash
npm run test:e2e -- website/e2e/playbook-evolution.spec.ts

Expected:
✓ Trigger & Execution
✓ Pattern Mining & Evolution
✓ A/B Test Initialization
✓ Parallel Execution & Confidence
✓ Rollback & Recovery

5 passed (30s)
```

### Build & Quality

```bash
npm run build              # ✓ 0 errors
npm test -- playbook-evolution* --run  # ✓ all pass
npm run test:coverage      # ✓ 80%+ coverage
npm run lint              # ✓ 0 errors
```

### Production Readiness

**Phase 6 is complete when:**
1. ✅ All 4 modules fully implemented
2. ✅ Unit + Integration tests 100% pass (80%+ coverage)
3. ✅ E2E Playwright 5 scenarios 100% pass
4. ✅ TypeScript build 0 errors
5. ✅ Error handling & fallback tested
6. ✅ Redis integration verified
7. ✅ Design document complete
8. ✅ Implementation plan ready

---

## Implementation Readiness

This design is complete and ready for:
1. **Spec Review Loop** (automated spec validation)
2. **User Review** (design approval)
3. **Implementation Planning** (writing-plans skill)
4. **Execution** (subagent-driven development)

**Next Phase**: Phase 7 (Monitoring & Observability for evolved playbooks)

---

**Design Document Status**: ✅ Complete
**Last Updated**: 2026-03-15
**Review Status**: Pending spec validation
