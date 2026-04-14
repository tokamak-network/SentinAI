Replay an incident — reconstruct what SentinAI saw and did during a specific time window.

Usage:
- By anomaly event ID: the pipeline automatically uses a ±30 minute window around the event
- By time window: specify start and end in ISO 8601 format

Call `mcp__sentinai__replay_incident` with either:
- `{ "eventId": "<anomaly event UUID>" }` — to center on a known event
- `{ "since": "<ISO>", "until": "<ISO>" }` — to specify a window explicitly

Format the result as an incident timeline:

**Incident Replay**
Window: [since] → [until]

**Anomaly Events** ([N] total)
For each anomaly event:
`[timestamp] [severity] [component] — [description]`

**Pipeline Actions** ([N] ledger entries)
For each ledger entry:
`[timestamp] [KIND] [action] — [agent] — [verdict or suppressionReason]`

**Summary**
- Anomalies detected: N
- Actions executed: N
- Actions suppressed: N
- Guardrail blocks: N
- AI fallbacks: N

**Assessment**
Based on the timeline above, briefly describe:
1. What triggered the incident
2. What the pipeline did autonomously
3. Whether the response was appropriate (executed actions vs. anomaly severity)
4. Any suppressed actions that may have been blocked unnecessarily

If no events are found in the window, say: "No activity recorded in this window. Check that the time range is correct and that the pipeline was running."
