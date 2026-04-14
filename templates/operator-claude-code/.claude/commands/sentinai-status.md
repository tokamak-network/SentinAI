Get a quick SentinAI status summary for this L2 node.

Call `mcp__sentinai__get_metrics` with `limit: 3`, then format the result as:

**SentinAI Node Status**
- Block height: [value]
- Block production rate: [value] blocks/min
- Txpool size: [value] pending txs
- Sync lag: [value]s
- Peer count: [value]
- CPU: [value]%  |  Memory: [value] GiB
- Scaler state: [idle / scaling / cooling-down]
- Last anomaly: [description or "none in recent window"]

Keep it to 8 lines maximum. No prose, just the table.
