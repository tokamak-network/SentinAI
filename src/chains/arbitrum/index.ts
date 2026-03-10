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
  ARBITRUM_COMPONENTS,
  META_COMPONENTS,
  DEPENDENCY_GRAPH,
  COMPONENT_ALIASES,
  K8S_COMPONENTS,
  EOA_CONFIGS,
  BALANCE_METRICS,
} from './components';
import { ARBITRUM_AI_PROMPTS } from './prompts';
import { ARBITRUM_PLAYBOOKS } from './playbooks';
import { getArbitrumL1Chain, arbitrumOrbitChain } from './chain';
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

export class ArbitrumPlugin implements ChainPlugin {
  readonly chainType = 'arbitrum';
  readonly displayName = process.env.L2_CHAIN_NAME || 'Arbitrum Orbit L2';
  readonly chainMode = 'standard' as const;
  readonly nodeLayer = 'l2' as const;
  readonly capabilities = {
    l1Failover: true,
    eoaBalanceMonitoring: true,
    disputeGameMonitoring: false,
    proofMonitoring: false,
    settlementMonitoring: false,
    autonomousIntents: getDefaultAutonomousIntents('arbitrum'),
    autonomousActions: getDefaultAutonomousActions('arbitrum'),
  } as const;

  readonly components: ChainComponent[] = [...ARBITRUM_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = COMPONENT_ALIASES;

  readonly k8sComponents: K8sComponentConfig[] = K8S_COMPONENTS;
  readonly primaryExecutionClient: ChainComponent = 'nitro-node';

  readonly eoaRoles: ChainEOARole[] = EOA_CONFIGS.map(c => c.role);
  readonly eoaConfigs: EOAConfig[] = EOA_CONFIGS;
  readonly balanceMetrics: string[] = BALANCE_METRICS;

  readonly expectedBlockIntervalSeconds = 0.25;

  readonly l1Chain: Chain = getArbitrumL1Chain();
  readonly l2Chain: Chain = arbitrumOrbitChain;

  readonly aiPrompts: ChainAIPrompts = ARBITRUM_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    if (metric.includes('cpu') || metric.includes('memory') || metric.includes('txPool')) {
      return 'nitro-node';
    }
    if (metric.includes('batch') || metric.includes('poster') || metric.includes('batchPoster')) {
      return 'batch-poster';
    }
    if (metric.includes('validator') || metric.includes('rblock') || metric.includes('assertion')) {
      return 'validator';
    }
    if (metric.includes('sequencer') || metric.includes('inbox')) {
      return 'nitro-node';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] || 'system';
  }

  getPlaybooks(): Playbook[] {
    return ARBITRUM_PLAYBOOKS;
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
