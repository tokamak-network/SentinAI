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
│        Graph)                                               │
│                                                              │
├─────────────────────────────────────────────────────────────────┤
│                    EXECUTION & FEEDBACK LAYER                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│    K8sScaler ───► StatefulSet Patch (Real or Simulated)        │
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
│  State Machine: 7 phases            │
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
        ┌──────────────────┐
        │ CREATING_STANDBY │ (Create new pod with target vCPU)
        └────┬─────────────┘
             │
             ▼
        ┌──────────────────┐
        │ WAITING_READY    │ (Poll readiness probe)
        └────┬─────────────┘
             │
             ▼
        ┌──────────────────┐
        │SWITCHING_TRAFFIC │ (Update service selector)
        └────┬─────────────┘
             │
             ▼
        ┌──────────────────┐
        │   CLEANUP        │ (Remove old pod)
        └────┬─────────────┘
             │
             ▼
    ┌──────────────────────────┐
    │SYNCING_STATEFULSET       │ (Update StatefulSet definition)
    └────┬─────────────────────┘
         │
         ▼
    ┌──────────────────────────┐
    │    COMPLETED             │
    └──────────────────────────┘

Error Recovery:
Any phase failure → automatic rollback to previous state
Watchdog timer: 10 minutes max per phase
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

## Core Modules Organization

### Tier 1: AI Integration (Foundation)

**`ai-client.ts`** (345 lines)
- Multi-provider unified interface (Anthropic/OpenAI/Gemini)
- LiteLLM Gateway support + fallback
- Model tier selection (fast vs best)
- Error logging & resilience

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

### Tier 7: Logging & Analysis

**`log-ingester.ts`** (164 lines)
- Mock log generation (normal/attack modes)
- Live kubectl log fetching
- Parallel component fetching

**`ai-analyzer.ts`** (252 lines)
- Log chunk semantic analysis (fast tier)
- Severity detection
- Component-wise aggregation

---

### Tier 8: Utilities

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
- **AI:** Claude 3.5 (primary), GPT-4.1 (secondary), Gemini 2.5 (tertiary)
- **Web3:** viem (L1/L2 RPC)
- **UI:** React 19 + Tailwind CSS 4 + Recharts + Lucide icons

---

## Summary

SentinAI architecture emphasizes:
- **Reliability:** Multi-layer fallbacks, graceful degradation
- **Intelligence:** AI-powered decision making with statistical backup
- **Safety:** Zero-downtime scaling with state machine orchestration
- **Observability:** Comprehensive logging and anomaly tracking
- **Flexibility:** Multi-provider AI with module-level overrides
- **Scalability:** Redis-backed state for horizontal expansion

The system prioritizes **user experience continuity** — all features degrade gracefully, never failing with errors.
