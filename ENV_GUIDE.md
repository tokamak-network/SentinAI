# SentinAI Environment Configuration Guide

```bash
cp .env.local.sample .env.local   # Then edit
```

Or use the interactive setup wizard:

```bash
npm run setup
```

---

## Required

| Variable | Description |
|----------|-------------|
| `L2_RPC_URL` | L2 Chain RPC endpoint |
| AI API Key (one of) | `QWEN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` |
| `AWS_CLUSTER_NAME` | EKS cluster name (auto-detects K8S_API_URL & region) |

## AI Provider

Priority: Gateway > Qwen > Anthropic > OpenAI > Gemini. Set only the API key for your chosen provider.

| Priority | Env Var | Provider | Fast Model | Best Model |
|----------|---------|----------|------------|------------|
| 0 | `AI_GATEWAY_URL` + Key | LiteLLM Gateway | (detected provider) | (detected provider) |
| 1 | `QWEN_API_KEY` | Qwen (OpenAI compatible) | `qwen-turbo-latest` | `qwen-max-latest` |
| 2 | `ANTHROPIC_API_KEY` | Anthropic Direct | `claude-haiku-4-5-20251001` | `claude-sonnet-4-5-20250929` |
| 3 | `OPENAI_API_KEY` | OpenAI Direct | `gpt-4.1-mini` | `gpt-4.1` |
| 4 | `GEMINI_API_KEY` | Gemini Direct | `gemini-2.5-flash-lite` | `gemini-2.5-pro` |

### AI Model Overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `QWEN_BASE_URL` | DashScope | Qwen API endpoint (any OpenAI-compatible server) |
| `QWEN_MODEL` | auto | Override Qwen model name |
| `OPENAI_BASE_URL` | api.openai.com | OpenAI-compatible endpoint |
| `OPENAI_MODEL` | auto | Override OpenAI model name for both tiers |
| `OPENAI_MODEL_FAST` | — | Fast tier model override (priority over `OPENAI_MODEL`) |
| `OPENAI_MODEL_BEST` | — | Best tier model override (priority over `OPENAI_MODEL`) |

## Optional

### Kubernetes

| Variable | Default | Description |
|----------|---------|-------------|
| `K8S_NAMESPACE` | `default` | Namespace where L2 pods are deployed |
| `K8S_APP_PREFIX` | `op` | Pod label prefix (`app=op-geth`) |
| `K8S_API_URL` | auto-detect | Manual K8s API URL override |
| `K8S_INSECURE_TLS` | `false` | Skip TLS verification (dev only) |

### Container Orchestrator

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_TYPE` | `k8s` | `k8s` or `docker` for Docker Compose L2 nodes |
| `DOCKER_COMPOSE_FILE` | `docker-compose.yml` | Path to Docker Compose file |
| `DOCKER_COMPOSE_PROJECT` | auto | Docker Compose project name |
| `DOCKER_ENV_FILE` | `.env` | .env file for Docker Compose env updates |

### State Store

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis state store. Required for production and fail-closed for agent marketplace reputation publishing. |

### Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `ALERT_WEBHOOK_URL` | — | Slack/Webhook URL for anomaly alerts |

### Cost Tracking

| Variable | Default | Description |
|----------|---------|-------------|
| `COST_TRACKING_ENABLED` | `true` | vCPU usage pattern tracking |

### Agent Loop (Serial)

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_LOOP_ENABLED` | auto | Server-side autonomous loop (auto-enabled if L2_RPC_URL set) |
| `AGENT_HEARTBEAT_STALE_SECONDS` | `120` | Heartbeat considered stale after N seconds |
| `AGENT_HEARTBEAT_WATCHDOG_ENABLED` | `true` | In-process watchdog (auto alert + recovery) |
| `AGENT_HEARTBEAT_ALERT_COOLDOWN_SECONDS` | `300` | Minimum interval between watchdog alerts |
| `AGENT_HEARTBEAT_RECOVERY_COOLDOWN_SECONDS` | `120` | Minimum interval between auto-recovery attempts |
| `AGENT_HEARTBEAT_ALERT_WEBHOOK_URL` | — | Override webhook (fallback: `ALERT_WEBHOOK_URL`) |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 auto-remediation trigger |

### Agent v2 (Parallel Agent System)

When `AGENT_V2=true`, the serial agent-loop (60s cron) is replaced by a parallel multi-agent orchestrator with 5 role-based agents per instance: Collector (5s), Detector (10s), Analyzer (event-driven), Executor (event-driven), Verifier (event-driven).

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_V2` | — | Set to `true` to enable parallel agent orchestrator. Disables serial agent-loop. |
| `SENTINAI_INSTANCES` | — | JSON array of instances: `[{"instanceId":"id","protocolId":"opstack-l2","rpcUrl":"https://..."}]` |
| `SENTINAI_DEFAULT_INSTANCE_ID` | `default` | Instance ID used when `SENTINAI_INSTANCES` is not set |
| `SENTINAI_DEFAULT_PROTOCOL_ID` | `opstack-l2` | Protocol ID used when `SENTINAI_INSTANCES` is not set |

### Agent v2 Goal Manager (Autonomous Goal Generation & Execution)

**Note**: These variables are for the dashboard (root Next.js app) only, **not** for the website (Vercel landing page).

Goal Manager enables automatic goal generation from anomalies/events and autonomous execution with multi-stage approval workflow.

| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_MANAGER_ENABLED` | `false` | Enable automatic goal generation from remediation events |
| `GOAL_MANAGER_DISPATCH_ENABLED` | `false` | Enable autonomous goal dispatch and execution |
| `GOAL_MANAGER_DISPATCH_DRY_RUN` | `true` | Execute goals in dry-run mode (no actual changes) |
| `GOAL_MANAGER_DISPATCH_ALLOW_WRITES` | `false` | Allow actual write operations (requires autonomy approval) |
| `GOAL_CANDIDATE_LLM_ENABLED` | `false` | Enable LLM-enhanced goal candidate generation |
| `GOAL_MANAGER_MIN_CONFIDENCE` | `0.5` | Minimum confidence score for goal acceptance (0.0-1.0) |
| `GOAL_MANAGER_DEDUP_WINDOW_MINUTES` | `30` | Time window for goal deduplication (1-1440 min) |
| `GOAL_MANAGER_STALE_SIGNAL_MINUTES` | `90` | Time before goal signal considered stale (1-1440 min) |
| `GOAL_MANAGER_DEFAULT_TTL_MINUTES` | `60` | Default goal time-to-live (5-1440 min) |

### Agent v2 Autonomy Policy (Confidence & Execution Levels)

**Note**: These variables are for the dashboard (root Next.js app) only, **not** for the website (Vercel landing page).

Autonomy policy controls when autonomous operations (goal execution, scaling, remediation) are allowed based on confidence scores.

| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_AUTONOMY_LEVEL` | `A2` | Autonomy level: `A0` (manual only) → `A1` (monitor) → `A2` (suggest) → `A3` (auto-dry-run) → `A4` (auto-write-low) → `A5` (fully autonomous) |
| `GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN` | `0.35` | Minimum confidence for dry-run execution (0.0-1.0) |
| `GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE` | `0.65` | Minimum confidence for actual write operations (0.0-1.0) |

### Agent Memory / Decision Trace

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_MEMORY_ENABLED` | `true` | Enable agent memory persistence |
| `AGENT_MEMORY_RETENTION_DAYS` | `30` | Memory retention period |
| `AGENT_TRACE_MAX_ITEMS` | `5000` | Maximum decision trace items |
| `AGENT_TRACE_MASK_SECRETS` | `true` | Mask secrets in traces |

### MCP Server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SERVER_ENABLED` | `true` | Model Context Protocol endpoint |
| `MCP_AUTH_MODE` | `api-key` | `api-key` / `approval-token` / `dual` |
| `MCP_APPROVAL_REQUIRED` | `true` | Require approval token for write tools |
| `MCP_APPROVAL_TTL_SECONDS` | `300` | One-time approval token TTL |

### Agent Marketplace

| Variable | Default | Description |
|----------|---------|-------------|
| `MARKETPLACE_ENABLED` | `false` | Enable standalone agent marketplace routes and bootstrap registration hook |
| `MARKETPLACE_PAYMENT_MODE` | `facilitated` | `open` / `stub` / `facilitated` payment verification mode |
| `MARKETPLACE_RATE_LIMIT_MAX_REQUESTS` | `60` | Max requests per agent and service within the rate-limit window |
| `MARKETPLACE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |
| `MARKETPLACE_AGENT_URI_BASE` | — | Public base URL used to build agent marketplace metadata and registration URL |
| `MARKETPLACE_WALLET_KEY` | — | Marketplace signer key used for ERC-8004 registration |
| `ERC8004_REGISTRY_ADDRESS` | — | Target ERC-8004 registry contract address |
| `MARKETPLACE_REPUTATION_REGISTRY_ADDRESS` | — | Reputation registry contract address for `submitMerkleRoot` |
| `MARKETPLACE_IPFS_MODE` | — | `stub` or `http` IPFS publishing mode |
| `MARKETPLACE_IPFS_UPLOAD_URL` | — | HTTP endpoint used to pin reputation batch payloads |
| `MARKETPLACE_IPFS_AUTH_TOKEN` | — | Bearer token for the IPFS upload endpoint |
| `MARKETPLACE_REPUTATION_ENABLED` | `false` | Enable daily scheduler-based reputation batch publishing. Requires `REDIS_URL`. |
| `MARKETPLACE_REPUTATION_SCHEDULE` | `10 0 * * *` | UTC cron expression for daily reputation batch publish |

### AI Routing Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_ROUTING_ENABLED` | `true` | Enable AI routing |
| `AI_ROUTING_POLICY` | `balanced` | `latency-first` / `balanced` / `quality-first` / `cost-first` |
| `AI_ROUTING_AB_PERCENT` | `10` | Routing policy rollout percentage (0-100) |
| `AI_ROUTING_BUDGET_USD_DAILY` | `50` | Daily AI budget cap |

### EOA Balance Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `BATCHER_EOA_ADDRESS` | — | Batcher EOA address to monitor |
| `PROPOSER_EOA_ADDRESS` | — | Proposer EOA address to monitor |
| `CHALLENGER_EOA_ADDRESS` | — | Challenger EOA address (Fault Proof only) |
| `BATCHER_PRIVATE_KEY` | — | Derive batcher EOA from private key |
| `PROPOSER_PRIVATE_KEY` | — | Derive proposer EOA from private key |
| `CHALLENGER_PRIVATE_KEY` | — | Challenger private key |
| `TREASURY_PRIVATE_KEY` | — | Treasury wallet for auto-refill (omit for monitor-only) |
| `EOA_BALANCE_WARNING_ETH` | `0.5` | Warning threshold |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | Critical threshold (triggers auto-refill) |
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | ETH amount per refill |
| `EOA_REFILL_MAX_DAILY_ETH` | `5` | Daily refill cap |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | Cooldown between refills per EOA |
| `EOA_GAS_GUARD_GWEI` | `100` | Skip refill if L1 gas exceeds this |
| `EOA_TREASURY_MIN_ETH` | `1.0` | Min treasury balance to allow refill |

### L1 RPC Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTINAI_L1_RPC_URL` | publicnode.com | Single public L1 RPC for SentinAI monitoring |
| `L1_RPC_URLS` | — | Comma-separated L1 RPC endpoints for failover pool |

### L1 Proxyd Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `L1_PROXYD_ENABLED` | `false` | Enable Proxyd ConfigMap update for L1 failover |
| `L1_PROXYD_CONFIGMAP_NAME` | `proxyd-config` | ConfigMap name |
| `L1_PROXYD_DATA_KEY` | `proxyd-config.toml` | TOML key in ConfigMap |
| `L1_PROXYD_UPSTREAM_GROUP` | `main` | Upstream group to update |
| `L1_PROXYD_UPDATE_MODE` | `replace` | `replace` (update URL) or `append` (add new + rotate) |

### Fault Proof

| Variable | Default | Description |
|----------|---------|-------------|
| `FAULT_PROOF_ENABLED` | — | Enable Fault Proof features |
| `DISPUTE_GAME_FACTORY_ADDRESS` | — | L1 DisputeGameFactory contract address |
| `GAME_DEADLINE_ALERT_HOURS` | `24` | Alert when game deadline < N hours |
| `AUTO_BOND_CLAIM` | `false` | Auto-claim bonds from won games |
| `CHALLENGER_BOND_MIN_ETH` | `0.8` | Minimum total balance for bond participation |
| `CHALLENGER_BOND_REFILL_ETH` | `1.0` | Auto-refill amount when balance critical |
| `CHALLENGER_BALANCE_WARNING_ETH` | `0.5` | Warning threshold |
| `CHALLENGER_BALANCE_CRITICAL_ETH` | `0.1` | Critical threshold |

### Display

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAIN_TYPE` | `thanos` | `thanos` / `optimism` / `zkstack` / `arbitrum` / `arbitrum-orbit` / `nitro` |
| `L2_CHAIN_ID` | — | L2 chain ID |
| `L2_CHAIN_NAME` | — | Display name for L2 chain |
| `L2_NETWORK_SLUG` | — | viem network slug |
| `L2_EXPLORER_URL` | — | Block explorer URL |
| `L2_IS_TESTNET` | `true` | Set false for production L2 |
| `L1_CHAIN` | `sepolia` | `sepolia` or `mainnet` |
| `NEXT_PUBLIC_NETWORK_NAME` | — | Network name shown in dashboard header |
| `NEXT_PUBLIC_BASE_PATH` | — | URL subpath prefix |

### Arbitrum Orbit

| Variable | Default | Description |
|----------|---------|-------------|
| `ARB_NODE_L1_ETH_RPC` | — | L1 RPC env var for nitro-node pod |
| `ARB_BATCHPOSTER_L1_ETH_RPC` | — | L1 RPC env var for batch-poster pod |
| `ARB_VALIDATOR_L1_ETH_RPC` | — | L1 RPC env var for validator pod |
| `BATCH_POSTER_EOA_ADDRESS` | — | Batch Poster EOA to monitor |
| `VALIDATOR_EOA_ADDRESS` | — | Validator EOA to monitor |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTINAI_API_KEY` | — | API key for write endpoint auth (`x-api-key` header). Unset = no auth |
| `NEXT_PUBLIC_SENTINAI_API_KEY` | — | Client-side API key (must match `SENTINAI_API_KEY`) |

### Scaling

| Variable | Default | Description |
|----------|---------|-------------|
| `SCALING_SIMULATION_MODE` | `true` | Simulate K8s changes without real patches |

---

## Tuning Parameters

All have sensible defaults. Override only when needed.

### Stage 1: Observation Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_TIMEOUT_MS` | `15000` | RPC call timeout |
| `STATUS_PROBE_TIMEOUT_MS` | `5000` | Status probe timeout |
| `L1_CACHE_TTL_MS` | `6000` | L1 block height cache TTL |
| `EOA_CACHE_TTL_MS` | `300000` | EOA balance cache TTL |
| `EVM_RPC_TIMEOUT_MS` | `10000` | EVM RPC timeout |
| `OPSTACK_RPC_TIMEOUT_MS` | `15000` | OP Stack RPC timeout |
| `CONN_VALIDATE_TIMEOUT_MS` | `8000` | Connection validation timeout |

### Stage 2: Detection Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `ANOMALY_Z_SCORE_THRESHOLD` | `3.0` | Z-score threshold for anomaly detection |
| `ANOMALY_BLOCK_PLATEAU_SECONDS` | `120` | Block plateau detection window |
| `ANOMALY_TXPOOL_MONOTONIC_SECONDS` | `300` | TxPool monotonic increase detection |
| `ANOMALY_MIN_STD_DEV_CPU` | `0.02` | Minimum std dev for CPU |
| `ANOMALY_MIN_STD_DEV_GAS` | `0.01` | Minimum std dev for gas |
| `ANOMALY_MIN_STD_DEV_TXPOOL` | `5` | Minimum std dev for txpool |
| `ANOMALY_MIN_STD_DEV_BLOCK_INTERVAL` | `0.3` | Minimum std dev for block interval |

### Stage 3: Decision Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `SCALING_WEIGHT_CPU` | `0.3` | CPU weight in scaling score |
| `SCALING_WEIGHT_GAS` | `0.3` | Gas weight in scaling score |
| `SCALING_WEIGHT_TXPOOL` | `0.2` | TxPool weight in scaling score |
| `SCALING_WEIGHT_AI` | `0.2` | AI severity weight in scaling score |
| `RCA_MAX_HISTORY_SIZE` | `20` | RCA history buffer size |
| `RCA_MAX_RETRIES` | `2` | RCA retry count |
| `RCA_TIMEOUT_MS` | `30000` | RCA timeout |

### Stage 4: Action Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `ZERO_DOWNTIME_READY_TIMEOUT_MS` | `300000` | Zero-downtime readiness timeout |
| `ZERO_DOWNTIME_POLL_INTERVAL_MS` | `10000` | Zero-downtime poll interval |
| `ZERO_DOWNTIME_POD_CLEANUP_SLEEP_MS` | `30000` | Pod cleanup sleep |
| `KUBECTL_TOP_TIMEOUT_MS` | `5000` | kubectl top timeout |
| `RPC_CHECK_TIMEOUT_MS` | `15000` | RPC health check timeout |

### Stage 5: Communication Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_TIMEOUT_MS` | `5000` | Webhook request timeout |
| `WEBHOOK_RETRY_ATTEMPTS` | `3` | Webhook retry count |
| `WEBHOOK_RETRY_BACKOFF_MS` | `100` | Webhook retry backoff |
| `DAILY_REPORT_MAX_TOKENS` | `4096` | Daily report max tokens |
| `DAILY_REPORT_TEMPERATURE` | `0.3` | Daily report AI temperature |

### LLM Stress Test

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_TEST_QWEN_URL` | DashScope | Qwen API endpoint |
| `LLM_TEST_ANTHROPIC_URL` | api.anthropic.com | Anthropic API endpoint |
| `LLM_TEST_OPENAI_URL` | api.openai.com | OpenAI API endpoint |
| `LLM_TEST_GEMINI_URL` | Google AI | Gemini API endpoint |
| `LLM_TEST_PROXY_URL` | — | LiteLLM Gateway or proxy |
| `LLM_TEST_PROXY_ENABLED` | `false` | Route all requests through proxy |
| `LLM_TEST_PROVIDERS` | all | Providers to test (comma-separated) |
| `LLM_TEST_TIMEOUT_FAST` | `30000` | Fast-tier timeout (ms) |
| `LLM_TEST_TIMEOUT_BEST` | `60000` | Best-tier timeout (ms) |
| `LLM_TEST_PARALLELISM_DEFAULT` | `5` | Default concurrent requests |
| `LLM_TEST_OUTPUT_DIR` | `src/lib/__tests__/llm-stress-test/output` | Result output directory |
