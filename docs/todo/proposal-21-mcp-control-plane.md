# Proposal 21: MCP Control Plane (Q1 2026)

> Created: 2026-02-21  
> Status: In Progress (MVP baseline implemented on 2026-02-22)  
> Quarter: Q1 (2026-03 ~ 2026-05)

---

## 1. Goal

SentinAI core operations are exposed through MCP (Model Context Protocol) so AI clients can use a standard tool interface.

### Success Metrics (Q1)

| KPI | Current | Target |
|---|---:|---:|
| MCP callable tools | 0 | 5 |
| Read tool success rate | N/A | >= 99% |
| Write tool approval bypass incidents | N/A | 0 |
| MCP integration clients | 0 | >= 3 |

---

## 2. Scope

### In Scope

1. MCP server endpoint and tool manifest
2. Read tools: `get_metrics`, `get_anomalies`, `run_rca`
3. Write tools: `scale_component`, `restart_component` (approval required)
4. MCP auth mode and approval token flow
5. Audit log integration for MCP tool calls

### Out of Scope

1. Multi-agent A2A protocol
2. External marketplace connector ecosystem
3. Fine-grained OAuth provider federation (Q2+)

---

## 3. Current Baseline

SentinAI already has APIs and execution modules required for MCP wrapping.

- Metrics: `src/app/api/metrics/route.ts`
- Anomalies: `src/app/api/anomalies/route.ts`
- RCA: `src/app/api/rca/route.ts`
- Scaling/Actions: `src/app/api/scaler/route.ts`, `src/lib/action-executor.ts`
- Agent history: `src/app/api/agent-loop/route.ts`, `src/lib/agent-loop.ts`

The Q1 objective is to add an MCP contract layer without changing core domain logic.

---

## 4. Architecture

```text
MCP Client (Claude/Cursor/Internal Agent)
        |
        v
POST /api/mcp (JSON-RPC)
        |
        +--> MCP auth guard
        +--> tool router
                |
                +--> read tool adapters (metrics/anomalies/rca)
                +--> write tool adapters (scale/restart)
                          |
                          +--> approval token verifier
        |
        v
Audit log + activity log (agent/dashboard)
```

### Design Principles

1. Keep existing REST APIs as source of truth
2. MCP layer only adapts request/response and enforces policy
3. Every MCP write call is audit-traceable by `decisionId`/`requestId`

---

## 5. Public Interfaces and Types

### 5.1 New API

1. `POST /api/mcp`
- Purpose: JSON-RPC based tool invocation
- Auth: required (`x-api-key` and/or MCP auth mode)
- Returns: `{ jsonrpc, id, result | error }`

2. `GET /api/mcp`
- Purpose: tool manifest and server capability
- Returns: tool list, auth mode, write policy

### 5.2 New/Extended Types

1. `src/types/mcp.ts` (new)
- `McpRequest`, `McpResponse`, `McpToolName`
- `McpInvocationContext`, `McpApprovalTicket`

2. `src/types/redis.ts` (extend)
- approval ticket methods:
  - `createMcpApprovalTicket(...)`
  - `getMcpApprovalTicket(...)`
  - `consumeMcpApprovalTicket(...)`

### 5.3 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_ENABLED` | `false` | Enable MCP endpoint |
| `MCP_SERVER_PORT` | `3002` | MCP endpoint port (if standalone mode is used) |
| `MCP_AUTH_MODE` | `api-key` | `api-key` \| `approval-token` \| `dual` |
| `MCP_APPROVAL_REQUIRED` | `true` | Require approval for write tools |
| `MCP_APPROVAL_TTL_SECONDS` | `300` | One-time approval token TTL |

---

## 6. Implementation Plan (Q1)

### Week 1

1. Add MCP types and basic JSON-RPC parser
2. Add `/api/mcp` route skeleton and health response
3. Implement read-only tool adapters

### Week 2

1. Implement write tool adapters
2. Add approval ticket store (Redis + in-memory fallback)
3. Add auth/approval guard and failure codes

### Week 3

1. Integrate activity log and audit fields
2. Add request correlation IDs and tool latency logging
3. Add operational docs for MCP usage

### Week 4

1. Integration tests with two clients
2. Failure injection test (auth fail, timeout, invalid params)
3. Soft rollout with read tools first, then write tools

---

## 7. Test Plan

### Unit Tests

1. JSON-RPC validation (invalid method/params/id)
2. Tool routing by name
3. Approval ticket create/consume/expiry
4. Write tool denied without approval

### Integration Tests

1. `POST /api/mcp` read tool success path
2. `POST /api/mcp` write tool with valid approval token
3. Activity log record creation after tool call
4. Redis unavailable fallback behavior

### Acceptance Scenarios

1. MCP client can discover and call all 5 tools
2. Unauthorized write attempts are blocked and logged
3. Read tools are available in read-only dashboard mode

---

## 8. Rollout and Rollback

### Rollout

1. Stage 1: `MCP_SERVER_ENABLED=true`, read tools only
2. Stage 2: write tools enabled with mandatory approval
3. Stage 3: add limited production client allowlist

### Rollback

1. Set `MCP_SERVER_ENABLED=false`
2. Keep core REST APIs unaffected
3. Audit logs retained for postmortem

---

## 9. Assumptions and Defaults

1. Q1 uses a single workspace and single chain context
2. Write actions always require explicit approval token by default
3. Existing REST APIs remain backward-compatible and unmodified
4. Redis is preferred; in-memory fallback is allowed in dev mode
