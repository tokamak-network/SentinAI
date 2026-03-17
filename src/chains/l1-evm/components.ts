/**
 * L1 EVM Node Plugin — Component Topology
 */

import type {
  ChainComponent,
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

/** The only real monitored component in L1-only mode */
export const L1_COMPONENTS: ChainComponent[] = ['l1-execution'];
/** Shared meta-components */
export const L1_META_COMPONENTS: ChainComponent[] = ['system'];

/**
 * Dependency graph for RCA.
 * l1-execution depends on the underlying system (disk, CPU, network).
 * No downstream L2 consumers.
 */
export const L1_DEPENDENCY_GRAPH: Record<ChainComponent, ComponentDependency> = {
  'l1-execution': {
    dependsOn: ['system'],
    feeds: [],
  },
  system: {
    dependsOn: [],
    feeds: ['l1-execution'],
  },
};

/** Alias map for component name normalization */
export const L1_COMPONENT_ALIASES: Record<string, ChainComponent> = {
  geth: 'l1-execution',
  reth: 'l1-execution',
  nethermind: 'l1-execution',
  besu: 'l1-execution',
  erigon: 'l1-execution',
  'l1-node': 'l1-execution',
  node: 'l1-execution',
  l1: 'l1',
  system: 'system',
};

/**
 * K8s component config.
 * K8S_L1_APP_LABEL env var controls the label selector (default: 'geth').
 */
export function getL1K8sComponents(): K8sComponentConfig[] {
  const label = process.env.K8S_L1_APP_LABEL ?? 'geth';
  return [
    {
      component: 'l1-execution',
      labelSuffix: label,
      statefulSetSuffix: label,
      isPrimaryExecution: true,
    },
  ];
}

/** No EOA roles for L1-only mode */
export const L1_EOA_CONFIGS: EOAConfig[] = [];
export const L1_BALANCE_METRICS: string[] = [];
