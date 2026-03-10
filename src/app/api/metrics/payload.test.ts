import { describe, expect, it } from 'vitest';
import { buildChainOptionalSections } from '@/app/api/metrics/payload';
import type { ChainPlugin } from '@/chains/types';

function makePlugin(overrides?: {
  proofMonitoring?: boolean;
  settlementMonitoring?: boolean;
}): ChainPlugin {
  return {
    chainType: 'zkl2-generic',
    displayName: 'ZK L2 Generic',
    chainMode: 'generic',
    nodeLayer: 'l2',
    capabilities: {
      l1Failover: true,
      eoaBalanceMonitoring: true,
      disputeGameMonitoring: false,
      proofMonitoring: overrides?.proofMonitoring ?? false,
      settlementMonitoring: overrides?.settlementMonitoring ?? false,
      autonomousIntents: [],
      autonomousActions: [],
    },
    components: [],
    metaComponents: [],
    dependencyGraph: {},
    componentAliases: {},
    k8sComponents: [],
    primaryExecutionClient: 'zk-sequencer',
    eoaRoles: [],
    eoaConfigs: [],
    balanceMetrics: [],
    expectedBlockIntervalSeconds: 2,
    l1Chain: {} as ChainPlugin['l1Chain'],
    l2Chain: {} as ChainPlugin['l2Chain'],
    aiPrompts: {
      rcaSystemPrompt: '',
      anomalyAnalyzerContext: '',
      predictiveScalerContext: '',
      costOptimizerContext: '',
      dailyReportContext: '',
      nlopsSystemContext: '',
      failurePatterns: '',
    },
    mapMetricToComponent: () => 'system',
    normalizeComponentName: () => 'system',
    getPlaybooks: () => [],
    getSupportedIntents: () => [],
    translateIntentToActions: () => [],
    verifyActionOutcome: () => ({
      stepId: 's1',
      action: 'inspect_anomalies',
      passed: true,
      checks: [],
      summary: 'ok',
      verifiedAt: new Date().toISOString(),
    }),
    buildRollback: () => [],
  };
}

describe('buildChainOptionalSections', () => {
  it('omits proof/settlement when capabilities are disabled', () => {
    const plugin = makePlugin({ proofMonitoring: false, settlementMonitoring: false });
    const sections = buildChainOptionalSections({ plugin, syncLag: 12, settlementStatus: null });

    expect(sections).not.toHaveProperty('proof');
    expect(sections).not.toHaveProperty('settlement');
  });

  it('includes proof section when proof monitoring is enabled', () => {
    const plugin = makePlugin({ proofMonitoring: true, settlementMonitoring: false });
    const sections = buildChainOptionalSections({ plugin, syncLag: 11, settlementStatus: null });

    expect(sections).toHaveProperty('proof');
    expect((sections.proof as { generationLagSec: number }).generationLagSec).toBe(11);
    expect((sections.proof as { verificationLagSec: number }).verificationLagSec).toBe(5);
  });

  it('includes settlement section only when capability is enabled and status exists', () => {
    const plugin = makePlugin({ proofMonitoring: false, settlementMonitoring: true });
    const sections = buildChainOptionalSections({
      plugin,
      syncLag: 0,
      settlementStatus: {
        enabled: true,
        layer: 'l1',
        finalityMode: 'finalized',
        postingLagSec: 3,
        healthy: true,
      },
    });

    expect(sections).toHaveProperty('settlement');
    expect((sections.settlement as { layer: string }).layer).toBe('l1');
    expect((sections.settlement as { postingLagSec: number }).postingLagSec).toBe(3);
  });

  it('does not include settlement section when capability is disabled even if status exists', () => {
    const plugin = makePlugin({ proofMonitoring: false, settlementMonitoring: false });
    const sections = buildChainOptionalSections({
      plugin,
      syncLag: 0,
      settlementStatus: {
        enabled: true,
        layer: 'l1',
        finalityMode: 'finalized',
        postingLagSec: 3,
        healthy: true,
      },
    });

    expect(sections).not.toHaveProperty('settlement');
  });
});
