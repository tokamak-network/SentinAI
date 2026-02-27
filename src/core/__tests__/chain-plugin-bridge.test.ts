/**
 * Unit Tests for ChainPlugin → ProtocolDescriptor Bridge
 * Tests descriptor construction and chainType → NodeType mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  bridgeChainPlugin,
  chainTypeToNodeType,
} from '@/core/compat/chain-plugin-bridge';
import type { ChainPlugin } from '@/chains/types';
import type { NodeType } from '@/core/types';

// ============================================================
// Minimal ChainPlugin Mock Factory
// ============================================================

function makePlugin(overrides?: {
  chainType?: string;
  displayName?: string;
  eoaBalanceMonitoring?: boolean;
}): ChainPlugin {
  return {
    chainType: overrides?.chainType ?? 'thanos',
    displayName: overrides?.displayName ?? 'Thanos L2',
    chainMode: 'standard',
    capabilities: {
      l1Failover: true,
      eoaBalanceMonitoring: overrides?.eoaBalanceMonitoring ?? false,
      disputeGameMonitoring: false,
      proofMonitoring: false,
      settlementMonitoring: false,
      autonomousIntents: [],
      autonomousActions: [],
    },
    components: [],
    metaComponents: [],
    dependencyGraph: {},
    componentAliases: {},
    k8sComponents: [],
    primaryExecutionClient: 'op-geth',
    eoaRoles: [],
    eoaConfigs: [],
    balanceMetrics: [],
    blockProductionIntervalSecs: 2,
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
    playbooks: [],
    getAutonomousPlan: async () => ({ steps: [], description: '' }),
    executeAutonomousStep: async () => ({ success: true }),
    verifyAutonomousOperation: async () => ({ passed: true, checks: [] }),
  } as unknown as ChainPlugin;
}

// ============================================================
// Tests
// ============================================================

describe('bridgeChainPlugin', () => {
  it('returns a descriptor with the provided protocolId', () => {
    const descriptor = bridgeChainPlugin(makePlugin(), 'opstack-l2');
    expect(descriptor.protocolId).toBe('opstack-l2');
  });

  it('descriptor.displayName matches plugin.displayName', () => {
    const plugin = makePlugin({ displayName: 'My Custom Chain' });
    const descriptor = bridgeChainPlugin(plugin, 'opstack-l2');
    expect(descriptor.displayName).toBe('My Custom Chain');
  });

  it('descriptor.capabilities includes eoa-balance-monitoring when eoaBalanceMonitoring=true', () => {
    const plugin = makePlugin({ eoaBalanceMonitoring: true });
    const descriptor = bridgeChainPlugin(plugin, 'opstack-l2');
    expect(descriptor.capabilities).toContain('eoa-balance-monitoring');
  });

  it('descriptor.capabilities excludes eoa-balance-monitoring when eoaBalanceMonitoring=false', () => {
    const plugin = makePlugin({ eoaBalanceMonitoring: false });
    const descriptor = bridgeChainPlugin(plugin, 'opstack-l2');
    expect(descriptor.capabilities).not.toContain('eoa-balance-monitoring');
  });

  it('descriptor.collectorType is "opstack-l2" for protocolId opstack-l2', () => {
    const descriptor = bridgeChainPlugin(makePlugin(), 'opstack-l2');
    expect(descriptor.collectorType).toBe('opstack-l2');
  });

  it('descriptor.collectorType is "evm-execution" for protocolId arbitrum-nitro', () => {
    const descriptor = bridgeChainPlugin(makePlugin({ chainType: 'arbitrum' }), 'arbitrum-nitro');
    expect(descriptor.collectorType).toBe('evm-execution');
  });

  it('descriptor.metricsFields is non-empty (OP Stack fields are provided)', () => {
    const descriptor = bridgeChainPlugin(makePlugin(), 'opstack-l2');
    expect(descriptor.metricsFields.length).toBeGreaterThan(0);
  });

  it('descriptor.anomalyConfig is non-empty', () => {
    const descriptor = bridgeChainPlugin(makePlugin(), 'opstack-l2');
    expect(Object.keys(descriptor.anomalyConfig).length).toBeGreaterThan(0);
  });

  it('descriptor.legacyChainType matches plugin.chainType', () => {
    const plugin = makePlugin({ chainType: 'thanos' });
    const descriptor = bridgeChainPlugin(plugin, 'opstack-l2');
    expect(descriptor.legacyChainType).toBe('thanos');
  });

  it('base capabilities always include block-production and peer-monitoring', () => {
    const descriptor = bridgeChainPlugin(makePlugin(), 'opstack-l2');
    expect(descriptor.capabilities).toContain('block-production');
    expect(descriptor.capabilities).toContain('peer-monitoring');
  });
});

// ============================================================
// chainTypeToNodeType
// ============================================================

describe('chainTypeToNodeType', () => {
  const cases: Array<[string, NodeType]> = [
    ['thanos',          'opstack-l2'],
    ['optimism',        'opstack-l2'],
    ['op-stack',        'opstack-l2'],
    ['arbitrum',        'arbitrum-nitro'],
    ['arbitrum-orbit',  'arbitrum-nitro'],
    ['nitro',           'arbitrum-nitro'],
    ['zkstack',         'zkstack'],
    ['zk-sync',         'zkstack'],
    ['zkSync',          'zkstack'],
    ['unknown-chain',   'opstack-l2'],  // fallback
  ];

  it.each(cases)('chainTypeToNodeType("%s") → "%s"', (chainType, expected) => {
    expect(chainTypeToNodeType(chainType)).toBe(expected);
  });
});
