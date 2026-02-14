/**
 * Chain Plugin Type Definitions
 * Abstraction layer for multi-chain L2 support
 */

import type { Chain } from 'viem';
import type { Playbook } from '@/types/remediation';

// ============================================================
// Primitive Aliases
// ============================================================

/** Component identifier (e.g. 'op-geth', 'nitro-node') */
export type ChainComponent = string;

/** EOA role identifier (e.g. 'batcher', 'sequencer') */
export type ChainEOARole = string;

// ============================================================
// Component Topology
// ============================================================

/** Upstream/downstream dependency relationship */
export interface ComponentDependency {
  /** Components this component depends on (upstream) */
  dependsOn: ChainComponent[];
  /** Components that depend on this component (downstream) */
  feeds: ChainComponent[];
}

// ============================================================
// K8s Configuration
// ============================================================

/** K8s naming and label configuration for a single component */
export interface K8sComponentConfig {
  /** Component identifier (e.g. 'op-geth') */
  component: ChainComponent;
  /** Label suffix for pod selector (e.g. 'geth' -> app=op-geth) */
  labelSuffix: string;
  /** StatefulSet name suffix (e.g. 'op-geth' -> prefix-op-geth-0) */
  statefulSetSuffix: string;
  /** Env var name for L1 RPC URL in this component's pod (if applicable) */
  l1RpcEnvVar?: string;
  /** Whether this is the primary execution client (scaling target) */
  isPrimaryExecution: boolean;
}

// ============================================================
// EOA Configuration
// ============================================================

/** EOA monitoring configuration for a single role */
export interface EOAConfig {
  /** Role identifier (e.g. 'batcher', 'proposer') */
  role: ChainEOARole;
  /** Env var name for the EOA address */
  addressEnvVar: string;
  /** Human-readable display name */
  displayName: string;
}

// ============================================================
// AI Prompt Fragments
// ============================================================

/** Chain-specific AI prompt fragments injected into engine modules */
export interface ChainAIPrompts {
  /** Full RCA system prompt (describes component architecture) */
  rcaSystemPrompt: string;
  /** Anomaly analyzer context (component relationships + failure patterns) */
  anomalyAnalyzerContext: string;
  /** Predictive scaler context (target component + workload characteristics) */
  predictiveScalerContext: string;
  /** Cost optimizer context (workload patterns + pricing context) */
  costOptimizerContext: string;
  /** Daily report context (system description for report generation) */
  dailyReportContext: string;
  /** NLOps system context (system description for chat) */
  nlopsSystemContext: string;
  /** Common failure patterns description */
  failurePatterns: string;
}

// ============================================================
// ChainPlugin Interface
// ============================================================

/**
 * Chain Plugin interface.
 * Encapsulates all chain-specific knowledge for an L2 stack.
 *
 * To add a new chain: implement this interface in src/chains/<chain>/index.ts
 */
export interface ChainPlugin {
  /** Unique chain type identifier (e.g. 'optimism', 'arbitrum') */
  readonly chainType: string;
  /** Human-readable display name (e.g. 'Optimism L2 Rollup') */
  readonly displayName: string;

  // ---- Component Topology ----

  /** L2-specific components (e.g. ['op-geth', 'op-node', ...]) */
  readonly components: ChainComponent[];
  /** Meta-components shared across chains (e.g. ['l1', 'system']) */
  readonly metaComponents: ChainComponent[];
  /** Component dependency graph (keyed by component name) */
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency>;
  /** Alias map for component name normalization (e.g. 'geth' -> 'op-geth') */
  readonly componentAliases: Record<string, ChainComponent>;

  // ---- K8s ----

  /** K8s component configurations */
  readonly k8sComponents: K8sComponentConfig[];
  /** Primary execution client component name (scaling target) */
  readonly primaryExecutionClient: ChainComponent;

  // ---- EOA & Balance ----

  /** EOA roles this chain uses (e.g. ['batcher', 'proposer']) */
  readonly eoaRoles: ChainEOARole[];
  /** EOA configuration for each role */
  readonly eoaConfigs: EOAConfig[];
  /** Balance metric names for anomaly detection (e.g. ['batcherBalance']) */
  readonly balanceMetrics: string[];

  // ---- viem Chain ----

  /** L1 chain configuration for viem */
  readonly l1Chain: Chain;
  /** L2 chain configuration for viem */
  readonly l2Chain: Chain;

  // ---- AI Prompts ----

  /** Chain-specific AI prompt fragments */
  readonly aiPrompts: ChainAIPrompts;

  // ---- Methods ----

  /** Map an anomaly metric name to the responsible component */
  mapMetricToComponent(metric: string): ChainComponent;

  /** Normalize a component name (handles aliases, case variations) */
  normalizeComponentName(name: string): ChainComponent;

  /** Get chain-specific remediation playbooks */
  getPlaybooks(): Playbook[];
}
