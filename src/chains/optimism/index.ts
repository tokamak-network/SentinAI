/**
 * Optimism Chain Plugin
 * Plugin for OP Stack chains deployed from Optimism's official tutorial.
 */

import { mainnet, sepolia } from 'viem/chains';
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
  OP_COMPONENTS,
  META_COMPONENTS,
  DEPENDENCY_GRAPH,
  COMPONENT_ALIASES,
  K8S_COMPONENTS,
  EOA_CONFIGS,
  BALANCE_METRICS,
} from '../thanos/components';
import { THANOS_AI_PROMPTS } from '../thanos/prompts';
import { THANOS_PLAYBOOKS } from '../thanos/playbooks';
import { optimismTutorialChain } from './chain';

function getL1Chain(): Chain {
  const configured = process.env.L1_CHAIN?.trim().toLowerCase();
  return configured === 'mainnet' ? mainnet : sepolia;
}

function getDisplayName(): string {
  return process.env.L2_CHAIN_NAME || process.env.NEXT_PUBLIC_NETWORK_NAME || 'Optimism Tutorial L2';
}

export class OptimismPlugin implements ChainPlugin {
  readonly chainType = 'optimism';
  readonly displayName = getDisplayName();

  // Component Topology (standard OP Stack)
  readonly components: ChainComponent[] = [...OP_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = COMPONENT_ALIASES;

  // K8s
  readonly k8sComponents: K8sComponentConfig[] = K8S_COMPONENTS;
  readonly primaryExecutionClient: ChainComponent = 'op-geth';

  // EOA & Balance
  readonly eoaRoles: ChainEOARole[] = EOA_CONFIGS.map(c => c.role);
  readonly eoaConfigs: EOAConfig[] = EOA_CONFIGS;
  readonly balanceMetrics: string[] = BALANCE_METRICS;

  // Block Production
  readonly expectedBlockIntervalSeconds = 2.0;

  // viem Chain
  readonly l1Chain: Chain = getL1Chain();
  readonly l2Chain: Chain = optimismTutorialChain;

  // AI Prompts and Playbooks reuse OP Stack defaults
  readonly aiPrompts: ChainAIPrompts = THANOS_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    if (metric.includes('cpu') || metric.includes('memory')) {
      return 'op-geth';
    }
    if (metric.includes('txPool') || metric.includes('gas')) {
      return 'op-geth';
    }
    if (metric.includes('block') || metric.includes('Block')) {
      return 'op-node';
    }
    if (metric.includes('batcher') || metric === 'batcherBalance') {
      return 'op-batcher';
    }
    if (metric.includes('proposer') || metric === 'proposerBalance') {
      return 'op-proposer';
    }
    if (metric.includes('challenger') || metric === 'challengerBalance') {
      return 'op-challenger';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] || 'system';
  }

  getPlaybooks(): Playbook[] {
    return THANOS_PLAYBOOKS;
  }
}
