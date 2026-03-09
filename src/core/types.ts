/**
 * SentinAI Core Type Definitions
 * Foundation types for the multi-protocol node monitoring platform.
 *
 * Supports: L1 Execution Clients (Geth, Reth, Nethermind, Besu),
 *           L2 Sequencers (OP Stack, Arbitrum Nitro, ZK Stack)
 */

// ============================================================
// Node Type Enumeration
// ============================================================

/**
 * Supported node protocol types.
 * Each type maps to a ProtocolDescriptor and a specific MetricsCollector.
 */
export type NodeType =
  | 'ethereum-el'     // L1 Execution Layer (Geth, Reth, Nethermind, Besu)
  | 'opstack-l2'      // OP Stack L2 Sequencer (Thanos, Optimism, Base, etc.)
  | 'arbitrum-nitro'  // Arbitrum Nitro L2 (Arbitrum One, Nova, Orbit)
  | 'zkstack';        // ZK Stack L2 (zkSync Era, etc.)

// ============================================================
// Protocol Capabilities
// ============================================================

/**
 * Feature flags indicating what a protocol supports.
 */
export type ProtocolCapability =
  | 'txpool-monitoring'         // Transaction pool size tracking
  | 'peer-monitoring'           // Peer count tracking
  | 'sync-monitoring'           // Sync status (syncing/synced)
  | 'l1-dependency-monitoring'  // L1 block reference tracking (L2 only)
  | 'gas-monitoring'            // Gas usage ratio tracking
  | 'eoa-balance-monitoring'    // EOA wallet balance (L2 sequencer only)
  | 'block-production'          // Block height and production rate
  | 'cpu-monitoring';           // CPU/resource usage

// ============================================================
// Anomaly Detection Configuration
// ============================================================

/**
 * Per-field anomaly detection settings.
 * Mirrors the existing AnomalyDetector interface but protocol-parameterized.
 */
export interface FieldAnomalyConfig {
  /** Whether anomaly detection is active for this field */
  enabled: boolean;
  /** Detection method to use */
  method: 'z-score' | 'threshold' | 'rate-of-change' | 'plateau';
  /** Hard threshold — immediate alert (e.g., peerCount < 3) */
  criticalThreshold?: number;
  /** Soft threshold — warning level */
  warningThreshold?: number;
  /** Z-Score multiplier override (default: 3.0 from env) */
  zScoreThreshold?: number;
}

// ============================================================
// Protocol Descriptor
// ============================================================

/**
 * Protocol-level configuration: what metrics to collect, how to detect anomalies,
 * and what capabilities the protocol supports.
 *
 * One descriptor per protocol type. Registered in ProtocolRegistry at startup.
 */
export interface ProtocolDescriptor {
  /** Unique protocol identifier (matches NodeType) */
  readonly protocolId: NodeType;
  /** Human-readable display name (e.g., "Ethereum Execution Layer") */
  readonly displayName: string;
  /** Protocol version or variant description (e.g., "OP Stack Bedrock+") */
  readonly version?: string;
  /** Ordered list of metric fields this protocol collects */
  readonly metricsFields: import('./metrics').MetricFieldDefinition[];
  /** Which collector implementation to use */
  readonly collectorType: 'evm-execution' | 'beacon-api' | 'opstack-l2' | 'custom';
  /** Feature capabilities this protocol supports */
  readonly capabilities: ProtocolCapability[];
  /** Per-field anomaly detection config */
  readonly anomalyConfig: Record<string, FieldAnomalyConfig>;
  /**
   * Optional ChainPlugin bridge: if this protocol has a legacy ChainPlugin,
   * reference the plugin type for backwards compatibility.
   */
  readonly legacyChainType?: string;
}

// ============================================================
// Connection Configuration
// ============================================================

/**
 * Network connection parameters for a node instance.
 * Sensitive fields (authToken) are AES-256-GCM encrypted at rest.
 */
export interface ConnectionConfig {
  /** Primary JSON-RPC HTTP endpoint (e.g., "http://localhost:8545") */
  rpcUrl: string;
  /**
   * Bearer token or Basic auth credential for authenticated RPC.
   * Stored encrypted in Redis — never returned in plaintext via API.
   */
  authToken?: string;
  /** Beacon API endpoint (legacy, unused). */
  beaconApiUrl?: string;
  /** WebSocket endpoint for subscription-based monitoring */
  wsUrl?: string;
  /**
   * Chain ID override. If omitted, auto-detected via eth_chainId.
   * Required for L2 types where auto-detection may be unreliable.
   */
  chainId?: number;
}

// ============================================================
// Connection Validation
// ============================================================

/** Result of a single connection check step */
export interface ConnectionCheck {
  name: string;
  passed: boolean;
  detail?: string;
  latencyMs?: number;
}

/** Aggregated result of validateConnection() */
export interface ConnectionValidationResult {
  valid: boolean;
  checks: ConnectionCheck[];
  /** Detected client software version (e.g., "Geth/v1.14.0-stable") */
  clientVersion?: string;
  /** Detected chain ID */
  chainId?: number;
  /** Total validation latency */
  totalLatencyMs: number;
  error?: string;
}

// ============================================================
// Node Instance
// ============================================================

/** Lifecycle status of a monitored node instance */
export type NodeInstanceStatus =
  | 'pending'   // Registered, first connect not yet attempted
  | 'active'    // Agent loop running, metrics collecting
  | 'paused'    // Agent loop suspended by operator
  | 'error';    // Connection failed or agent loop crashed

/**
 * A single monitored node instance.
 * Persisted in Redis under key: `inst:{instanceId}:config`
 *
 * Supports both:
 * - Multi-tenant SaaS: operatorId scopes data isolation
 * - Self-hosted single node: operatorId = "default", instanceId = "default"
 */
export interface NodeInstance {
  /** UUID v4, immutable after creation */
  readonly instanceId: string;
  /** Operator/team identifier for data isolation. Use "default" for self-hosted. */
  operatorId: string;
  /** Which protocol this instance runs (links to ProtocolDescriptor) */
  protocolId: NodeType;
  /** Human-readable label shown in dashboard (e.g., "Thanos Sepolia Sequencer") */
  displayName: string;
  /** Network connection parameters */
  connectionConfig: ConnectionConfig;
  /** Current lifecycle status */
  status: NodeInstanceStatus;
  /** ISO 8601 creation timestamp */
  readonly createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** Optional arbitrary key-value tags for filtering/grouping */
  metadata?: Record<string, string>;
}

// ============================================================
// Instance Create/Update DTOs
// ============================================================

/**
 * Payload for POST /api/v2/instances
 * instanceId and timestamps are server-generated.
 */
export interface CreateNodeInstanceDto {
  operatorId?: string;
  protocolId: NodeType;
  displayName: string;
  connectionConfig: ConnectionConfig;
  metadata?: Record<string, string>;
}

/**
 * Payload for PATCH /api/v2/instances/:id
 * All fields optional; only provided fields are updated.
 */
export interface UpdateNodeInstanceDto {
  displayName?: string;
  connectionConfig?: Partial<ConnectionConfig>;
  status?: NodeInstanceStatus;
  metadata?: Record<string, string>;
}

// ============================================================
// Agent Instance State
// ============================================================

/**
 * Runtime state of the agent loop for a single instance.
 * Separate from NodeInstance (which is persisted config).
 */
export interface AgentInstanceState {
  instanceId: string;
  isRunning: boolean;
  lastCycleAt?: string;
  cycleCount: number;
  consecutiveErrors: number;
  lastError?: string;
}
