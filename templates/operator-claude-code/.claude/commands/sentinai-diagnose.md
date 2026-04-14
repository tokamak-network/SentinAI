Run a full SentinAI health diagnostic for this L2 node.

Call `mcp__sentinai__run_health_diagnostics` and return the complete result.

Format the output as:

**SentinAI Health Diagnostics** — [timestamp]

[For each check in the diagnostics result, show:]
- [check name]: [PASS / WARN / FAIL] — [detail]

At the end, summarize:
**Overall: [HEALTHY / DEGRADED / CRITICAL]**
Issues requiring attention: [list or "none"]
