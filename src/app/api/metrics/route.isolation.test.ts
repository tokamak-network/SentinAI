import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildChainOptionalSections } from '@/app/api/metrics/payload';
import { fetchZkstackMetricFields } from '@/app/api/metrics/zkstack';
import { resolveClientProfile, parseTxPoolPendingCount } from '@/lib/client-profile';
import type { ChainPlugin } from '@/chains/types';

function makePlugin(chainType: string, proofMonitoring: boolean, settlementMonitoring: boolean): ChainPlugin {
  return {
    chainType,
    displayName: chainType,
    chainMode: chainType === 'zkstack' ? 'legacy-era' : 'generic',
    nodeLayer: 'l2',
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

describe('metrics route: ClientProfile-based txpool (unit)', () => {
  afterEach(() => {
    delete process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER;
    delete process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD;
    delete process.env.SENTINAI_CLIENT_FAMILY;
  });

  it('uses parity parser when SENTINAI_OVERRIDE_TXPOOL_PARSER=parity', () => {
    process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'parity_pendingTransactions';
    process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER = 'parity';

    const profile = resolveClientProfile();

    // profile should reflect parity parser
    expect(profile.parsers.txPool).toBe('parity');
    expect(profile.methods.txPool?.method).toBe('parity_pendingTransactions');

    // parseTxPoolPendingCount with parity parser on an array of 3 items
    const count = parseTxPoolPendingCount([{}, {}, {}], 'parity', undefined);
    expect(count).toBe(3);
  });

  it('falls back to 0 from parseTxPoolPendingCount when txPool parser is null', () => {
    // When clientProfile.methods.txPool is null the route falls back to block.transactions.length.
    // parseTxPoolPendingCount itself should return 0 for null parserType.
    const count = parseTxPoolPendingCount({ pending: '0x5', queued: '0x0' }, null, undefined);
    expect(count).toBe(0);
  });

  it('resolveClientProfile returns null txPool method for unknown family (no txPool configured)', () => {
    // An unknown family falls back to a custom empty profile which has txPool: null,
    // confirming that the null-txPool branch in the metrics route is reachable.
    process.env.SENTINAI_CLIENT_FAMILY = 'unknown-no-txpool-family';

    const profile = resolveClientProfile();
    expect(profile.methods.txPool).toBeNull();
  });
});
