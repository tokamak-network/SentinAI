/**
 * Abstract Playbook Layer - Type Definitions
 *
 * Provides chain-agnostic playbook types that work across all supported L1/L2 networks.
 * AbstractPlaybook references roles (e.g., 'block-producer') instead of hard-coded
 * component names (e.g., 'op-geth', 'nitro-sequencer').
 */

import type { AnomalyResult } from '@/types/anomaly'
import type { RemediationAction, RCAComponent } from '@/types/remediation'

/**
 * ComponentRole - Semantic role representing a logical function across all chains.
 *
 * Each chain plugin maps roles to actual component names via ChainPlugin.roleMap.
 */
export type ComponentRole =
  | 'tx-submitter'          // op-batcher, nitro-batcher, zk-batcher
  | 'block-producer'        // op-geth (sequencer), nitro-sequencer, l1 geth/reth
  | 'state-root-poster'     // op-proposer, nitro-validator, zk-state-keeper
  | 'proof-generator'       // op-challenger (fault proof), zk-prover
  | 'l1-execution-client'   // l1 geth/reth/nethermind/besu
  | 'rpc-gateway'           // proxyd
  | 'sync-node'             // read-only replica nodes

/**
 * AnomalyRule - Classifies the type of anomaly detected in a metric.
 * Used in MetricCondition to match specific anomaly patterns.
 */
export type AnomalyRule =
  | 'z-score'
  | 'zero-drop'
  | 'plateau'
  | 'monotonic-increase'
  | 'threshold-breach'

/**
 * MetricCondition - Single condition evaluated against AnomalyEvent.
 *
 * Multiple conditions are combined with AND logic in AbstractPlaybook.conditions.
 */
export interface MetricCondition {
  /**
   * Metric name to match against AnomalyResult.metric
   */
  metric: string

  /**
   * Comparison operator:
   * - 'gt', 'lt', 'gte', 'lte': numeric comparison with threshold
   * - 'z_score_gt': compare absolute value of zScore
   * - 'rule': match AnomalyResult.rule type
   */
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'z_score_gt' | 'rule'

  /**
   * Numeric threshold for gt/lt/gte/lte/z_score_gt operators
   */
  threshold?: number

  /**
   * Anomaly rule to match for op: 'rule'
   */
  rule?: AnomalyRule
}

/**
 * AbstractRemediationAction - Role-based action that resolves to actual components.
 *
 * Extends RemediationAction with optional targetRole field.
 * When targetRole is set, action-executor resolves it via ChainPlugin.roleMap.
 */
export interface AbstractRemediationAction extends RemediationAction {
  /**
   * Role-based target reference.
   * If set, action-executor resolves this to actual component name via roleMap.
   * Takes precedence over `target` field if both are set.
   */
  targetRole?: ComponentRole
}

/**
 * AbstractPlaybook - Chain-agnostic remediation playbook.
 *
 * Uses semantic roles and metric conditions instead of hard-coded component names.
 * Filters by nodeLayer and requiredRoles; matches via conditions.
 *
 * Does not replace existing Playbook type (which remains for chain-specific variants).
 * Three-layer matcher resolution:
 *   Layer 1: Redis dynamic playbooks (proposal-32 generated)
 *   Layer 2: Chain-specific Playbook variants (existing)
 *   Layer 3: Core AbstractPlaybook set (hardcoded, chain-neutral)
 */
export interface AbstractPlaybook {
  /**
   * Unique identifier for this playbook
   */
  id: string

  /**
   * Human-readable name
   */
  name: string

  /**
   * Description of the problem this playbook solves
   */
  description: string

  /**
   * Origin of this playbook
   * - 'hardcoded': static core playbook
   * - 'pattern': discovered by PatternMiner (proposal-32)
   * - 'ai-assisted': generated with AI assistance (proposal-32)
   */
  source: 'hardcoded' | 'pattern' | 'ai-assisted'

  // ---- Chain & Layer Filtering (optional) ----

  /**
   * If set, only match this playbook on specified node layers.
   * Undefined = match on any layer (l1, l2, or both).
   */
  applicableNodeLayers?: Array<'l1' | 'l2' | 'both'>

  /**
   * If set, only match on chains that have all these roles in their roleMap.
   * Allows playbooks to declare dependencies on specific infrastructure roles.
   */
  requiredRoles?: ComponentRole[]

  // ---- Matching Conditions (AND logic) ----

  /**
   * All conditions must be satisfied (AND) for playbook to match.
   * Empty conditions array will never match (prevents catch-all playbooks).
   */
  conditions: MetricCondition[]

  // ---- Execution ----

  /**
   * Primary actions to execute when playbook matches
   */
  actions: AbstractRemediationAction[]

  /**
   * Fallback actions if primary actions fail
   */
  fallback?: AbstractRemediationAction[]

  /**
   * Maximum retry attempts for this playbook's actions
   */
  maxAttempts: number

  // ---- proposal-32 Learning Fields (populated in Phase 4) ----

  /**
   * Confidence score (0-1) for this playbook's effectiveness
   * Populated by PlaybookEvolver after performance analysis
   */
  confidence?: number

  /**
   * Review and approval status (for proposal-32 generated playbooks)
   * - 'draft': initial generation, basic safety checks only
   * - 'pending': awaiting operator review
   * - 'approved': operator approved, can be executed
   * - 'archived': deprecated or superseded
   * - 'suspended': temporary hold for investigation
   */
  reviewStatus?: 'draft' | 'pending' | 'approved' | 'archived' | 'suspended'

  /**
   * Execution performance metrics
   * Populated by scheduler after collecting outcomes
   */
  performance?: {
    /**
     * Total number of times this playbook was applied
     */
    totalApplications: number

    /**
     * Percentage of successful applications (0-1)
     */
    successRate: number

    /**
     * Average time from trigger to resolution in milliseconds
     */
    avgResolutionMs: number

    /**
     * ISO timestamp of last application
     */
    lastApplied?: string

    /**
     * Outcome of last application
     */
    lastOutcome?: 'success' | 'failure' | 'partial'
  }
}
