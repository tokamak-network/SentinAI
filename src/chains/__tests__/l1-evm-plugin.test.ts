import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetChainRegistry, getChainPlugin } from '@/chains/registry';

vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  sepolia: { id: 11155111, name: 'Sepolia' },
  optimismSepolia: { id: 11155420, name: 'OP Sepolia' },
}));

describe('L1EVMPlugin', () => {
  beforeEach(() => {
    resetChainRegistry();
    process.env.CHAIN_TYPE = 'l1-evm';
  });

  afterEach(() => {
    delete process.env.CHAIN_TYPE;
    resetChainRegistry();
  });

  it('loads via CHAIN_TYPE=l1-evm', () => {
    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('l1-evm');
    expect(plugin.nodeLayer).toBe('l1');
  });

  it('has l1-execution as primary component', () => {
    const plugin = getChainPlugin();
    expect(plugin.primaryExecutionClient).toBe('l1-execution');
    expect(plugin.components).toContain('l1-execution');
  });

  it('has no L2 components', () => {
    const plugin = getChainPlugin();
    const l2Components = plugin.components.filter(c =>
      ['op-geth', 'op-node', 'op-batcher', 'nitro-node', 'zksync-server'].includes(c)
    );
    expect(l2Components).toHaveLength(0);
  });

  it('l2Chain is undefined', () => {
    const plugin = getChainPlugin();
    expect(plugin.l2Chain).toBeUndefined();
  });

  it('maps all L1 metrics to l1-execution', () => {
    const plugin = getChainPlugin();
    const metrics = ['cpuUsage', 'memoryPercent', 'blockHeight', 'txPoolPending', 'peerCount'];
    for (const m of metrics) {
      expect(plugin.mapMetricToComponent(m)).toBe('l1-execution');
    }
  });

  it('normalizes client family names to l1-execution', () => {
    const plugin = getChainPlugin();
    expect(plugin.normalizeComponentName('geth')).toBe('l1-execution');
    expect(plugin.normalizeComponentName('reth')).toBe('l1-execution');
    expect(plugin.normalizeComponentName('nethermind')).toBe('l1-execution');
  });

  it('also loads via CHAIN_TYPE=l1', () => {
    delete process.env.CHAIN_TYPE;
    resetChainRegistry();
    process.env.CHAIN_TYPE = 'l1';
    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('l1-evm');
  });
});
