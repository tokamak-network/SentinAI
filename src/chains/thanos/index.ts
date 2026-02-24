/**
 * Thanos Chain Plugin
 * Default chain plugin for SentinAI — Thanos L2 Rollup stack (OP Stack)
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
import { THANOS_AI_PROMPTS } from './prompts';
import { THANOS_PLAYBOOKS } from './playbooks';
import {
  defaultBuildRollback,
  defaultTranslateIntentToActions,
  defaultVerifyActionOutcome,
  getDefaultAutonomousActions,
  getDefaultAutonomousIntents,
} from '../autonomous-defaults';
import type {
  AutonomousExecutionContext,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

export class ThanosPlugin implements ChainPlugin {
  readonly chainType = 'thanos';
  readonly displayName = 'Thanos L2 Rollup';
  readonly chainMode = 'standard' as const;
  readonly capabilities = {
    l1Failover: true,
    eoaBalanceMonitoring: true,
    disputeGameMonitoring: true,
    proofMonitoring: false,
    settlementMonitoring: true,
    autonomousIntents: getDefaultAutonomousIntents('thanos'),
    autonomousActions: getDefaultAutonomousActions('thanos'),
  } as const;

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

  // Block Production
  readonly expectedBlockIntervalSeconds = 2.0;

  // viem Chain
  readonly l1Chain: Chain = sepolia;
  readonly l2Chain: Chain = mainnet;

  // AI Prompts
  readonly aiPrompts: ChainAIPrompts = THANOS_AI_PROMPTS;

  /**
   * Map an anomaly metric to the responsible component.
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
    if (metric.includes('challenger') || metric === 'challengerBalance') {
      return 'op-challenger';
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
   * Get Thanos-specific remediation playbooks.
   */
  getPlaybooks(): Playbook[] {
    return THANOS_PLAYBOOKS;
  }

  getSupportedIntents(): AutonomousIntent[] {
    return [...this.capabilities.autonomousIntents];
  }

  translateIntentToActions(
    intent: AutonomousIntent,
    context: AutonomousExecutionContext
  ): AutonomousPlanStep[] {
    return defaultTranslateIntentToActions(this.chainType, intent, context);
  }

  verifyActionOutcome(
    step: AutonomousPlanStep,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): AutonomousVerificationResult {
    return defaultVerifyActionOutcome(this.chainType, step, before, after);
  }

  buildRollback(step: AutonomousPlanStep): AutonomousPlanStep[] {
    return defaultBuildRollback(this.chainType, step);
  }
}
