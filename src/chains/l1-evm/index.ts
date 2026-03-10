/**
 * L1 EVM Node Plugin
 * Monitors any standalone EVM-compatible L1 execution client.
 * CHAIN_TYPE=l1-evm
 */

import type { Chain } from 'viem';
import { mainnet } from 'viem/chains';
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
  L1_COMPONENTS,
  L1_META_COMPONENTS,
  L1_DEPENDENCY_GRAPH,
  L1_COMPONENT_ALIASES,
  getL1K8sComponents,
  L1_EOA_CONFIGS,
  L1_BALANCE_METRICS,
} from './components';
import { L1_EVM_AI_PROMPTS } from './prompts';
import { L1_EVM_PLAYBOOKS } from './playbooks';
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

export class L1EVMPlugin implements ChainPlugin {
  readonly chainType = 'l1-evm';
  readonly displayName = 'L1 EVM Node';
  readonly chainMode = 'generic' as const;
  readonly nodeLayer = 'l1' as const;
  readonly capabilities = {
    l1Failover: false,
    eoaBalanceMonitoring: false,
    disputeGameMonitoring: false,
    proofMonitoring: false,
    settlementMonitoring: false,
    autonomousIntents: getDefaultAutonomousIntents('l1-evm'),
    autonomousActions: getDefaultAutonomousActions('l1-evm'),
  } as const;

  readonly components: ChainComponent[] = [...L1_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...L1_META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = L1_DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = L1_COMPONENT_ALIASES;

  readonly k8sComponents: K8sComponentConfig[] = getL1K8sComponents();
  readonly primaryExecutionClient: ChainComponent = 'l1-execution';

  readonly eoaRoles: ChainEOARole[] = [];
  readonly eoaConfigs: EOAConfig[] = L1_EOA_CONFIGS;
  readonly balanceMetrics: string[] = L1_BALANCE_METRICS;

  readonly expectedBlockIntervalSeconds = 12.0;

  readonly l1Chain: Chain = mainnet;
  readonly l2Chain: Chain | undefined = undefined;

  readonly aiPrompts: ChainAIPrompts = L1_EVM_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    if (
      metric.includes('cpu') ||
      metric.includes('memory') ||
      metric.includes('block') ||
      metric.includes('Block') ||
      metric.includes('txPool') ||
      metric.includes('gas') ||
      metric.includes('peer') ||
      metric.includes('sync')
    ) {
      return 'l1-execution';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] ?? 'l1-execution';
  }

  getPlaybooks(): Playbook[] {
    return L1_EVM_PLAYBOOKS;
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
