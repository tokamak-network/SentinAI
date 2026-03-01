import { afterEach, describe, expect, it } from 'vitest';
import { ZkstackPlugin } from '@/chains/zkstack';

describe('ZkstackPlugin', () => {
  afterEach(() => {
    delete process.env.ZKSTACK_MODE;
    delete process.env.ZK_PROOF_RPC_URL;
    delete process.env.ZK_BATCHER_STATUS_URL;
    delete process.env.ORCHESTRATOR_TYPE;
    delete process.env.ZKSTACK_COMPONENT_PROFILE;
  });

  it('defaults to legacy-era mode and conservative capabilities', () => {
    const plugin = new ZkstackPlugin();

    expect(plugin.chainType).toBe('zkstack');
    expect(plugin.chainMode).toBe('legacy-era');
    expect(plugin.capabilities.proofMonitoring).toBe(false);
    expect(plugin.capabilities.settlementMonitoring).toBe(false);
  });

  it('enables proof and settlement capabilities when probes are configured', () => {
    process.env.ZK_PROOF_RPC_URL = 'http://localhost:3070';
    process.env.ZK_BATCHER_STATUS_URL = 'http://localhost:8080/status';

    const plugin = new ZkstackPlugin();

    expect(plugin.capabilities.proofMonitoring).toBe(true);
    expect(plugin.capabilities.settlementMonitoring).toBe(true);
  });

  it('switches mode to os-preview when configured', () => {
    process.env.ZKSTACK_MODE = 'os-preview';

    const plugin = new ZkstackPlugin();

    expect(plugin.chainMode).toBe('os-preview');
    expect(plugin.displayName.toLowerCase()).toContain('os-preview');
  });

  it('keeps only execution component in docker core-only profile', () => {
    process.env.ORCHESTRATOR_TYPE = 'docker';

    const plugin = new ZkstackPlugin();

    expect(plugin.k8sComponents.map((c) => c.component)).toEqual(['zksync-server']);
  });

  it('maps proof and settlement metrics to dedicated components', () => {
    const plugin = new ZkstackPlugin();

    expect(plugin.mapMetricToComponent('proofQueueDepth')).toBe('zk-prover');
    expect(plugin.mapMetricToComponent('settlementLag')).toBe('zk-batcher');
    expect(plugin.mapMetricToComponent('cpuUsage')).toBe('zksync-server');
  });
});
