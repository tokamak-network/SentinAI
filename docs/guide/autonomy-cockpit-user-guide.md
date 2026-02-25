# Autonomy Cockpit User Guide

## 1. Purpose

`Autonomy Cockpit` is an operations panel in the SentinAI dashboard that lets you view autonomous agent status on a single screen,
and run scenario injection / Goal Tick / Dispatch Dry-run.

Audience:
- Operator

---

## 2. Prerequisites

### 2.1 Required environment variables

Minimum recommended values (based on `.env.local`):

```bash
# Enable Agent Loop (automatic)
L2_RPC_URL=https://your-l2-rpc.example.com

# Goal Manager
GOAL_MANAGER_ENABLED=true
GOAL_MANAGER_DISPATCH_ENABLED=true
GOAL_MANAGER_DISPATCH_DRY_RUN=true
GOAL_MANAGER_DISPATCH_ALLOW_WRITES=false

# Runtime autonomy defaults (optional)
GOAL_AUTONOMY_LEVEL=A2
GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN=0.35
GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE=0.65
```

### 2.2 When using policy changes / dispatch buttons

Changing `Autonomy Level` and running `Dispatch Dry-run` are write API calls, so the API key must be valid.

```bash
# Server authentication key
SENTINAI_API_KEY=your-admin-key

# Dashboard (for injecting write headers) - same value as the server key
NEXT_PUBLIC_SENTINAI_API_KEY=your-admin-key
```

Notes:
- `NEXT_PUBLIC_*` values are exposed to the browser.
- Use only in internal networks / demo environments, and in public environments we recommend separate access controls (SSO/VPN/IP allowlists).

### 2.3 Development vs production mode differences

- The `Stable/Rising/Spike` buttons call `POST /api/metrics/seed`.
- This endpoint is blocked with 403 when `NODE_ENV=production`.
- In production, observe only real traffic-derived state instead of injecting seed data.

---

## 3. Understanding the panel layout

The dashboard `Autonomy Cockpit` panel consists of the four areas below.

### 3.1 Top badges

- `A0~A5`: Current runtime autonomy policy level
- `loop:on/off`: Agent Loop enabled status (`/api/agent-loop`)

### 3.2 Engine Status

- `Goal Manager`: Whether the candidate generation / queue management engine is enabled
- `Dispatch`: Whether dispatch execution is enabled
- `Dispatch Mode`: `dry-run` or `write`

### 3.3 Goal Queue

- `Queue Depth`: Number of goals in queued/scheduled/running states
- `Active Goal`: Currently-processing goal id (shortened)
- `top`: Summary of the top-of-queue goal
- `suppression`: Number of suppressed candidates
- `dlq`: Number of items moved to the DLQ after failures

### 3.4 Guardrails

- `Read-Only`: Whether read-only mode is enabled
- `Verify`: Most recent execution verification result (PASS/FAIL/N/A)
- `Approval (Write)`: Whether write-family approvals are required
- `degraded`: Most recent degraded reason

---

## 4. Autonomy Level (A0~A5)

| Level | Permission | Guardrail |
|---|---|---|
| A0 | Observe only, no autonomous execution | All executions require manual approval |
| A1 | Can generate recommendations; execution is manually triggered | Automatic dispatch disabled |
| A2 | Allow autonomous dry-run execution | Block write execution; approval required |
| A3 | Allow low-risk goal write execution | Switch to degraded mode on verification failure |
| A4 | Expand automatic execution up to medium-risk goals | Enforce approval/verification/audit logs |
| A5 | Maximum autonomy including high-risk | Auto-rollback on post-verification failure |

Reference:
- The panel footer shows the current `dry-run threshold` and `write threshold`.
- On hover, each level button shows Permission/Guardrail tooltips.

---

## 5. Basic usage procedure

### 5.1 Check status

1. Confirm the `Autonomy Cockpit` panel is visible
2. Confirm the top badge shows `loop:on`
3. In `Engine Status`, confirm `Goal Manager=Enabled` and `Dispatch=On`

### 5.2 Inject a scenario (development mode)

1. Click one of `Stable` / `Rising` / `Spike`
2. Confirm the feedback message
   - e.g. `Scenario spike injected (20 data points)`

### 5.3 Run Goal Tick

1. Click `Goal Tick`
2. Confirm the feedback message
   - e.g. `Goal tick completed (generated 4, queued 2, queue depth 2)`
3. Check changes in `Queue Depth`, `top`, and `suppression`

### 5.4 Run Dry-run Dispatch

1. Click `Dispatch Dry-run`
2. Confirm the feedback message
   - e.g. `Dry-run dispatch completed (status: dispatched)`
3. Check `verify/degraded` in `Guardrails` together with `Goal Queue` state

### 5.5 Change autonomy level

1. Click the target level among the `A0~A5` buttons
2. Confirm the success message
   - e.g. `Autonomy level changed to A3.`
3. Confirm the top level badge and current policy description update immediately

---

## 6. UI actions to API mapping

| UI action | API | Auth requirement | Notes |
|---|---|---|---|
| Stable/Rising/Spike | `POST /api/metrics/seed?scenario=<name>` | No API key required by default | Development-mode only (blocked in `production`) |
| Goal Tick | `POST /api/goal-manager/tick` | Requires `x-api-key` when `SENTINAI_API_KEY` is set | Performs queue generation / suppression calculation |
| Dispatch Dry-run | `POST /api/goal-manager/dispatch` (`dryRun=true`, `allowWrites=false`) | Requires `x-api-key` | Route also re-validates the admin key |
| Autonomy Level buttons | `POST /api/policy/autonomy-level` | Requires `x-api-key` | Runtime updates for level/thresholds |
| Status panel polling | `GET /api/goal-manager?limit=20`, `GET /api/policy/autonomy-level`, `GET /api/agent-loop` | Not required | Refreshes about every 30 seconds |

---

## 7. Troubleshooting

### 7.1 `Changing policy level requires NEXT_PUBLIC_SENTINAI_API_KEY`

Cause:
- No key in the browser to construct write API headers

Action:
1. Set `SENTINAI_API_KEY` and `NEXT_PUBLIC_SENTINAI_API_KEY` to the same value in `.env.local`
2. Restart the server

### 7.2 `Unauthorized: invalid or missing x-api-key`

Cause:
- Mismatch between the server key (`SENTINAI_API_KEY`) and the request key

Action:
1. Verify server env and browser env values match
2. Check that the reverse proxy is not stripping the `x-api-key` header

### 7.3 `This endpoint is only available in development mode`

Cause:
- `metrics/seed` is blocked in production mode

Action:
1. In production, validate using real metrics instead of the seed injection buttons
2. If you need a demo, run it in a development environment

### 7.4 Queue stays at 0

Cause:
- Goal Manager disabled
- Candidate generation / queueing conditions not met given the signal

Action:
1. Check `GOAL_MANAGER_ENABLED=true`
2. Check `GOAL_MANAGER_DISPATCH_ENABLED=true`
3. After `Goal Tick`, first inspect generated/queued values in the feedback

### 7.5 `loop:off`

Cause:
- Agent Loop disabled (`L2_RPC_URL` not set or `AGENT_LOOP_ENABLED=false`)

Action:
1. Set `L2_RPC_URL`
2. If needed, explicitly set `AGENT_LOOP_ENABLED=true`

---

## 8. Operational recommendations

1. For initial operation, start with the `A2 + dry-run` combination.
2. Before raising to `A3` or higher for write execution, validate verification/rollback procedures first.
3. Before switching `GOAL_MANAGER_DISPATCH_ALLOW_WRITES=true`, accumulate and review dry-run results for at least 1 day.
4. When doing incident analysis, archive the following APIs together with `Autonomy Cockpit` status.

```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.phase, .lastCycle.verification, .lastCycle.degraded'
curl -s "http://localhost:3002/api/goal-manager?limit=20" | jq '.queueDepth, .queue[0], .suppression[0], .dlq[0]'
curl -s http://localhost:3002/api/policy/autonomy-level | jq '.policy'
```

---

## 9. Related documents

- `docs/guide/agentic-q1-operations-runbook.md`
- `docs/guide/agent-loop-vs-goal-manager-hands-on-runbook.md`
- `docs/guide/multistack-autonomous-ops-validation.md`
- `docs/guide/network-stack-dashboard-feature-differences.md`
- `docs/guide/stack-environment-operations-decision-matrix.md`
- `docs/guide/sentinai-mcp-user-guide.md`
- `docs/guide/demo-scenarios.md`
