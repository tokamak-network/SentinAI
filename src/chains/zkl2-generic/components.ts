import type {
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

function readServiceEnv(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const ZKL2_GENERIC_COMPONENTS = [
  'zk-sequencer',
  'zk-batcher',
  'zk-prover',
] as const;

export const META_COMPONENTS = ['l1', 'system'] as const;

export const DEPENDENCY_GRAPH: Record<string, ComponentDependency> = {
  'zk-sequencer': {
    dependsOn: ['l1'],
    feeds: ['zk-batcher', 'zk-prover'],
  },
  'zk-batcher': {
    dependsOn: ['zk-sequencer', 'l1'],
    feeds: [],
  },
  'zk-prover': {
    dependsOn: ['zk-sequencer'],
    feeds: [],
  },
  l1: {
    dependsOn: [],
    feeds: ['zk-sequencer', 'zk-batcher'],
  },
  system: {
    dependsOn: [],
    feeds: ['zk-sequencer', 'zk-batcher', 'zk-prover'],
  },
};

export const COMPONENT_ALIASES: Record<string, string> = {
  'zk-sequencer': 'zk-sequencer',
  sequencer: 'zk-sequencer',
  server: 'zk-sequencer',
  'zk-rpc': 'zk-sequencer',
  rpc: 'zk-sequencer',
  'zk-batcher': 'zk-batcher',
  batcher: 'zk-batcher',
  'zk-prover': 'zk-prover',
  prover: 'zk-prover',
  l1: 'l1',
  system: 'system',
};

export const K8S_COMPONENTS: K8sComponentConfig[] = [
  {
    component: 'zk-sequencer',
    dockerServiceName: readServiceEnv('ZKL2_EXECUTION_SERVICE', 'zkl2-sequencer'),
    labelSuffix: 'sequencer',
    statefulSetSuffix: 'zk-sequencer',
    l1RpcEnvVar: 'L1_RPC_URL',
    isPrimaryExecution: true,
  },
  {
    component: 'zk-batcher',
    dockerServiceName: readServiceEnv('ZKL2_BATCHER_SERVICE', 'zkl2-batcher'),
    labelSuffix: 'batcher',
    statefulSetSuffix: 'zk-batcher',
    l1RpcEnvVar: 'L1_RPC_URL',
    isPrimaryExecution: false,
  },
  {
    component: 'zk-prover',
    dockerServiceName: readServiceEnv('ZKL2_PROVER_SERVICE', 'zkl2-prover'),
    labelSuffix: 'prover',
    statefulSetSuffix: 'zk-prover',
    isPrimaryExecution: false,
  },
];

export const EOA_CONFIGS: EOAConfig[] = [
  {
    role: 'sequencer',
    addressEnvVar: 'SEQUENCER_EOA_ADDRESS',
    displayName: 'Sequencer',
  },
  {
    role: 'batcher',
    addressEnvVar: 'BATCHER_EOA_ADDRESS',
    displayName: 'Batcher',
  },
];

export const BALANCE_METRICS = [
  'sequencerBalance',
  'batcherBalance',
];
