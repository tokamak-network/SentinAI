Run a SentinAI Root Cause Analysis for this L2 node and return a one-paragraph diagnosis.

1. Call `mcp__sentinai__run_rca`
2. Call `mcp__sentinai__get_anomalies` with `limit: 10`

Then output exactly this format:

**RCA Result** — [timestamp]
[One paragraph, max 5 sentences: what happened, what the root cause is, confidence level, and the top suggested action. If confidence < 50%, say "low confidence — manual investigation recommended."]

If $ARGUMENTS is provided, treat it as additional symptom context and mention whether the RCA result matches the described symptom.
