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

function getMode(): 'legacy-era' | 'os-preview' {
  const mode = process.env.ZKSTACK_MODE?.trim().toLowerCase();
  return mode === 'os-preview' ? 'os-preview' : 'legacy-era';
}

function getDisplayName(): string {
  const base = process.env.L2_CHAIN_NAME || 'ZK Stack L2';
  return `${base} (${getMode()})`;
}

function hasProofProbe(): boolean {
  return Boolean(process.env.ZK_PROOF_RPC_URL);
}

function hasSettlementProbe(): boolean {
  return Boolean(process.env.ZK_BATCHER_STATUS_URL);
}

function getComponentProfile(): 'core-only' | 'full' {
  const profile = process.env.ZKSTACK_COMPONENT_PROFILE?.trim().toLowerCase();
  if (profile === 'full') return 'full';
  if (profile === 'core-only') return 'core-only';
  return process.env.ORCHESTRATOR_TYPE === 'docker' ? 'core-only' : 'full';
}

function getK8sComponents(): K8sComponentConfig[] {
  if (getComponentProfile() === 'core-only') {
    return K8S_COMPONENTS.filter((component) => component.component === 'zksync-server');
  }
  return K8S_COMPONENTS;
}

export class ZkstackPlugin implements ChainPlugin {
  readonly chainType = 'zkstack';
  readonly displayName = getDisplayName();
  readonly chainMode = getMode();
  readonly nodeLayer = 'l2' as const;
  readonly capabilities = {
    l1Failover: true,
    eoaBalanceMonitoring: true,
    disputeGameMonitoring: false,
    // Hide proof/settlement cards unless dedicated probes are configured.
    proofMonitoring: hasProofProbe(),
    settlementMonitoring: hasSettlementProbe(),
    autonomousIntents: getDefaultAutonomousIntents('zkstack'),
    autonomousActions: getDefaultAutonomousActions('zkstack'),
  } as const;

  readonly components: ChainComponent[] = [...ZKSTACK_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = COMPONENT_ALIASES;

  readonly k8sComponents: K8sComponentConfig[] = getK8sComponents();
  readonly primaryExecutionClient: ChainComponent = 'zksync-server';

  readonly eoaRoles: ChainEOARole[] = EOA_CONFIGS.map(c => c.role);
  readonly eoaConfigs: EOAConfig[] = EOA_CONFIGS;
  readonly balanceMetrics: string[] = BALANCE_METRICS;

  readonly expectedBlockIntervalSeconds = 1.0;

  readonly l1Chain: Chain = getZkstackL1Chain();
  readonly l2Chain: Chain = zkstackLocalChain;

  // Abstract Playbook Role Mapping
  readonly roleMap: Partial<Record<ComponentRole, string>> = {
    'block-producer': 'zksync-server',
    'sync-node': 'zksync-server',
    'tx-submitter': 'zk-batcher',
    'proof-generator': 'zk-prover',
    'l1-execution-client': 'l1',
    'rpc-gateway': 'system',
  };

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
