Show recent autonomous decisions and actions taken by the SentinAI pipeline.

Call `mcp__sentinai__get_autonomy_feed` with `limit: 20`.

Format the result as a concise activity log:

**SentinAI Autonomous Activity** (last 20 events)

For each entry, print one line:
`[relative time] [KIND] [action or verdict] — [agent]`

Where KIND is color-coded in your mind (executed=✅, suppressed=⚠️, blocked=🚫, fallback=🔄, decision=🔵).

Example:
```
3m ago  ✅ EXECUTED  scale_execution (4→8 vCPU) — executor-agent
7m ago  ⚠️ SUPPRESSED  restart_execution — simulation_mode
12m ago 🔄 FALLBACK  qwen failed → anthropic — ai-client
18m ago 🚫 BLOCKED  downscale blocked while active anomalies exist — goal-plan-validator
```

After the log, print a one-line summary:
`Executed: N | Suppressed: N | Blocked: N | Fallbacks: N`

If you want to filter by kind, re-call with `kind: "action_executed"` (or `"action_suppressed"`, `"guardrail_blocked"`, `"fallback_triggered"`, `"decision_taken"`).
If you want to see only recent events, pass `since: "<ISO timestamp>"`.
