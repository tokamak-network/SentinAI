# Proposal 23: Agent Memory and Reasoning Trace (Q1 2026)

> Created: 2026-02-21  
> Status: Completed (Q1 scope implemented on 2026-02-22)  
> Quarter: Q1 (2026-03 ~ 2026-05)

---

## 1. Goal

Introduce persistent memory and auditable reasoning traces for agent decisions.

### Success Metrics (Q1)

| KPI | Current | Target |
|---|---:|---:|
| Persistent incident memory | partial (history only) | enabled |
| Decision trace retention | none | >= 30 days |
| Repeated-incident retrieval hit rate | not measured | >= 70% |
| Secret leakage in trace logs | unknown | 0 confirmed |

---

## 2. Scope

### In Scope

1. Redis-backed memory store (short-term + incident summaries)
2. Structured decision trace schema
3. Retrieval API for memory and decision logs
4. Secret masking and retention policies
5. Agent loop integration (store/retrieve around plan/analyze)

### Out of Scope

1. Vector DB semantic search (Q2)
2. Cross-workspace memory federation
3. Auto-generated playbooks from memory

---

## 3. Memory Model

### 3.1 Layers

1. Short-term memory
- recent N cycles, lightweight context
- fast retrieval for immediate follow-up decisions

2. Incident memory
- summarized records keyed by `incidentType`, `chainType`, `component`
- stores what action worked and verification outcome

### 3.2 Trace Model

Each decision produces a structured trace:

- `decisionId`
- `inputs` (metrics/anomalies/log summaries)
- `reasoningSummary` (human-readable)
- `evidence` (explicit measurable facts)
- `chosenAction` and alternatives
- `verificationResult`

---

## 4. Public Interfaces and Types

### 4.1 New Types

File: `src/types/agent-memory.ts` (new)

- `AgentMemoryEntry`
- `DecisionTrace`
- `DecisionEvidence`
- `MemoryQuery`

### 4.2 State Store Extension

File: `src/types/redis.ts`, `src/lib/redis-store.ts`

Add methods:

- `addAgentMemory(entry: AgentMemoryEntry): Promise<void>`
- `queryAgentMemory(query: MemoryQuery): Promise<AgentMemoryEntry[]>`
- `addDecisionTrace(trace: DecisionTrace): Promise<void>`
- `getDecisionTrace(decisionId: string): Promise<DecisionTrace | null>`
- `cleanupAgentMemory(beforeTs: number): Promise<number>`

### 4.3 New APIs

1. `GET /api/agent-memory`
- Query recent or filtered memory entries

2. `GET /api/agent-decisions`
- Query decision traces by date range / severity / component

### 4.4 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_MEMORY_ENABLED` | `true` | Enable memory persistence |
| `AGENT_MEMORY_RETENTION_DAYS` | `30` | Retention window |
| `AGENT_TRACE_MAX_ITEMS` | `5000` | Max trace records |
| `AGENT_TRACE_MASK_SECRETS` | `true` | Enable secret masking |

---

## 5. Security and Compliance Rules

1. Mask all URLs with embedded credentials
2. Mask API keys/private keys with deterministic redaction
3. Do not store full raw logs beyond configured cap
4. Keep immutable trace ID and timestamp for audit

---

## 6. Implementation Plan (Q1)

### Week 6

1. Define types and store interface
2. Implement Redis and in-memory methods
3. Add retention cleanup task in scheduler

### Week 7

1. Integrate trace capture in `agent-loop` analyze/plan/act/verify
2. Add secret masking utility and tests
3. Add memory retrieval in planning stage

### Week 8

1. Implement `/api/agent-memory`, `/api/agent-decisions`
2. Connect dashboard activity drill-down links
3. Add operational guide for incident replay

---

## 7. Test Plan

### Unit Tests

1. Trace serialization and schema validation
2. Secret masking for URLs, tokens, private keys
3. Memory query filters (time range, component, severity)
4. Retention cleanup boundaries

### Integration Tests

1. Agent cycle writes trace and memory in one transaction boundary
2. Retrieval APIs return consistent pagination/order
3. Redis failover to in-memory fallback works without crash
4. Trace retrieval by `decisionId` matches activity log event

### Acceptance Scenarios

1. Operator can retrieve prior similar incident context in dashboard/API
2. Every automated action has one auditable trace record
3. Sensitive values are redacted in persisted data

---

## 8. Rollout and Rollback

### Rollout

1. Enable write-only mode first (capture without retrieval UI)
2. Enable retrieval APIs for operators
3. Enable memory-assisted planning after baseline stability

### Rollback

1. Disable `AGENT_MEMORY_ENABLED`
2. Keep API endpoints available with empty results
3. Preserve existing agent-loop behavior without memory dependency

---

## 9. Assumptions and Defaults

1. Q1 uses Redis as primary store and in-memory fallback in development
2. Retrieval is exact/filter-based first; semantic search deferred to Q2
3. Memory ingestion must not block cycle completion
4. Trace data is append-only except retention cleanup
