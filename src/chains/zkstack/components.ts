import type {
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

function readServiceEnv(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const ZKSTACK_COMPONENTS = [
  'zksync-server',
  'zk-batcher',
  'zk-prover',
] as const;

export const META_COMPONENTS = ['l1', 'system'] as const;

export const DEPENDENCY_GRAPH: Record<string, ComponentDependency> = {
  'zksync-server': {
    dependsOn: ['l1'],
    feeds: ['zk-batcher', 'zk-prover'],
  },
  'zk-batcher': {
    dependsOn: ['zksync-server', 'l1'],
    feeds: [],
  },
  'zk-prover': {
    dependsOn: ['zksync-server'],
    feeds: [],
  },
  'l1': {
    dependsOn: [],
    feeds: ['zksync-server', 'zk-batcher'],
  },
  'system': {
    dependsOn: [],
    feeds: ['zksync-server', 'zk-batcher', 'zk-prover'],
  },
};

export const COMPONENT_ALIASES: Record<string, string> = {
  'zksync-server': 'zksync-server',
  'server': 'zksync-server',
  'sequencer': 'zksync-server',
  'zk-batcher': 'zk-batcher',
  'batcher': 'zk-batcher',
  'zk-prover': 'zk-prover',
  'prover': 'zk-prover',
  'l1': 'l1',
  'system': 'system',
};

export const K8S_COMPONENTS: K8sComponentConfig[] = [
  {
    component: 'zksync-server',
    dockerServiceName: readServiceEnv('ZKSTACK_EXECUTION_SERVICE', 'zkstack-core'),
    labelSuffix: 'server',
    statefulSetSuffix: 'zksync-server',
    l1RpcEnvVar: 'ETH_CLIENT_WEB3_URL',
    isPrimaryExecution: true,
  },
  {
    component: 'zk-batcher',
    // In server-v2 topology batcher pipeline can be part of core service.
    dockerServiceName: readServiceEnv('ZKSTACK_BATCHER_SERVICE', 'zkstack-core'),
    labelSuffix: 'batcher',
    statefulSetSuffix: 'zk-batcher',
    l1RpcEnvVar: 'ETH_CLIENT_WEB3_URL',
    isPrimaryExecution: false,
  },
  {
    component: 'zk-prover',
    dockerServiceName: readServiceEnv('ZKSTACK_PROVER_SERVICE', 'zkstack-core'),
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
  {
    role: 'fee-withdrawer',
    addressEnvVar: 'FEE_WITHDRAWER_EOA_ADDRESS',
    displayName: 'Fee Withdrawer',
  },
];

export const BALANCE_METRICS = [
  'sequencerBalance',
  'batcherBalance',
  'feeWithdrawerBalance',
];
