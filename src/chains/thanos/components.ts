/**
 * Optimism Chain - Component Topology & Configuration
 * Extracted from existing codebase (rca-engine.ts, l1-rpc-failover.ts, eoa-balance-monitor.ts)
 */

import type {
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

// ============================================================
// Component Names
// ============================================================

export const OP_COMPONENTS = ['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'op-challenger'] as const;
export type OptimismComponent = (typeof OP_COMPONENTS)[number];

export const META_COMPONENTS = ['l1', 'system'] as const;

// ============================================================
// Dependency Graph (from rca-engine.ts:30-55)
// ============================================================

export const DEPENDENCY_GRAPH: Record<string, ComponentDependency> = {
  'op-geth': {
    dependsOn: ['op-node'],
    feeds: [],
  },
  'op-node': {
    dependsOn: ['l1'],
    feeds: ['op-geth', 'op-batcher', 'op-proposer', 'op-challenger'],
  },
  'op-batcher': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-proposer': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-challenger': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'l1': {
    dependsOn: [],
    feeds: ['op-node', 'op-batcher', 'op-proposer', 'op-challenger'],
  },
  'system': {
    dependsOn: [],
    feeds: ['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'op-challenger'],
  },
};

// ============================================================
// Component Name Aliases (from rca-engine.ts:71-80)
// ============================================================

export const COMPONENT_ALIASES: Record<string, string> = {
  'op-geth': 'op-geth',
  'geth': 'op-geth',
  'op-node': 'op-node',
  'node': 'op-node',
  'op-batcher': 'op-batcher',
  'batcher': 'op-batcher',
  'op-proposer': 'op-proposer',
  'proposer': 'op-proposer',
  'op-challenger': 'op-challenger',
  'challenger': 'op-challenger',
  'l1': 'l1',
  'system': 'system',
};

// ============================================================
// K8s Component Configurations (from l1-rpc-failover.ts:214-223)
// ============================================================

export const K8S_COMPONENTS: K8sComponentConfig[] = [
  {
    component: 'op-geth',
    labelSuffix: 'geth',
    statefulSetSuffix: 'op-geth',
    isPrimaryExecution: true,
  },
  {
    component: 'op-node',
    labelSuffix: 'node',
    statefulSetSuffix: 'op-node',
    l1RpcEnvVar: 'OP_NODE_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
  {
    component: 'op-batcher',
    labelSuffix: 'batcher',
    statefulSetSuffix: 'op-batcher',
    l1RpcEnvVar: 'OP_BATCHER_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
  {
    component: 'op-proposer',
    labelSuffix: 'proposer',
    statefulSetSuffix: 'op-proposer',
    l1RpcEnvVar: 'OP_PROPOSER_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
  {
    component: 'op-challenger',
    labelSuffix: 'challenger',
    statefulSetSuffix: 'op-challenger',
    l1RpcEnvVar: 'OP_CHALLENGER_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
];

// ============================================================
// EOA Configurations (from eoa-balance-monitor.ts:99-107)
// ============================================================

export const EOA_CONFIGS: EOAConfig[] = [
  {
    role: 'batcher',
    addressEnvVar: 'BATCHER_EOA_ADDRESS',
    displayName: 'Batcher',
  },
  {
    role: 'proposer',
    addressEnvVar: 'PROPOSER_EOA_ADDRESS',
    displayName: 'Proposer',
  },
  {
    role: 'challenger',
    addressEnvVar: 'CHALLENGER_EOA_ADDRESS',
    displayName: 'Challenger',
  },
];

/** Balance metrics for anomaly detection */
export const BALANCE_METRICS = ['batcherBalance', 'proposerBalance', 'challengerBalance'];
