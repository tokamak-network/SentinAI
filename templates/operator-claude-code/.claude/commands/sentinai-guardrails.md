Show guardrail events — actions the SentinAI pipeline was prevented from taking and goal plans that were blocked.

Call `mcp__sentinai__get_guardrail_events` with `limit: 30`.

Format the result as:

**SentinAI Guardrail Events** (last 30)

For each entry, print one line:
`[relative time] [KIND] [action] — [suppressionReason or verdict] — [agent]`

Example:
```
2m ago  ⚠️ SUPPRESSED  scale_execution — simulation_mode — executor-agent
15m ago 🚫 BLOCKED     policy_violation (write step in read-only mode) — goal-plan-validator
1h ago  ⚠️ SUPPRESSED  restart_execution — requires_approval — remediation-engine
```

After the log, print a breakdown:
`Suppressed: N (simulation_mode: N | whitelist_violation: N | requires_approval: N | policy_denied: N | dry_run: N)`
`Blocked:    N`

If there are no guardrail events, say: "No guardrail events recorded. Pipeline is operating with full write access or no write actions have been attempted."

These events are evidence of the guardrail layer working. Suppressed events are expected in `SCALING_SIMULATION_MODE=true`.
