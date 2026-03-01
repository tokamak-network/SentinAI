import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildChainOptionalSections } from '@/app/api/metrics/payload';
import { fetchZkstackMetricFields } from '@/app/api/metrics/zkstack';
import type { ChainPlugin } from '@/chains/types';

function makePlugin(chainType: string, proofMonitoring: boolean, settlementMonitoring: boolean): ChainPlugin {
  return {
    chainType,
    displayName: chainType,
    chainMode: chainType === 'zkstack' ? 'legacy-era' : 'generic',
    capabilities: {
      l1Failover: true,
      eoaBalanceMonitoring: true,
      disputeGameMonitoring: false,
      proofMonitoring,
      settlementMonitoring,
      autonomousIntents: [],
      autonomousActions: [],
    },
    components: [],
    metaComponents: [],
    dependencyGraph: {},
    componentAliases: {},
    k8sComponents: [],
    primaryExecutionClient: 'zksync-server',
    eoaRoles: [],
    eoaConfigs: [],
    balanceMetrics: [],
    expectedBlockIntervalSeconds: 1,
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
    verifyActionOutcome: () => ({ stepId: 's', action: 'inspect_anomalies', passed: true, checks: [], summary: 'ok', verifiedAt: new Date().toISOString() }),
    buildRollback: () => [],
  };
}

describe('metrics route isolation contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not expose settlement/proof sections for non-zk plugins when capabilities are off', () => {
    const plugin = makePlugin('optimism', false, false);
    const sections = buildChainOptionalSections({
      plugin,
      syncLag: 10,
      settlementStatus: {
        enabled: true,
        layer: 'l1',
        finalityMode: 'finalized',
        postingLagSec: 4,
        healthy: true,
      },
    });

    expect(sections.proof).toBeUndefined();
    expect(sections.settlement).toBeUndefined();
  });

  it('does not expose zks_* derived metrics outside zkstack chain type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: '0x1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchZkstackMetricFields('optimism', 'http://localhost:8545', 1000);

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
