/**
 * Optimism Chain Plugin
 * Default chain plugin for SentinAI — Optimism L2 Rollup stack
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
} from './components';
import { OPTIMISM_AI_PROMPTS } from './prompts';
import { OPTIMISM_PLAYBOOKS } from './playbooks';

export class OptimismPlugin implements ChainPlugin {
  readonly chainType = 'optimism';
  readonly displayName = 'Optimism L2 Rollup';

  // Component Topology
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

  // viem Chain
  readonly l1Chain: Chain = sepolia;
  readonly l2Chain: Chain = mainnet;

  // AI Prompts
  readonly aiPrompts: ChainAIPrompts = OPTIMISM_AI_PROMPTS;

  /**
   * Map an anomaly metric to the responsible Optimism component.
   * Logic extracted from rca-engine.ts:208-215
   */
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
    return 'system';
  }

  /**
   * Normalize a component name using alias map.
   * Logic extracted from rca-engine.ts:158-161
   */
  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] || 'system';
  }

  /**
   * Get Optimism-specific remediation playbooks.
   */
  getPlaybooks(): Playbook[] {
    return OPTIMISM_PLAYBOOKS;
  }
}
