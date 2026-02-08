import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks
const { mockRunK8sCommand } = vi.hoisted(() => {
  return { mockRunK8sCommand: vi.fn() };
});

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: mockRunK8sCommand,
}));

import {
  zeroDowntimeScale,
  getSwapState,
  isSwapInProgress,
  resetSwapState,
  _testHooks,
} from '../zero-downtime-scaler';
import { ScalingConfig, DEFAULT_SCALING_CONFIG } from '@/types/scaling';

// ============================================================
// Test fixtures
// ============================================================

const testConfig: ScalingConfig = {
  ...DEFAULT_SCALING_CONFIG,
  namespace: 'test-ns',
  statefulSetName: 'test-geth',
  serviceName: 'test-geth-svc',
  containerIndex: 0,
};

const mockPodSpec = {
  metadata: {
    labels: { app: 'op-geth', 'app.kubernetes.io/name': 'op-geth' },
  },
  spec: {
    serviceAccountName: 'default',
    containers: [
      {
        name: 'op-geth',
        image: 'op-geth:latest',
        resources: {
          requests: { cpu: '1', memory: '2Gi' },
          limits: { cpu: '1', memory: '2Gi' },
        },
      },
    ],
    volumes: [
      { name: 'data', persistentVolumeClaim: { claimName: 'data-geth-0' } },
      { name: 'config', configMap: { name: 'geth-config' } },
    ],
  },
};

const mockServiceWithoutSlot = {
  spec: {
    selector: { app: 'op-geth' },
  },
};

const mockServiceWithSlot = {
  spec: {
    selector: { app: 'op-geth', slot: 'active' },
  },
};

const rpcSuccessResponse = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: '0x1a4',
});

// ============================================================
// Helper: set up sequential mock responses
// ============================================================

function setupFullSuccessMocks() {
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    // Phase 1: createStandbyPod
    if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
      return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
    }
    if (cmd.includes('apply -f -')) {
      return { stdout: 'pod/test-geth-standby created', stderr: '' };
    }

    // Phase 2: waitForReady
    if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
      return { stdout: "'True'", stderr: '' };
    }
    if (cmd.includes('jsonpath') && cmd.includes('podIP')) {
      return { stdout: "'10.0.0.99'", stderr: '' };
    }
    if (cmd.includes('exec') && cmd.includes('wget')) {
      return { stdout: rpcSuccessResponse, stderr: '' };
    }

    // Phase 3: switchTraffic
    if (cmd.includes('get service') && cmd.includes('-o json')) {
      return { stdout: JSON.stringify(mockServiceWithSlot), stderr: '' };
    }
    if (cmd.includes('label pod')) {
      return { stdout: 'pod labeled', stderr: '' };
    }
    if (cmd.includes('patch service')) {
      return { stdout: 'service patched', stderr: '' };
    }

    // Phase 4: cleanupOldPod
    if (cmd.includes('delete pod')) {
      return { stdout: 'pod deleted', stderr: '' };
    }
    if (cmd.includes('wait --for=delete')) {
      return { stdout: 'condition met', stderr: '' };
    }

    // Phase 5: syncStatefulSet
    if (cmd.includes('patch statefulset')) {
      return { stdout: 'statefulset patched', stderr: '' };
    }

    return { stdout: '', stderr: '' };
  });
}

// ============================================================
// Tests
// ============================================================

describe('zero-downtime-scaler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSwapState();
    // Make sleep a no-op for all tests
    _testHooks.sleep = () => Promise.resolve();
  });

  // ----------------------------------------------------------
  // State management functions
  // ----------------------------------------------------------

  describe('getSwapState', () => {
    it('should return initial state with phase idle', () => {
      const state = getSwapState();
      expect(state.phase).toBe('idle');
      expect(state.startedAt).toBeNull();
      expect(state.completedAt).toBeNull();
      expect(state.standbyPodName).toBeNull();
      expect(state.targetVcpu).toBe(0);
      expect(state.targetMemoryGiB).toBe(0);
      expect(state.error).toBeNull();
      expect(state.phaseDurations).toEqual({});
    });

    it('should return immutable copy of state', () => {
      const state1 = getSwapState();
      const state2 = getSwapState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);

      // Mutating the returned object should not affect internal state
      state1.phase = 'failed';
      expect(getSwapState().phase).toBe('idle');
    });

    it('should return deep copy of phaseDurations', () => {
      const state = getSwapState();
      state.phaseDurations.creating_standby = 999;
      expect(getSwapState().phaseDurations).toEqual({});
    });
  });

  describe('isSwapInProgress', () => {
    it('should return false when phase is idle', () => {
      expect(isSwapInProgress()).toBe(false);
    });

    it('should return false when phase is completed', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);
      expect(getSwapState().phase).toBe('completed');
      expect(isSwapInProgress()).toBe(false);
    });

    it('should return false when phase is failed', async () => {
      // First call: get pod spec succeeds
      mockRunK8sCommand.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPodSpec), stderr: '',
      });
      // Second call: apply fails
      mockRunK8sCommand.mockRejectedValueOnce(new Error('k8s error'));
      // Rollback calls
      mockRunK8sCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await zeroDowntimeScale(4, 8, testConfig);
      expect(getSwapState().phase).toBe('failed');
      expect(isSwapInProgress()).toBe(false);
    });
  });

  describe('resetSwapState', () => {
    it('should reset to initial state after successful swap', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);
      expect(getSwapState().phase).toBe('completed');

      resetSwapState();
      const state = getSwapState();
      expect(state.phase).toBe('idle');
      expect(state.startedAt).toBeNull();
      expect(state.standbyPodName).toBeNull();
      expect(state.phaseDurations).toEqual({});
    });
  });

  // ----------------------------------------------------------
  // Main orchestration
  // ----------------------------------------------------------

  describe('zeroDowntimeScale', () => {
    it('should complete full orchestration successfully', async () => {
      setupFullSuccessMocks();

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(true);
      expect(result.finalPhase).toBe('completed');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      // Phase durations should be recorded
      expect(result.phaseDurations.creating_standby).toBeDefined();
      expect(result.phaseDurations.waiting_ready).toBeDefined();
      expect(result.phaseDurations.switching_traffic).toBeDefined();
      expect(result.phaseDurations.cleanup).toBeDefined();
      expect(result.phaseDurations.syncing_statefulset).toBeDefined();

      // Final state
      const state = getSwapState();
      expect(state.phase).toBe('completed');
      expect(state.completedAt).not.toBeNull();
      expect(state.targetVcpu).toBe(4);
      expect(state.targetMemoryGiB).toBe(8);
    });

    it('should reject when swap is already in progress', async () => {
      // Directly set phase to simulate in-progress state (avoids concurrent promise issues)
      _testHooks._setPhase('creating_standby');

      const result = await zeroDowntimeScale(2, 4, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Swap already in progress');
      expect(result.totalDurationMs).toBe(0);
      expect(result.finalPhase).toBe('creating_standby');
      expect(mockRunK8sCommand).not.toHaveBeenCalled();
    });

    it('should rollback on kubectl error during createStandbyPod', async () => {
      // get pod succeeds
      mockRunK8sCommand.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPodSpec), stderr: '',
      });
      // apply fails
      mockRunK8sCommand.mockRejectedValueOnce(new Error('insufficient resources'));
      // rollback calls
      mockRunK8sCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient resources');
      expect(result.finalPhase).toBe('failed');
    });

    it('should rollback when readiness check times out', async () => {
      // Track time manually — each Date.now() call advances by 100s
      // so after 4 calls the timeout (300s) is exceeded
      let callCount = 0;
      const baseTime = 1000000;
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        return baseTime + callCount * 100000;
      });

      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'created', stderr: '' };
        }
        // Always return not ready
        if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
          return { stdout: "'False'", stderr: '' };
        }
        if (cmd.includes('delete pod') || cmd.includes('label pod')) {
          return { stdout: 'ok', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      spy.mockRestore();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Standby pod failed to become ready');
      expect(result.finalPhase).toBe('failed');
    });

    it('should rollback on switchTraffic failure', async () => {
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        // createStandbyPod
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'created', stderr: '' };
        }
        // waitForReady (immediate success)
        if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
          return { stdout: "'True'", stderr: '' };
        }
        if (cmd.includes('jsonpath') && cmd.includes('podIP')) {
          return { stdout: "'10.0.0.99'", stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget')) {
          return { stdout: rpcSuccessResponse, stderr: '' };
        }
        // switchTraffic: fail on get service
        if (cmd.includes('get service')) {
          throw new Error('service not found');
        }
        // rollback
        if (cmd.includes('delete pod') || cmd.includes('label pod')) {
          return { stdout: 'ok', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('service not found');
      expect(result.finalPhase).toBe('failed');
    });
  });

  // ----------------------------------------------------------
  // Phase function behavior (tested via zeroDowntimeScale mock calls)
  // ----------------------------------------------------------

  describe('createStandbyPod (via orchestration)', () => {
    it('should fetch pod spec, modify resources, replace PVC with emptyDir', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      // Verify: get pod was called
      const getCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('get pod') && (c[0] as string).includes('-o json') && !(c[0] as string).includes('jsonpath')
      );
      expect(getCalls.length).toBeGreaterThanOrEqual(1);
      expect(getCalls[0][0]).toContain(`${testConfig.statefulSetName}-0`);
      expect(getCalls[0][0]).toContain(`-n ${testConfig.namespace}`);

      // Verify: apply was called with stdin
      const applyCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('apply -f -')
      );
      expect(applyCalls.length).toBe(1);
      expect(applyCalls[0][1]).toHaveProperty('stdin');

      // Verify manifest content
      const manifest = JSON.parse((applyCalls[0][1] as { stdin: string }).stdin);
      expect(manifest.metadata.labels.role).toBe('standby');
      expect(manifest.metadata.labels.slot).toBe('standby');
      expect(manifest.spec.containers[0].resources.requests.cpu).toBe('4');
      expect(manifest.spec.containers[0].resources.requests.memory).toBe('8Gi');
      expect(manifest.spec.containers[0].resources.limits.cpu).toBe('4');
      expect(manifest.spec.containers[0].resources.limits.memory).toBe('8Gi');

      // Verify PVC replaced with emptyDir
      const dataVolume = manifest.spec.volumes.find((v: Record<string, unknown>) => v.name === 'data');
      expect(dataVolume.emptyDir).toEqual({});
      expect(dataVolume.persistentVolumeClaim).toBeUndefined();

      // Verify non-PVC volumes preserved
      const configVolume = manifest.spec.volumes.find((v: Record<string, unknown>) => v.name === 'config');
      expect(configVolume.configMap).toBeDefined();
    });

    it('should generate standby pod name with timestamp', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      const state = getSwapState();
      expect(state.standbyPodName).toMatch(/^test-geth-standby-\d+$/);
    });
  });

  describe('waitForReady (via orchestration)', () => {
    it('should check pod readiness and verify RPC', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      // Readiness check
      const readyCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('jsonpath') && (c[0] as string).includes('Ready')
      );
      expect(readyCalls.length).toBeGreaterThanOrEqual(1);

      // RPC check
      const execCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('exec') && (c[0] as string).includes('eth_blockNumber')
      );
      expect(execCalls.length).toBe(1);
    });
  });

  describe('switchTraffic (via orchestration)', () => {
    it('should set up slot selector when not present on service', async () => {
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) return { stdout: 'created', stderr: '' };
        if (cmd.includes('jsonpath') && cmd.includes('Ready')) return { stdout: "'True'", stderr: '' };
        if (cmd.includes('jsonpath') && cmd.includes('podIP')) return { stdout: "'10.0.0.99'", stderr: '' };
        if (cmd.includes('exec') && cmd.includes('wget')) return { stdout: rpcSuccessResponse, stderr: '' };

        // Return service WITHOUT slot selector
        if (cmd.includes('get service') && cmd.includes('-o json')) {
          return { stdout: JSON.stringify(mockServiceWithoutSlot), stderr: '' };
        }

        if (cmd.includes('label pod') || cmd.includes('patch service')) return { stdout: 'ok', stderr: '' };
        if (cmd.includes('delete pod') || cmd.includes('wait --for=delete')) return { stdout: 'ok', stderr: '' };
        if (cmd.includes('patch statefulset')) return { stdout: 'ok', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      await zeroDowntimeScale(4, 8, testConfig);

      // Should have patched service to add slot selector
      const patchServiceCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('patch service')
      );
      expect(patchServiceCalls.length).toBe(1);
      expect(patchServiceCalls[0][0]).toContain('slot');
    });

    it('should label standby pod as active and old pod as draining', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      // Standby → active
      const standbyActiveCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('label pod') && (c[0] as string).includes('slot=active') && (c[0] as string).includes('standby')
      );
      expect(standbyActiveCalls.length).toBe(1);

      // Old → draining
      const drainingCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('label pod') && (c[0] as string).includes('slot=draining')
      );
      expect(drainingCalls.length).toBe(1);
      expect(drainingCalls[0][0]).toContain(`${testConfig.statefulSetName}-0`);
    });
  });

  describe('cleanupOldPod (via orchestration)', () => {
    it('should delete old pod with grace period and wait', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      const deleteCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('delete pod') && (c[0] as string).includes('--grace-period=60')
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][0]).toContain(`${testConfig.statefulSetName}-0`);

      const waitCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('wait --for=delete')
      );
      expect(waitCalls.length).toBe(1);
    });
  });

  describe('syncStatefulSet (via orchestration)', () => {
    it('should patch statefulset with target resources', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      const patchCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('patch statefulset')
      );
      expect(patchCalls.length).toBe(1);

      const cmd = patchCalls[0][0] as string;
      expect(cmd).toContain(testConfig.statefulSetName);
      expect(cmd).toContain(`-n ${testConfig.namespace}`);
      expect(cmd).toContain('"4"');
      expect(cmd).toContain('"8Gi"');
    });
  });

  describe('rollback (via orchestration)', () => {
    it('should delete standby pod and restore label on failure', async () => {
      mockRunK8sCommand.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPodSpec), stderr: '',
      });
      mockRunK8sCommand.mockRejectedValueOnce(new Error('apply failed'));
      // rollback calls
      mockRunK8sCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

      const result = await zeroDowntimeScale(4, 8, testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain('apply failed');

      // rollback should attempt label restore
      const labelCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('label pod') && (c[0] as string).includes('slot=active')
      );
      expect(labelCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle rollback failure gracefully', async () => {
      mockRunK8sCommand.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPodSpec), stderr: '',
      });
      mockRunK8sCommand.mockRejectedValueOnce(new Error('apply failed'));
      // rollback also fails
      mockRunK8sCommand.mockRejectedValue(new Error('rollback error'));

      const result = await zeroDowntimeScale(4, 8, testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain('apply failed');
      expect(getSwapState().phase).toBe('failed');
    });
  });
});
