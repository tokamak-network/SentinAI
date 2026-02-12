/**
 * L1 RPC Auto-Failover Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks
const { mockGetBlockNumber, mockRunK8sCommand } = vi.hoisted(() => ({
  mockGetBlockNumber: vi.fn(),
  mockRunK8sCommand: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBlockNumber: mockGetBlockNumber,
  })),
  http: vi.fn(),
}));

vi.mock('viem/chains', () => ({
  sepolia: { id: 11155111 },
}));

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: mockRunK8sCommand,
  getNamespace: vi.fn(() => 'default'),
}));

import {
  getActiveL1RpcUrl,
  reportL1Success,
  reportL1Failure,
  healthCheckEndpoint,
  executeFailover,
  updateK8sL1Rpc,
  getL1FailoverState,
  getFailoverEvents,
  resetL1FailoverState,
  maskUrl,
  getL1Components,
} from '../l1-rpc-failover';

describe('l1-rpc-failover', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetL1FailoverState();
    // Reset env
    delete process.env.L1_RPC_URLS;
    delete process.env.L1_RPC_URL;
    delete process.env.K8S_STATEFULSET_PREFIX;
    delete process.env.SCALING_SIMULATION_MODE;
    delete process.env.AWS_CLUSTER_NAME;
    delete process.env.K8S_API_URL;
    // Default: health check succeeds
    mockGetBlockNumber.mockResolvedValue(BigInt(1000));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------

  describe('initialization', () => {
    it('should parse L1_RPC_URLS (comma-separated)', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';

      const state = getL1FailoverState();

      expect(state.endpoints).toHaveLength(3); // rpc1 + rpc2 + publicnode
      expect(state.endpoints[0].url).toBe('https://rpc1.io');
      expect(state.endpoints[1].url).toBe('https://rpc2.io');
      expect(state.endpoints[2].url).toContain('publicnode.com');
      expect(state.activeUrl).toBe('https://rpc1.io');
      expect(state.activeIndex).toBe(0);
    });

    it('should fall back to L1_RPC_URL when L1_RPC_URLS is not set', () => {
      process.env.L1_RPC_URL = 'https://single-rpc.io';

      const state = getL1FailoverState();

      expect(state.endpoints).toHaveLength(2); // single + publicnode
      expect(state.endpoints[0].url).toBe('https://single-rpc.io');
      expect(state.activeUrl).toBe('https://single-rpc.io');
    });

    it('should use only publicnode.com when no env vars set', () => {
      const state = getL1FailoverState();

      expect(state.endpoints).toHaveLength(1);
      expect(state.endpoints[0].url).toContain('publicnode.com');
    });

    it('should not duplicate publicnode.com', () => {
      process.env.L1_RPC_URLS = 'https://ethereum-sepolia-rpc.publicnode.com,https://rpc2.io';

      const state = getL1FailoverState();

      expect(state.endpoints).toHaveLength(2); // publicnode + rpc2 (no dup)
      const publicnodeCount = state.endpoints.filter((e) =>
        e.url.includes('publicnode.com')
      ).length;
      expect(publicnodeCount).toBe(1);
    });

    it('should filter empty URLs', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,,  ,https://rpc2.io';

      const state = getL1FailoverState();

      expect(state.endpoints).toHaveLength(3); // rpc1 + rpc2 + publicnode
    });

    it('should initialize all endpoints as healthy', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';

      const state = getL1FailoverState();

      for (const ep of state.endpoints) {
        expect(ep.healthy).toBe(true);
        expect(ep.consecutiveFailures).toBe(0);
      }
    });
  });

  // ----------------------------------------------------------
  // getActiveL1RpcUrl
  // ----------------------------------------------------------

  describe('getActiveL1RpcUrl', () => {
    it('should return the first endpoint by default', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';

      const url = getActiveL1RpcUrl();

      expect(url).toBe('https://rpc1.io');
    });

    it('should auto-initialize if not yet initialized', () => {
      const url = getActiveL1RpcUrl();
      expect(url).toContain('publicnode.com');
    });
  });

  // ----------------------------------------------------------
  // reportL1Success
  // ----------------------------------------------------------

  describe('reportL1Success', () => {
    it('should reset consecutive failures', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      const state = getL1FailoverState();
      state.endpoints[0].consecutiveFailures = 2;

      reportL1Success();

      expect(state.endpoints[0].consecutiveFailures).toBe(0);
      expect(state.endpoints[0].healthy).toBe(true);
      expect(state.endpoints[0].lastSuccess).not.toBeNull();
    });
  });

  // ----------------------------------------------------------
  // reportL1Failure
  // ----------------------------------------------------------

  describe('reportL1Failure', () => {
    it('should increment consecutive failures', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      getL1FailoverState(); // init

      await reportL1Failure(new Error('timeout'));

      const state = getL1FailoverState();
      expect(state.endpoints[0].consecutiveFailures).toBe(1);
      expect(state.endpoints[0].lastFailure).not.toBeNull();
    });

    it('should not trigger failover before MAX_CONSECUTIVE_FAILURES', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      getL1FailoverState(); // init

      const result1 = await reportL1Failure(new Error('fail'));
      const result2 = await reportL1Failure(new Error('fail'));

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(getActiveL1RpcUrl()).toBe('https://rpc1.io'); // no change
    });

    it('should trigger failover after MAX_CONSECUTIVE_FAILURES (3)', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      getL1FailoverState(); // init

      await reportL1Failure(new Error('fail'));
      await reportL1Failure(new Error('fail'));
      const result = await reportL1Failure(new Error('fail'));

      expect(result).toBe('https://rpc2.io');
      expect(getActiveL1RpcUrl()).toBe('https://rpc2.io');
    });

    it('should respect cooldown period', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io,https://rpc3.io';
      const state = getL1FailoverState();

      // Trigger first failover
      state.endpoints[0].consecutiveFailures = 2;
      await reportL1Failure(new Error('fail'));
      expect(getActiveL1RpcUrl()).toBe('https://rpc2.io');

      // Try to failover again immediately — should be blocked
      state.endpoints[1].consecutiveFailures = 2;
      const result = await reportL1Failure(new Error('fail again'));
      expect(result).toBeNull();
      expect(getActiveL1RpcUrl()).toBe('https://rpc2.io'); // unchanged
    });

    it('should return null when only one endpoint exists', async () => {
      // Only publicnode.com
      getL1FailoverState();
      const state = getL1FailoverState();
      state.endpoints[0].consecutiveFailures = 2;

      const result = await reportL1Failure(new Error('fail'));

      expect(result).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // healthCheckEndpoint
  // ----------------------------------------------------------

  describe('healthCheckEndpoint', () => {
    it('should return true for healthy endpoint', async () => {
      mockGetBlockNumber.mockResolvedValue(BigInt(1000));

      const result = await healthCheckEndpoint('https://healthy-rpc.io');

      expect(result).toBe(true);
    });

    it('should return false for failing endpoint', async () => {
      mockGetBlockNumber.mockRejectedValue(new Error('timeout'));

      const result = await healthCheckEndpoint('https://dead-rpc.io');

      expect(result).toBe(false);
    });

    it('should return false for block number 0', async () => {
      mockGetBlockNumber.mockResolvedValue(BigInt(0));

      const result = await healthCheckEndpoint('https://zero-rpc.io');

      expect(result).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // executeFailover
  // ----------------------------------------------------------

  describe('executeFailover', () => {
    it('should switch to next healthy endpoint', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      getL1FailoverState();

      const event = await executeFailover('test reason');

      expect(event).not.toBeNull();
      expect(event!.toUrl).toContain('rpc2.io');
      expect(event!.reason).toBe('test reason');
      expect(getActiveL1RpcUrl()).toBe('https://rpc2.io');
    });

    it('should skip unhealthy candidates', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io,https://rpc3.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      getL1FailoverState();

      // rpc2 health check fails, rpc3 succeeds
      let callCount = 0;
      mockGetBlockNumber.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('rpc2 dead'));
        }
        return Promise.resolve(BigInt(1000));
      });

      const event = await executeFailover('test');

      expect(event).not.toBeNull();
      expect(event!.toUrl).toContain('rpc3.io');
    });

    it('should return null when all candidates are unhealthy', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      getL1FailoverState();

      mockGetBlockNumber.mockRejectedValue(new Error('all dead'));

      const event = await executeFailover('test');

      expect(event).toBeNull();
    });

    it('should wrap around to check all endpoints', async () => {
      // 4 endpoints: rpc1(0), rpc2(1), rpc3(2), publicnode(3)
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io,https://rpc3.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      const state = getL1FailoverState();

      // Start from rpc2 (index 1), so check order: rpc3(2) → publicnode(3) → rpc1(0)
      state.activeIndex = 1;
      state.activeUrl = 'https://rpc2.io';

      // rpc3 fails, publicnode fails, rpc1 succeeds
      let callCount = 0;
      mockGetBlockNumber.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return Promise.reject(new Error('dead'));
        return Promise.resolve(BigInt(1000));
      });

      const event = await executeFailover('test');

      expect(event).not.toBeNull();
      expect(event!.toUrl).toContain('rpc1.io');
    });

    it('should record failover event in state', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      getL1FailoverState();

      await executeFailover('quota exhausted');

      const events = getFailoverEvents();
      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('quota exhausted');
      expect(events[0].simulated).toBe(true);
    });

    it('should set lastFailoverTime', async () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';
      process.env.SCALING_SIMULATION_MODE = 'true';
      getL1FailoverState();

      const before = Date.now();
      await executeFailover('test');
      const after = Date.now();

      const state = getL1FailoverState();
      expect(state.lastFailoverTime).toBeGreaterThanOrEqual(before);
      expect(state.lastFailoverTime).toBeLessThanOrEqual(after);
    });
  });

  // ----------------------------------------------------------
  // updateK8sL1Rpc
  // ----------------------------------------------------------

  describe('updateK8sL1Rpc', () => {
    it('should log only in simulation mode', async () => {
      process.env.SCALING_SIMULATION_MODE = 'true';

      const result = await updateK8sL1Rpc('https://new-rpc.io');

      expect(result.updated).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(mockRunK8sCommand).not.toHaveBeenCalled();
    });

    it('should skip when no K8s cluster configured', async () => {
      process.env.SCALING_SIMULATION_MODE = 'false';
      // No AWS_CLUSTER_NAME or K8S_API_URL

      const result = await updateK8sL1Rpc('https://new-rpc.io');

      expect(result.updated).toHaveLength(0);
      expect(mockRunK8sCommand).not.toHaveBeenCalled();
    });

    it('should execute kubectl set env for 3 components', async () => {
      process.env.SCALING_SIMULATION_MODE = 'false';
      process.env.AWS_CLUSTER_NAME = 'test-cluster';
      process.env.K8S_STATEFULSET_PREFIX = 'my-stack';
      mockRunK8sCommand.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await updateK8sL1Rpc('https://new-rpc.io');

      expect(result.updated).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(mockRunK8sCommand).toHaveBeenCalledTimes(3);

      // Verify command patterns
      const calls = mockRunK8sCommand.mock.calls;
      expect(calls[0][0]).toContain('my-stack-op-node');
      expect(calls[0][0]).toContain('OP_NODE_L1_ETH_RPC');
      expect(calls[1][0]).toContain('my-stack-op-batcher');
      expect(calls[1][0]).toContain('OP_BATCHER_L1_ETH_RPC');
      expect(calls[2][0]).toContain('my-stack-op-proposer');
      expect(calls[2][0]).toContain('OP_PROPOSER_L1_ETH_RPC');
    });

    it('should continue on partial failure', async () => {
      process.env.SCALING_SIMULATION_MODE = 'false';
      process.env.AWS_CLUSTER_NAME = 'test-cluster';
      mockRunK8sCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // op-node OK
        .mockRejectedValueOnce(new Error('batcher not found'))  // op-batcher fails
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // op-proposer OK

      const result = await updateK8sL1Rpc('https://new-rpc.io');

      expect(result.updated).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('batcher not found');
    });

    it('should use correct namespace', async () => {
      process.env.SCALING_SIMULATION_MODE = 'false';
      process.env.AWS_CLUSTER_NAME = 'test-cluster';
      mockRunK8sCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await updateK8sL1Rpc('https://new-rpc.io');

      for (const call of mockRunK8sCommand.mock.calls) {
        expect(call[0]).toContain('-n default');
      }
    });
  });

  // ----------------------------------------------------------
  // maskUrl
  // ----------------------------------------------------------

  describe('maskUrl', () => {
    it('should show hostname only', () => {
      expect(maskUrl('https://eth-mainnet.g.alchemy.com/v2/abc123secret')).toBe(
        'https://eth-mainnet.g.alchemy.com/v2/abc123secre...'
      );
    });

    it('should handle simple URLs', () => {
      expect(maskUrl('https://publicnode.com')).toBe('https://publicnode.com');
    });

    it('should handle invalid URLs', () => {
      expect(maskUrl('not-a-url')).toBe('not-a-url');
    });
  });

  // ----------------------------------------------------------
  // State management
  // ----------------------------------------------------------

  describe('state management', () => {
    it('should reset state', () => {
      process.env.L1_RPC_URLS = 'https://rpc1.io';
      getL1FailoverState(); // init
      reportL1Success(); // mutate

      resetL1FailoverState();

      // Re-init with different env
      process.env.L1_RPC_URLS = 'https://different.io';
      const state = getL1FailoverState();
      expect(state.activeUrl).toBe('https://different.io');
    });

    it('should cap failover events at MAX_FAILOVER_EVENTS', async () => {
      process.env.SCALING_SIMULATION_MODE = 'true';
      process.env.L1_RPC_URLS = 'https://rpc1.io,https://rpc2.io';

      for (let i = 0; i < 25; i++) {
        const state = getL1FailoverState();
        state.lastFailoverTime = null; // bypass cooldown
        await executeFailover(`reason-${i}`);
      }

      const events = getFailoverEvents();
      expect(events.length).toBeLessThanOrEqual(20);
    });
  });

  // ----------------------------------------------------------
  // Proxyd ConfigMap Integration
  // ----------------------------------------------------------

  describe('Proxyd ConfigMap Integration', () => {
    describe('getL1Components (Proxyd mode)', () => {
      it('should return Proxyd config when L1_PROXYD_ENABLED=true', () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.K8S_STATEFULSET_PREFIX = 'test-stack';
        resetL1FailoverState();

        const components = getL1Components();

        expect(components).toHaveLength(4); // 1 proxyd + 3 statefulsets
        expect(components[0].type).toBe('proxyd');
        expect(components[0].proxydConfig?.configMapName).toBe('proxyd-config');
        expect(components[0].proxydConfig?.upstreamGroup).toBe('main');
        expect(components[1].type).toBe('statefulset');
        expect(components[1].statefulSetName).toBe('test-stack-op-node');
      });

      it('should use custom Proxyd env vars', () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.L1_PROXYD_CONFIGMAP_NAME = 'custom-cm';
        process.env.L1_PROXYD_DATA_KEY = 'config.toml';
        process.env.L1_PROXYD_UPSTREAM_GROUP = 'primary';
        process.env.L1_PROXYD_UPDATE_MODE = 'append';
        resetL1FailoverState();

        const components = getL1Components();
        const proxyd = components[0].proxydConfig!;

        expect(proxyd.configMapName).toBe('custom-cm');
        expect(proxyd.dataKey).toBe('config.toml');
        expect(proxyd.upstreamGroup).toBe('primary');
        expect(proxyd.updateMode).toBe('append');
      });

      it('should return StatefulSets only when Proxyd disabled', () => {
        delete process.env.L1_PROXYD_ENABLED;
        resetL1FailoverState();

        const components = getL1Components();

        expect(components).toHaveLength(3);
        expect(components.every((c) => c.type === 'statefulset')).toBe(true);
      });
    });

    describe('updateK8sL1Rpc (Proxyd mode)', () => {
      it('should update ConfigMap before StatefulSets', async () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.SCALING_SIMULATION_MODE = 'false';
        process.env.AWS_CLUSTER_NAME = 'test-cluster';
        resetL1FailoverState();

        mockRunK8sCommand.mockImplementation(async (cmd: string) => {
          if (cmd.includes('get configmap')) {
            return {
              stdout: '[[upstreams]]\nname = "main"\nrpc_url = "https://old.io"',
              stderr: ''
            };
          }
          return { stdout: 'patched', stderr: '' };
        });

        const result = await updateK8sL1Rpc('https://new.io');

        expect(result.updated).toContain('configmap/proxyd-config');
        expect(result.updated.length).toBeGreaterThan(1); // CM + StatefulSets
        expect(result.configMapResult?.success).toBe(true);

        // Verify order: ConfigMap patch before StatefulSet set env
        const calls = mockRunK8sCommand.mock.calls.map((c) => c[0]);
        const patchIndex = calls.findIndex((c) => c.includes('patch configmap'));
        const setEnvIndex = calls.findIndex((c) => c.includes('set env'));
        expect(patchIndex).toBeLessThan(setEnvIndex);
      });

      it('should continue to StatefulSets even if ConfigMap fails', async () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.SCALING_SIMULATION_MODE = 'false';
        process.env.AWS_CLUSTER_NAME = 'test-cluster';
        resetL1FailoverState();

        mockRunK8sCommand
          .mockRejectedValueOnce(new Error('ConfigMap not found')) // get configmap fails
          .mockResolvedValue({ stdout: 'ok', stderr: '' }); // StatefulSets succeed

        const result = await updateK8sL1Rpc('https://new.io');

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('ConfigMap not found');
        expect(result.updated.length).toBeGreaterThan(0); // StatefulSets still updated
      });

      it('should track ConfigMap result in K8sUpdateResult', async () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.SCALING_SIMULATION_MODE = 'false';
        process.env.AWS_CLUSTER_NAME = 'test-cluster';
        resetL1FailoverState();

        mockRunK8sCommand.mockImplementation(async (cmd: string) => {
          if (cmd.includes('get configmap')) {
            return {
              stdout: '[[upstreams]]\nname = "main"\nrpc_url = "https://old-rpc.io"',
              stderr: ''
            };
          }
          return { stdout: 'ok', stderr: '' };
        });

        const result = await updateK8sL1Rpc('https://new-rpc.io');

        expect(result.configMapResult).toBeDefined();
        expect(result.configMapResult?.success).toBe(true);
        expect(result.configMapResult?.previousUrl).toBe('https://old-rpc.io');
        expect(result.configMapResult?.newUrl).toBe('https://new-rpc.io');
      });

      it('should handle ConfigMap update in simulation mode', async () => {
        process.env.L1_PROXYD_ENABLED = 'true';
        process.env.SCALING_SIMULATION_MODE = 'true';
        resetL1FailoverState();

        const result = await updateK8sL1Rpc('https://new.io');

        expect(result.updated).toHaveLength(0); // Simulation: no actual updates
        expect(mockRunK8sCommand).not.toHaveBeenCalled();
      });
    });
  });
});
