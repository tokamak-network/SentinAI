# SentinAI Architecture

System architecture, design patterns, and technical decision rationale for Autonomous Node Guardian.

---

## System Overview

**SentinAI** is an AI-powered autonomous monitoring and auto-scaling system for Optimism L2 networks.

**Core Design Principles:**
- **AI-First**: All critical decisions powered by AI (Claude, GPT, Gemini)
- **Graceful Degradation**: AI failure → statistical fallback (zero downtime)
- **Zero-Downtime**: Parallel Pod Swap for horizontal scaling
- **State Persistence**: Redis (production) + InMemory (fallback)

---

## Architecture Diagrams

### 1. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA COLLECTION LAYER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  L1 RPC (viem)          L2 RPC (viem)          K8s API          │
│     │                       │                      │             │
│     └───────────┬───────────┴──────────┬──────────┘             │
│                 │                      │                        │
│            /api/metrics ◄──────────────┘                        │
│                 │                                               │
├─────────────────────────────────────────────────────────────────┤
│                    STORAGE & ANALYSIS LAYER                      │
├─────────────────────────────────────────────────────────────────┤
│                 │                                               │
│         MetricsStore (Ring Buffer, 60 capacity)                │
│                 │                                               │
│    ┌────────────┼────────────┐                                │
│    │            │            │                                │
│    ▼            ▼            ▼                                │
│ page.tsx  AnomalyDetector  ScalingDecision                   │
│ (UI)      (3-Layer)        (Hybrid Score)                    │
│           │                │                                  │
│           ▼                ▼                                  │
│        RCA Engine    PredictiveScaler (AI)                  │
│       (Dependency    (Time-Series)                          │
│        Graph)           ▼                                    │
│                    AlertDispatcher (L3)                     │
│                         │                                   │
│                         ▼ (if anomaly confirmed)            │
│                   RemediationEngine (L4) ◄─────┐           │
│                  (Circuit Breaker, Safety)    │            │
│                                                │            │
├─────────────────────────────────────────────────────────────────┤
│                    EXECUTION & FEEDBACK LAYER                    │
├─────────────────────────────────────────────────────────────────┤
│                         ▲                                        │
│         ┌───────────────┴─────────────────┐                     │
│         │                                 │                      │
│    ZeroDowntimeScaler            ActionExecutor                │
│    (Pod Swap)                    (Playbook Actions)             │
│         │                                 │                      │
│    ┌────▼─────────────────────────────────▼────┐               │
│    │                                            │               │
│    ▼                                            ▼               │
│  K8sScaler ───► StatefulSet Patch (Real or Simulated)         │
│         │                                                        │
│         └──► /api/metrics (next cycle)                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2. Anomaly Detection Pipeline (3-Layer)

```
INCOMING METRICS
       │
       ▼
┌──────────────────────────────────────┐
│  LAYER 1: STATISTICAL DETECTION      │
│  (anomaly-detector.ts)               │
├──────────────────────────────────────┤
│                                      │
│ • Z-Score (threshold Z > 2.5)       │
│ • CPU Zero-Drop Rule                │
│ • Block Plateau Detection           │
│ • TxPool Monotonic Increase         │
│                                      │
│ Output: anomaly[] (type, severity)  │
└──────────────────────────────────────┘
       │ (anomalies found)
       ▼
┌──────────────────────────────────────┐
│  LAYER 2: AI SEMANTIC ANALYSIS       │
│  (anomaly-ai-analyzer.ts)            │
├──────────────────────────────────────┤
│                                      │
│ • AI Classification (fast tier)      │
│   - Severity: normal/warning/critical│
│   - Component correlation            │
│   - Impact prediction                │
│ • 30-min caching                     │
│ • Rate limiting                      │
│                                      │
│ Output: deepAnalysis (structured)    │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  LAYER 3: ALERT DISPATCH             │
│  (alert-dispatcher.ts)               │
├──────────────────────────────────────┤
│                                      │
│ • Slack Block Kit formatting        │
│ • Webhook dispatch                  │
│ • Severity-based cooldown           │
│   - critical: 0 min (immediate)     │
│   - high: 10 min                    │
│   - medium: 30 min                  │
│   - low: 60 min                     │
│ • History tracking (max 100)        │
│                                      │
│ Output: Slack/Webhook notification  │
└──────────────────────────────────────┘
       │
       ▼
ANOMALY EVENT STORE
(anomaly-event-store.ts)
```

---

### 3. Predictive Scaling Pipeline

```
MetricsStore (60 data points)
       │
       ▼
┌──────────────────────────────────────┐
│  PREDICTIVE SCALER (AI)              │
│  (predictive-scaler.ts)              │
├──────────────────────────────────────┤
│                                      │
│ Requirement: ≥10 data points        │
│ Rate limit: 5-minute window         │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ AI Model (fast tier)            │ │
│ │ Request: "Predict vCPU"         │ │
│ │ Response: {vCPU, confidence}    │ │
│ └─────────────────────────────────┘ │
│         │              │             │
│      Success        Failure         │
│         │              │             │
│         ▼              ▼             │
│      Return AI     Trend-based      │
│      Prediction    Fallback         │
│                                      │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  SCALING DECISION ENGINE             │
│  (scaling-decision.ts)               │
├──────────────────────────────────────┤
│                                      │
│ Hybrid Score (0-100):               │
│                                      │
│   Score = CPU(30%) + Gas(30%)      │
│           + TxPool(20%) + AI(20%)  │
│                                      │
│ vCPU Mapping:                       │
│   score < 30  → 1 vCPU (2 GB)      │
│   30 ≤ score < 70 → 2 vCPU (4 GB) │
│   score ≥ 70  → 4 vCPU (8 GB)     │
│                                      │
│ Confidence & Reasoning:             │
│   - Factor importance ranking       │
│   - Explanation text generation     │
│                                      │
│ Output: ScalingDecision            │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  ZERO-DOWNTIME SCALER               │
│  (zero-downtime-scaler.ts)          │
├──────────────────────────────────────┤
│  State Machine: 6 phases            │
│  (see below)                        │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  K8S SCALER                          │
│  (k8s-scaler.ts)                    │
├──────────────────────────────────────┤
│                                      │
│ • StatefulSet patch (real)          │
│ • Simulation mode (dry-run)         │
│ • 5-minute cooldown                 │
│ • Result tracking                   │
│                                      │
│ Output: Scaling executed            │
└──────────────────────────────────────┘
```

---

### 4. Zero-Downtime Scaling State Machine

```
           ┌────────────┐
           │   IDLE     │
           └────┬───────┘
                │
                ▼
        ┌──────────────────────────────────┐
        │ CREATING_STANDBY                 │
        │ (Create new pod with target vCPU)│
        └────┬─────────────────────────────┘
             │
             ▼
        ┌──────────────────────────────────┐
        │ WAITING_READY                    │
        │ (Poll readiness probe + RPC health)
        └────┬─────────────────────────────┘
             │
             ▼
        ┌──────────────────────────────────┐
        │ SWITCHING_TRAFFIC                │
        │ (Update service selector)        │
        └────┬─────────────────────────────┘
             │
             ▼
        ┌──────────────────────────────────┐
        │ CLEANUP                          │
        │ (Remove old pod)                 │
        └────┬─────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────────┐
    │ SYNCING_STATEFULSET                      │
    │ (Update StatefulSet spec to match target)│
    └────┬───────────────────────────────────┘
         │
         ▼
    ┌──────────────────────────┐
    │    COMPLETED             │
    └──────────────────────────┘

Safety Mechanisms:
• Watchdog timer: 10 minutes max per phase
• Automatic rollback on any phase failure
• Prevents concurrent Pod Swap operations
• Returns current phase + elapsed duration
```

---

### 5. Root Cause Analysis (RCA) Engine

```
Anomaly Event
       │
       ▼
┌──────────────────────────────────────┐
│  DEPENDENCY GRAPH                    │
│  (rca-engine.ts)                     │
├──────────────────────────────────────┤
│                                      │
│  L1 ─────────────────┐              │
│   │                  │              │
│   ├──► op-node ◄─────┤              │
│   │        │         │              │
│   ├──► op-geth       │              │
│   │                  │              │
│   ├──► op-batcher ───┘              │
│   │                                  │
│   └──► op-proposer                  │
│                                      │
│  Propagation Path:                  │
│  L1 failure → op-node failure       │
│            → op-geth, batcher,      │
│              proposer cascade       │
│                                      │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  TIMELINE BUILDING                   │
│                                      │
│ • Event sequence ordering           │
│ • Temporal correlation              │
│ • Affected component tracing        │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  AI ROOT CAUSE ANALYSIS              │
│                                      │
│ "Why did [component] fail?"          │
│ → AI analysis (best tier)           │
│ → Return: root cause explanation   │
│ → Remediation advice                │
└──────────────────────────────────────┘
       │
       ▼
RCA Result (impact assessment)
```

---

### 6. Layer 4: Auto-Remediation Engine (Proposal 8)

```
Anomaly Event (with RCA Result)
       │
       ▼
┌──────────────────────────────────────────────┐
│  PLAYBOOK MATCHER                            │
│  (playbook-matcher.ts)                       │
├──────────────────────────────────────────────┤
│                                              │
│  5 Predefined Playbooks:                     │
│  1. op-geth Crash/High Load                  │
│  2. op-node Derivation Lag                   │
│  3. op-batcher Transaction Failure           │
│  4. General Network/L1 Issues                │
│  5. L1 Connection Problems                   │
│                                              │
│  Matching Strategy:                          │
│  • Component + metric pattern                │
│  • Log error pattern matching                │
│  • Historical failure correlation            │
│                                              │
│  Output: Selected Playbook + match score     │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  REMEDIATION ENGINE ORCHESTRATOR             │
│  (remediation-engine.ts)                     │
├──────────────────────────────────────────────┤
│                                              │
│  Safety Gates (Pre-Execution):               │
│  ✓ Circuit Breaker check                     │
│  ✓ Rate limiting (5min cooldown)             │
│  ✓ Kill switch (AUTO_REMEDIATION_ENABLED)   │
│                                              │
│  Execution Flow:                             │
│  Playbook.actions[] → for each action:       │
│    1. Check safety level                     │
│    2. Validate pre-conditions                │
│    3. Execute action                         │
│    4. Record result + metrics                │
│    5. Decide next action                     │
│                                              │
│  Output: RemediationExecution[]              │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  ACTION EXECUTOR                             │
│  (action-executor.ts)                        │
├──────────────────────────────────────────────┤
│                                              │
│  9 Actions (3-level Safety Classification):  │
│                                              │
│  Safe (Auto-Execute):                        │
│  • Check L1 Connection → RPC ping/getBlock  │
│  • Restart op-geth → kubectl delete pod     │
│  • Sync DB → op-node --syncmode=full        │
│                                              │
│  Guarded (Conditional):                      │
│  • Increase vCPU (with threshold check)      │
│  • Update gas limit (with safety margin)     │
│  • Restart op-node                          │
│  • Clear cache                              │
│                                              │
│  Manual (Escalation):                        │
│  • Failover to secondary sequencer           │
│  • Disable L2 temporarily                    │
│  • Emergency downscale                      │
│                                              │
│  Each action: status + output + error + metrics
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  REMEDIATION STORE (Circuit Breaker)         │
│  (remediation-store.ts)                      │
├──────────────────────────────────────────────┤
│                                              │
│  Tracks Per-Playbook:                        │
│  • Execution history (max 100)               │
│  • Success/failure rate                      │
│  • Consecutive failures (→ circuit break)    │
│  • Last execution time                       │
│                                              │
│  Circuit Breaker Logic:                      │
│  • 3 consecutive failures → OPEN (24h)       │
│  • Prevents infinite retry loops             │
│  • Manual reset via /api/remediation         │
│                                              │
└──────────────────────────────────────────────┘
       │
       ▼
Execution → Escalation Ladder (if fails):
  Level 0: Safe + Guarded actions
  Level 1: Fallback actions
  Level 2: Await operator confirmation (30min)
  Level 3: @channel emergency alert
```

---

## Core Modules Organization

### Tier 1: AI Integration (Foundation)

**`ai-client.ts`** (345 lines)
- Multi-provider unified interface (Anthropic/OpenAI/Gemini)
- LiteLLM Gateway support + fallback
- **Model tier selection (automatic, no config needed):**
  - Fast Tier: `qwen3-80b-next` (1.8s, 100% accuracy, $30/mo) — Real-time ops
  - Best Tier: `qwen3-235b` (11s, 100% accuracy, $60/mo) — Complex analysis
  - Fallback: GPT-5.2 series or Claude via auto-detection
- Error logging & resilience
- Per-tier cost estimation & token tracking

**Used by:** All AI-dependent modules

---

### Tier 2: Data Collection & Storage

**`metrics-store.ts`** (267 lines)
- Ring buffer implementation (capacity: 60)
- Statistical calculations (mean, stdDev, trend, slope)
- Time-series state management
- Redis or InMemory backed

**`state-store.ts`** (1,089 lines)
- Abstract interface for all state persistence
- 15+ methods for P1/P2/P3 store operations
- Dual-mode: Redis (production) + InMemory (fallback)

**`redis-store.ts`** (1,076 lines)
- Complete Redis implementation
- Automatic InMemory fallback on connection failure
- TTL management (7d to 10min by key)
- Production-ready error handling

---

### Tier 3: Detection & Analysis

**`anomaly-detector.ts`** (322 lines) - Layer 1
- Z-Score statistical detection
- Special rules (CPU drop, plateau, monotonic increase)
- No AI dependency (pure statistics)

**`anomaly-ai-analyzer.ts`** (291 lines) - Layer 2
- AI semantic analysis (fast tier)
- Caching & rate limiting (30 min / 5 min)
- Graceful degradation on AI failure

**`alert-dispatcher.ts`** (319 lines) - Layer 3
- Slack Block Kit + Webhook formatting
- Severity-based cooldown (critical → low)
- Alert history management

**`anomaly-event-store.ts`** (153 lines)
- In-memory event persistence
- Event lifecycle management
- Pagination & filtering

---

### Tier 4: Scaling Intelligence

**`predictive-scaler.ts`** (317 lines)
- AI time-series prediction (fast tier)
- Rate limiting (5-minute window)
- Trend-based fallback

**`scaling-decision.ts`** (289 lines)
- Hybrid scoring algorithm
- vCPU tier mapping (1/2/4)
- Confidence calculation & reasoning

**`zero-downtime-scaler.ts`** (421 lines)
- Parallel Pod Swap orchestration
- State machine with 7 phases
- Health check integration

**`k8s-scaler.ts`** (298 lines)
- StatefulSet patch execution
- Simulation mode (default: true)
- Cooldown enforcement (5 min)
- kubectl wrapper with token caching

---

### Tier 5: Optimization & Cost

**`cost-optimizer.ts`** (425 lines)
- Fargate pricing calculation (Seoul region)
- Usage pattern analysis (7×24 bucketing)
- Peak/off-peak identification
- AI-driven recommendations (best tier)

**`usage-tracker.ts`** (278 lines)
- vCPU-hour calculation
- Daily/monthly summaries
- Cost projection
- Stress mode filtering

---

### Tier 6: Operations & Reporting

**`nlops-engine.ts`** (412 lines)
- Intent classification (7 types)
- Context-aware routing
- Confirmation flow for risky actions

**`nlops-responder.ts`** (356 lines)
- Natural language response generation
- Query answering
- Configuration guidance

**`daily-report-generator.ts`** (266 lines)
- AI-powered report generation (best tier)
- Data-driven fallback on AI failure
- Markdown formatting
- File management

**`daily-accumulator.ts`** (341 lines)
- 5-minute snapshot capture
- 24-hour bucketing
- Daily rollover at midnight
- Data completeness tracking

---

### Tier 7: Auto-Remediation (Proposal 8)

**`remediation-engine.ts`** (335 lines)
- Orchestrates playbook selection & execution
- Safety gates (Circuit Breaker, rate limiting)
- Escalation ladder (4 levels: Safe → Guarded → Confirmation → Emergency)
- Execution tracking & metrics

**`playbook-matcher.ts`** (304 lines)
- 5 predefined Playbooks (op-geth, op-node, op-batcher, general, l1)
- Pattern matching (component + metric + logs)
- Confidence scoring

**`action-executor.ts`** (389 lines)
- 9 actions (Safe: 3, Guarded: 4, Manual: 3)
- Safety-level classification
- Pre-conditions & validation

**`remediation-store.ts`** (223 lines)
- Circuit Breaker state (consecutive failures → 24h open)
- Execution history (max 100 records)
- Configuration & overrides

**REST API:** `/api/remediation` (GET/POST/PATCH)
- Query state, execution history, circuit breaker status
- Manually trigger playbooks, reset circuit breaker
- Configure remediation settings

---

### Tier 8: Logging & Analysis

**`log-ingester.ts`** (164 lines)
- Mock log generation (normal/attack modes)
- Live kubectl log fetching
- Parallel component fetching

**`ai-analyzer.ts`** (252 lines)
- Log chunk semantic analysis (fast tier)
- Severity detection
- Component-wise aggregation

---

### Tier 9: Utilities

**`k8s-config.ts`** (159 lines)
- kubectl API URL auto-detection
- Token caching (10-minute TTL)
- Connection management

**`ai-response-parser.ts`** (187 lines)
- JSON extraction from AI responses
- Type parsing & validation
- Markdown code block handling

**`prediction-tracker.ts`** (201 lines)
- Prediction accuracy tracking
- Verification workflow
- Accuracy metrics calculation

---

## Design Patterns

### 1. Multi-Provider AI Strategy

**Priority Order:**
```
1. Module Override (e.g., ANOMALY_PROVIDER=anthropic)
2. LiteLLM Gateway (if configured + fallback to Anthropic on 400/401)
3. Anthropic Direct
4. OpenAI Direct
5. Gemini Direct
```

**Example:**
```typescript
// costOptimizer can override:
process.env.COST_PROVIDER = 'openai'

// Falls through:
LiteLLM Gateway (400) → Anthropic Direct → OpenAI Direct
```

### 2. Graceful Degradation

**Pattern:** AI failure → Statistical fallback

**Examples:**
- Anomaly L2 analysis fails → Use L1 results only
- Cost recommendations fail → Return zero recommendations
- Daily report generation fails → Return data-driven report

**Code Pattern:**
```typescript
try {
  return await aiClient.chatCompletion(...)
} catch (error) {
  // Fallback implementation
  return DEFAULT_FALLBACK_RESPONSE
}
```

### 3. State Persistence (Dual-Mode)

**Pattern:** Redis (production) with InMemory fallback

**Code Pattern:**
```typescript
const store = getStore()

// store is RedisStateStore if REDIS_URL configured
// otherwise InMemoryStateStore

await store.pushAnomalyEvent(event)  // Works either way
```

### 4. Rate Limiting & Caching

**Pattern:** Prevent AI call spam

**Implementations:**
- Predictive scaler: 5-minute window (last_called_at)
- Anomaly analyzer: 30-minute cache (TTL-based)
- Alert cooldown: 0-60 minutes (severity-based)

### 5. Ring Buffer for Metrics

**Pattern:** Fixed-capacity circular buffer

**Implementation:** MetricsStore
- Capacity: 60 (10 minutes at 10-second intervals)
- Eviction: FIFO (oldest first)
- Statistics: Real-time mean, stdDev, trend calculation

### 6. Circuit Breaker (Proposal 8)

**Pattern:** Prevent cascading failures from repeated remediation attempts

**Implementation:** RemediationStore
```typescript
if (consecutiveFailures >= 3) {
  circuitBreaker.state = 'OPEN';
  circuitBreaker.resetAt = now + 24_hours;
  // Block all remediation attempts until reset
}
```

**Trigger Conditions:**
- 3 consecutive failures of same Playbook
- Automatic reset after 24 hours
- Manual reset via `/api/remediation` PATCH

**Benefit:** Avoids infinite retry loops that could worsen system state

### 7. Escalation Ladder (Proposal 8)

**Pattern:** Graceful failure with human intervention

**Implementation:** RemediationEngine
```
Level 0: Safe actions (immediate execution)
         └─ Check L1 Connection, Restart op-geth, Sync DB

Level 1: Guarded actions (conditional execution)
         └─ Increase vCPU, Update gas limits, Clear cache

Level 2: Operator confirmation required (30-minute window)
         └─ Await human approval in NLOps chat

Level 3: Emergency escalation (@channel alert)
         └─ Critical failure → notification to team
```

**Safety Benefit:** Prevents automated actions from making things worse

### 8. Safety-Level Classification (Proposal 8)

**Pattern:** Three-tier action safety framework

**Implementation:** ActionExecutor
```typescript
switch (action.safetyLevel) {
  case 'safe':     // Always execute
  case 'guarded':  // Check pre-conditions, then execute
  case 'manual':   // Skip, escalate to human
}
```

**Examples:**
- Safe: `checkL1Connection()` (read-only, no side effects)
- Guarded: `increaseVcpu(newSize)` (check resource limits first)
- Manual: `disableL2Temporarily()` (requires operator approval)

---

## Data Flow Examples

### Scenario 1: Spike Anomaly Detection

```
1. /api/metrics collects CPU spike
2. MetricsStore appends to ring buffer
3. anomaly-detector.ts calculates Z-Score
4. Z > 2.5 → anomaly detected
5. anomaly-ai-analyzer.ts analyzes (fast tier)
6. Severity: critical
7. alert-dispatcher.ts sends Slack alert
8. RCA engine traces dependencies
9. Daily accumulator records event
```

### Scenario 2: Predictive Scaling Decision

```
1. MetricsStore has 60 data points
2. predictive-scaler.ts queries AI (fast tier)
3. AI returns: vCPU=4, confidence=0.85
4. scaling-decision.ts calculates hybrid score
5. Score: 75 → target vCPU: 4
6. zero-downtime-scaler.ts starts state machine
7. New pod created, health checks pass
8. Traffic switched (zero downtime)
9. Old pod removed, StatefulSet synced
10. usage-tracker.ts records scaling event
```

### Scenario 3: Anomaly Detection + Auto-Remediation (Proposal 8)

```
1. anomaly-detector.ts detects op-geth CPU drop (Layer 1)
2. anomaly-ai-analyzer.ts analyzes: severity=critical (Layer 2)
3. alert-dispatcher.ts formats Slack alert (Layer 3)
4. Trigger: remediationEngine receives alert (Layer 4)
5. playbook-matcher matches: "op-geth Crash" pattern
6. remediation-engine checks safety gates:
   ✓ Circuit Breaker: CLOSED (not in open state)
   ✓ Rate limit: >5 minutes since last execution
   ✓ Kill switch: AUTO_REMEDIATION_ENABLED=true
7. Execute Playbook actions (sequentially):
   - Action 1 (Safe): Check L1 Connection → Success
   - Action 2 (Guarded): Restart op-geth → Check conditions → Execute
   - Action 3 (Safe): Sync DB → Initiated
8. Monitor: Track all action results in RemediationStore
9. If any action fails: Escalate to Level 1 → Try Fallback actions
10. Record execution: Add to history (max 100 records)
11. Return to idle state
12. Next cycle: Monitor op-geth recovery
```

---

## Performance Characteristics

### Metrics Collection

- **Interval:** Every 10 seconds (L1/L2 RPC + K8s API)
- **Latency:** <500ms per collection
- **Storage:** 60 points × 30 bytes ≈ 2 KB in-memory

### Anomaly Detection

- **L1 (Statistical):** <5ms per calculation
- **L2 (AI):** <500ms first call (cached 30 min)
- **L3 (Alert):** <100ms dispatch + cooldown check

### Scaling Decision

- **Scoring:** <10ms
- **AI Prediction:** <1s first call (cached 5 min)
- **State Machine:** 30-120s total (depends on pod readiness)

### Cost Analysis

- **Calculation:** <100ms
- **AI Recommendations:** <2s (best tier)
- **Report Generation:** <5s (with AI)

### Auto-Remediation (Proposal 8)

- **Playbook Matching:** <50ms
- **Safety Gate Checking:** <10ms
- **Action Execution:** Varies by action (10ms read-only to 30s pod restart)
- **Execution History:** <5ms per lookup
- **Circuit Breaker Reset:** <1ms

---

## Security Considerations

### API Keys

- Environment variable only (never in source)
- Token caching: 10-minute TTL (kubectl)
- No API keys logged

### K8s RBAC

- Requires: StatefulSet patch permission
- Recommended: Namespace-scoped RBAC
- TLS verification: Enabled by default (dev: optional)

### Webhook URLs

- Slack/custom webhook validation
- No secrets in request body
- HTTPS only (production)

---

## Scalability Notes

### Horizontal Scaling

- **Current:** Single instance (in-memory state)
- **Redis Mode:** Multi-instance capable (REDIS_URL configured)
- **Limitation:** Daily reports still single-writer

### Vertical Scaling

- **CPU:** Lightweight (Node.js 20 + Next.js)
- **Memory:** ~300-500 MB baseline
- **Storage:** Redis keys only (ephemeral)

---

## Technology Stack

- **Framework:** Next.js 16 (API + Web UI)
- **Runtime:** Node.js 20
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest (unit), Playwright (E2E)
- **Container:** Docker (multi-stage)
- **Orchestration:** Kubernetes (StatefulSet)
- **State:** Redis 7+ or InMemory
- **AI:**
  - Fast Tier: Qwen 3 80B-Next (1.8s, 100% accuracy, $30/mo) ⭐
  - Best Tier: Qwen 3 235B (11s, 100% accuracy, $60/mo) ⭐
  - Alternative: GPT-5.2 series or Claude (via auto-fallback)
- **Web3:** viem (L1/L2 RPC)
- **UI:** React 19 + Tailwind CSS 4 + Recharts + Lucide icons

---

## State Persistence Notes

### Redis (Optional but Recommended)

**Required for:**
- Daily reports (24-hour metric accumulation)
- 7-day cost analysis (vCPU usage patterns)

**Not required for:**
- Real-time metrics collection
- Anomaly detection (per-cycle stateless)
- Scaling decisions (uses in-memory ring buffer)
- Auto-remediation (action history ephemeral)

**Configuration:**
- Set `REDIS_URL=redis://host:6379` to enable
- Falls back to InMemory if unset (data lost on restart)
- See `docs/guide/redis-setup.md` for complete guide

---

## Summary

SentinAI architecture emphasizes:
- **Reliability:** Multi-layer fallbacks, graceful degradation (AI, State, Remediation)
- **Intelligence:** AI-powered decision making (anomaly analysis, scaling, remediation)
- **Safety:** Zero-downtime scaling + Circuit Breaker + Escalation Ladder
- **Automation:** Layer 4 Auto-Remediation with 3-tier safety classification (Proposal 8)
- **Observability:** Comprehensive logging, RCA, daily reports, execution tracking
- **Flexibility:** Multi-provider AI with module-level overrides
- **Scalability:** Optional Redis for horizontal expansion & state persistence

The system prioritizes **operational continuity** — all critical features degrade gracefully with automatic fallbacks, and dangerous remediation actions require safety gates (Circuit Breaker, confirmation, escalation).
