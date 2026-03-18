# SentinAI MCP User Guide

This document is an integrated guide for setting up SentinAI MCP in Claude Code and performing everything from operational status checks to manual interventions with a consistent procedure.

---

## 1. Overview

SentinAI MCP operates in the two-layer architecture below.

1. SentinAI HTTP MCP server: `POST /api/mcp`
2. stdio bridge: Forwards Claude Code MCP requests to the HTTP MCP

In other words, even if you only run `npm run mcp:bridge:stdio`, the actual call target—the SentinAI server (`npm run dev` or `npm run start`)—must be running for it to work correctly.

### 1.1 Why use MCP

1. Natural-language operations: You can describe operational intent in natural language without memorizing tool names.
2. Consistent safety policy: Approval tokens / read-only policy are applied consistently along the MCP path.
3. Faster response: You can quickly iterate the flow of status check -> root-cause analysis -> action -> post-verification within a single session.
4. Easier audit tracing: It is easier to trace action requests and results within the same protocol flow.

### 1.2 Supported chain policy (as of 2026-02-22)

1. Recommended: Use MCP only in the `OP Stack` environment.
2. Disabled: `ZK Stack` is currently disabled due to MCP spec mismatches.
3. Operating principle: In `CHAIN_TYPE=zkstack` environments, use the existing API/UI path instead of MCP.

### 1.3 Existing L2 ops vs MCP-based ops

| Category | Existing L2 ops (API/UI-centric) | MCP-based ops |
|---|---|---|
| Entry | Operators directly choose and call endpoints/screens | Express intent via natural language and MCP calls the appropriate tools |
| Execution flow | Manually switch between check/analyze/act steps | Continuously perform check -> analyze -> act -> verify within one session |
| Safety control | Must verify policies per path | Approval token / read-only policy applied commonly on the MCP path |
| Ops speed | Manual context switching on each repeated procedure | Shorter response lead time via continuous execution in the same context |
| Audit/trace | Calls are distributed, increasing trace cost | Trace tool calls and results within the same protocol flow |

---

## 2. Quick Start

### 2.1 Run the SentinAI server

```bash
npm run dev
```

Default address: `http://127.0.0.1:3002`

### 2.1.1 Check chain type (recommended)

```bash
export CHAIN_TYPE=opstack
```

### 2.2 Enable MCP and set the API key

```bash
export MCP_SERVER_ENABLED=true
export SENTINAI_API_KEY=your-sentinai-api-key
```

### 2.3 Run the stdio bridge

```bash
npm run mcp:bridge:stdio
```

Expected startup log:

```text
[MCP Bridge] Ready: http://127.0.0.1:3002/api/mcp
```

### 2.4 Example: Register a Claude Code MCP server

```json
{
  "name": "sentinai",
  "command": "npm",
  "args": ["run", "mcp:bridge:stdio"],
  "env": {
    "MCP_SERVER_ENABLED": "true",
    "SENTINAI_API_KEY": "your-sentinai-api-key",
    "MCP_BRIDGE_BASE_URL": "http://127.0.0.1:3002"
  }
}
```

### 2.5 Connection smoke test

Verify the following in order in Claude Code.

```text
Show me the sentinai MCP tool list
```

```text
Summarize the latest 5 metrics
```

```text
Check what error occurs if I try to adjust component scaling without approval
```

The last call should be blocked by policy.

---

## 3. Environment variables

### 3.1 Server-side variables

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_ENABLED` | `false` | Whether to enable the MCP server |
| `MCP_AUTH_MODE` | `api-key` | Auth mode (`api-key`/`approval-token`/`dual`) |
| `MCP_APPROVAL_REQUIRED` | `true` | Whether write tools require an approval token |
| `MCP_APPROVAL_TTL_SECONDS` | `300` | Approval token TTL (seconds) |
| `SENTINAI_API_KEY` | (none) | MCP API authentication key |
| `NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE` | `false` | When enabling read-only mode, block write tools |
| `SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY` | `false` | Allow an exception for scaler writes in read-only mode |

### 3.2 Bridge-side variables

| Variable | Default | Description |
|---|---|---|
| `MCP_BRIDGE_BASE_URL` | `http://127.0.0.1:3002` | SentinAI server address |
| `MCP_BRIDGE_API_PATH` | `/api/mcp` | MCP API path |
| `MCP_BRIDGE_TIMEOUT_MS` | `15000` | Bridge -> server request timeout (ms) |
| `MCP_BRIDGE_API_KEY` | (none) | Alternative key for `SENTINAI_API_KEY` (`SENTINAI_API_KEY` takes precedence) |

---

## 4. MCP tool summary

| Tool | Type | Description |
|---|---|---|
| `get_metrics` | Read | Retrieve recent metrics / scaling state |
| `get_anomalies` | Read | Retrieve anomaly event list |
| `run_rca` | Read | Run an RCA analysis |
| `plan_goal` | Read | Decompose a natural-language goal into an execution plan |
| `run_health_diagnostics` | Read | Comprehensive checks of metrics/anomalies/L1 RPC/component status |
| `execute_goal_plan` | Write | Execute the goal plan (dry-run by default) |
| `scale_component` | Write | Scale resources for a running component |
| `restart_component` | Write | Restart the specified component |
| `restart_batcher` | Write | Restart the batcher |
| `restart_proposer` | Write | Restart the proposer |
| `switch_l1_rpc` | Write | L1 RPC failover or switch to a specified URL |
| `update_proxyd_backend` | Write | Replace the Proxyd backend RPC URL |

Write tools require an approval token by default.

---

## 5. Standard operating procedure

### 5.1 Step 1: Check status

```text
Check and summarize the current L1 RPC, core components, and recent anomaly events all at once
```

### 5.2 Step 2: Root-cause analysis

```text
Based on the latest metrics and the most recent 20 anomaly events, perform a root-cause analysis and suggest action priorities
```

### 5.3 Step 3: Issue an approval token

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mcp.request_approval",
  "params": {
    "toolName": "scale_component",
    "toolParams": { "targetVcpu": 4 },
    "approvedBy": "operator",
    "reason": "Respond to increased CPU utilization"
  }
}
```

Pass the `approvalToken` from the response to the next Write call.

### 5.4 Step 4: Execute a manual action

Restart example:

```text
Restart the op-node component
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "restart_component",
  "params": {
    "target": "op-node",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

L1 RPC switch example:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "switch_l1_rpc",
  "params": {
    "targetUrl": "https://sepolia.drpc.org",
    "reason": "Increased timeouts on the existing endpoint",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

Scaling example:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "scale_component",
  "params": {
    "targetVcpu": 4,
    "reason": "Respond to increased traffic",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

Supported `targetVcpu` values: `1 | 2 | 4 | 8`

### 5.5 Step 5: Post-verification

```text
Summarize the state differences before and after the action I just took
```

---

## 6. Supported chain policy

### OP Stack (recommended)

- Supports the MCP operating procedure (diagnose/approve/act/verify) by default.
- We recommend using operating tools based on OP component paths such as `restart_batcher` and `restart_proposer`.

### ZK Stack (disabled)

- Currently not supported due to MCP spec mismatches.
- In `CHAIN_TYPE=zkstack`, do not use the MCP path; use the existing API/UI ops path.

---

## 7. Troubleshooting

1. `MCP server is disabled`:
   - Check `MCP_SERVER_ENABLED=true`
   - Confirm the SentinAI server (`npm run dev` or `npm run start`) is running

2. `Invalid x-api-key`:
   - Check whether `SENTINAI_API_KEY` matches the bridge/client key

3. `approval required`:
   - Request approval first and pass the received `approvalToken`

4. `read-only mode` blocked:
   - Check whether `NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE=true`

5. Timeout:
   - Increase `MCP_BRIDGE_TIMEOUT_MS`
   - Check the target server status/network for `MCP_BRIDGE_BASE_URL`

6. Component not found:
   - First confirm `CHAIN_TYPE=opstack`
   - Check mapping between OP Stack component names and target names

---

## 8. Recommended ops checklist

1. Before starting: confirm `CHAIN_TYPE=opstack`, server/bridge processes, and key settings
2. Before action: obtain a hypothesis via comprehensive diagnostics + root-cause analysis
3. During action: start with the smallest-scope action based on an approval token
4. After action: compare before/after with the same diagnostic tools and record results
