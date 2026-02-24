import type {
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

function readServiceEnv(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const ARBITRUM_COMPONENTS = [
  'nitro-node',
  'batch-poster',
  'validator',
] as const;

export const META_COMPONENTS = ['l1', 'system'] as const;

export const DEPENDENCY_GRAPH: Record<string, ComponentDependency> = {
  'nitro-node': {
    dependsOn: ['l1'],
    feeds: ['batch-poster', 'validator'],
  },
  'batch-poster': {
    dependsOn: ['nitro-node', 'l1'],
    feeds: [],
  },
  'validator': {
    dependsOn: ['nitro-node', 'l1'],
    feeds: [],
  },
  'l1': {
    dependsOn: [],
    feeds: ['nitro-node', 'batch-poster', 'validator'],
  },
  'system': {
    dependsOn: [],
    feeds: ['nitro-node', 'batch-poster', 'validator'],
  },
};

export const COMPONENT_ALIASES: Record<string, string> = {
  'nitro-node': 'nitro-node',
  'nitro': 'nitro-node',
  'sequencer': 'nitro-node',
  'execution': 'nitro-node',
  'batch-poster': 'batch-poster',
  'batcher': 'batch-poster',
  'poster': 'batch-poster',
  'validator': 'validator',
  'staker': 'validator',
  'l1': 'l1',
  'system': 'system',
};

export const K8S_COMPONENTS: K8sComponentConfig[] = [
  {
    component: 'nitro-node',
    dockerServiceName: readServiceEnv('ARB_NODE_SERVICE', 'nitro-node'),
    labelSuffix: 'nitro',
    statefulSetSuffix: 'nitro-node',
    l1RpcEnvVar: 'ARB_NODE_L1_ETH_RPC',
    isPrimaryExecution: true,
  },
  {
    component: 'batch-poster',
    dockerServiceName: readServiceEnv('ARB_BATCHPOSTER_SERVICE', 'batch-poster'),
    labelSuffix: 'batchposter',
    statefulSetSuffix: 'batch-poster',
    l1RpcEnvVar: 'ARB_BATCHPOSTER_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
  {
    component: 'validator',
    dockerServiceName: readServiceEnv('ARB_VALIDATOR_SERVICE', 'validator'),
    labelSuffix: 'validator',
    statefulSetSuffix: 'validator',
    l1RpcEnvVar: 'ARB_VALIDATOR_L1_ETH_RPC',
    isPrimaryExecution: false,
  },
];

export const EOA_CONFIGS: EOAConfig[] = [
  {
    role: 'batcher',
    addressEnvVar: 'BATCH_POSTER_EOA_ADDRESS',
    displayName: 'Batch Poster',
  },
  {
    role: 'validator',
    addressEnvVar: 'VALIDATOR_EOA_ADDRESS',
    displayName: 'Validator',
  },
];

export const BALANCE_METRICS = [
  'batchPosterBalance',
  'validatorBalance',
];
