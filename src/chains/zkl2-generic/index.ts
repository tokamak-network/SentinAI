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
  ZKL2_GENERIC_COMPONENTS,
  META_COMPONENTS,
  DEPENDENCY_GRAPH,
  COMPONENT_ALIASES,
  K8S_COMPONENTS,
  EOA_CONFIGS,
  BALANCE_METRICS,
} from './components';
import { ZKL2_GENERIC_AI_PROMPTS } from './prompts';
import { ZKL2_GENERIC_PLAYBOOKS } from './playbooks';
import { getZkL2GenericL1Chain, zkL2GenericChain } from './chain';
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
import type { ComponentRole } from '@/playbooks/types';

function resolveNetworkLabel(): string {
  const chainType = process.env.CHAIN_TYPE?.trim().toLowerCase();
  if (chainType === 'scroll') return 'Scroll';
  if (chainType === 'linea') return 'Linea';
  if (chainType === 'polygon-zkevm' || chainType === 'zkevm') return 'Polygon zkEVM';
  return 'Generic ZK L2';
}

function hasProofProbe(): boolean {
  return Boolean(process.env.ZK_PROOF_RPC_URL);
}

function hasSettlementProbe(): boolean {
  return Boolean(process.env.ZK_BATCHER_STATUS_URL || process.env.ZK_SETTLEMENT_RPC_URL);
}

export class ZkL2GenericPlugin implements ChainPlugin {
  readonly chainType = 'zkl2-generic';
  readonly displayName = process.env.L2_CHAIN_NAME || `${resolveNetworkLabel()} Plugin`;
  readonly chainMode = 'generic' as const;
  readonly nodeLayer = 'l2' as const;
  readonly capabilities = {
    l1Failover: true,
    eoaBalanceMonitoring: true,
    disputeGameMonitoring: false,
    proofMonitoring: hasProofProbe(),
    settlementMonitoring: hasSettlementProbe(),
    autonomousIntents: getDefaultAutonomousIntents('zkl2-generic'),
    autonomousActions: getDefaultAutonomousActions('zkl2-generic'),
  } as const;

  readonly components: ChainComponent[] = [...ZKL2_GENERIC_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = COMPONENT_ALIASES;

  readonly k8sComponents: K8sComponentConfig[] = K8S_COMPONENTS;
  readonly primaryExecutionClient: ChainComponent = 'zk-sequencer';

  readonly eoaRoles: ChainEOARole[] = EOA_CONFIGS.map(c => c.role);
  readonly eoaConfigs: EOAConfig[] = EOA_CONFIGS;
  readonly balanceMetrics: string[] = BALANCE_METRICS;

  readonly expectedBlockIntervalSeconds = 2.0;

  readonly l1Chain: Chain = getZkL2GenericL1Chain();
  readonly l2Chain: Chain = zkL2GenericChain;

  // Abstract Playbook Role Mapping
  readonly roleMap: Partial<Record<ComponentRole, string>> = {
    'block-producer': 'zk-sequencer',
    'sync-node': 'zk-sequencer',
    'tx-submitter': 'zk-batcher',
    'proof-generator': 'zk-prover',
    'l1-execution-client': 'l1',
    'rpc-gateway': 'system',
  };

  readonly aiPrompts: ChainAIPrompts = ZKL2_GENERIC_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    if (metric.includes('cpu') || metric.includes('memory') || metric.includes('txPool')) {
      return 'zk-sequencer';
    }
    if (metric.includes('proof') || metric.includes('verify')) {
      return 'zk-prover';
    }
    if (metric.includes('settlement') || metric.includes('batch')) {
      return 'zk-batcher';
    }
    if (metric.includes('sequencer') || metric.includes('rpc')) {
      return 'zk-sequencer';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] || 'system';
  }

  getPlaybooks(): Playbook[] {
    return ZKL2_GENERIC_PLAYBOOKS;
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
