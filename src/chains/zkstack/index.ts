import type { Chain } from 'viem';
import type { Playbook } from '@/types/remediation';
import type {
  ChainPlugin,
  ChainComponent,
  ChainEOARole,
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
  ChainAIPrompts,
} from '../types';
import {
  ZKSTACK_COMPONENTS,
  META_COMPONENTS,
  DEPENDENCY_GRAPH,
  COMPONENT_ALIASES,
  K8S_COMPONENTS,
  EOA_CONFIGS,
  BALANCE_METRICS,
} from './components';
import { ZKSTACK_AI_PROMPTS } from './prompts';
import { ZKSTACK_PLAYBOOKS } from './playbooks';
import { getZkstackL1Chain, zkstackLocalChain } from './chain';

function getMode(): 'legacy-era' | 'os-preview' {
  const mode = process.env.ZKSTACK_MODE?.trim().toLowerCase();
  return mode === 'os-preview' ? 'os-preview' : 'legacy-era';
}

function getDisplayName(): string {
  const base = process.env.L2_CHAIN_NAME || 'ZK Stack L2';
  return `${base} (${getMode()})`;
}

export class ZkstackPlugin implements ChainPlugin {
  readonly chainType = 'zkstack';
  readonly displayName = getDisplayName();
  readonly chainMode = getMode();
  readonly capabilities = {
    l1Failover: true,
    eoaBalanceMonitoring: true,
    disputeGameMonitoring: false,
    proofMonitoring: true,
    settlementMonitoring: true,
  } as const;

  readonly components: ChainComponent[] = [...ZKSTACK_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = COMPONENT_ALIASES;

  readonly k8sComponents: K8sComponentConfig[] = K8S_COMPONENTS;
  readonly primaryExecutionClient: ChainComponent = 'zksync-server';

  readonly eoaRoles: ChainEOARole[] = EOA_CONFIGS.map(c => c.role);
  readonly eoaConfigs: EOAConfig[] = EOA_CONFIGS;
  readonly balanceMetrics: string[] = BALANCE_METRICS;

  readonly expectedBlockIntervalSeconds = 1.0;

  readonly l1Chain: Chain = getZkstackL1Chain();
  readonly l2Chain: Chain = zkstackLocalChain;

  readonly aiPrompts: ChainAIPrompts = ZKSTACK_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    if (metric.includes('cpu') || metric.includes('memory') || metric.includes('txPool')) {
      return 'zksync-server';
    }
    if (metric.includes('proof') || metric.includes('verify')) {
      return 'zk-prover';
    }
    if (metric.includes('settlement') || metric.includes('batch')) {
      return 'zk-batcher';
    }
    if (metric.includes('sequencer')) {
      return 'zksync-server';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] || 'system';
  }

  getPlaybooks(): Playbook[] {
    return ZKSTACK_PLAYBOOKS;
  }
}
