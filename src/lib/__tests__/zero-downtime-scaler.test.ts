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

const txPoolEmptyResponse = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: { pending: '0x0', queued: '0x0' },
});

// ============================================================
// Helper: set up sequential mock responses
// ============================================================

const mockPvcSpec = {
  spec: {
    accessModes: ['ReadWriteMany'],
    storageClassName: 'efs-sc',
    resources: { requests: { storage: '500Gi' } },
  },
};

/** Common handlers for preflight, PVC clone, and cleanup that all tests need */
function handleCommonCommands(cmd: string): { stdout: string; stderr: string } | null {
  // Preflight: updateStrategy check
  if (cmd.includes('get statefulset') && cmd.includes('jsonpath') && cmd.includes('updateStrategy')) {
    return { stdout: "'OnDelete'", stderr: '' };
  }
  // PVC spec fetch for cloning
  if (cmd.includes('get pvc') && cmd.includes('-o json')) {
    return { stdout: JSON.stringify(mockPvcSpec), stderr: '' };
  }
  // PVC listing for cleanup
  if (cmd.includes('get pvc') && cmd.includes('-l')) {
    return { stdout: '', stderr: '' };
  }
  // PVC deletion (cleanup/rollback)
  if (cmd.includes('delete pvc')) {
    return { stdout: 'pvc deleted', stderr: '' };
  }
  return null;
}

function setupFullSuccessMocks() {
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    const common = handleCommonCommands(cmd);
    if (common) return common;

    // Phase 1: createStandbyPod
    if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
      return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
    }
    if (cmd.includes('apply -f -')) {
      return { stdout: 'resource created', stderr: '' };
    }

    // Phase 2: waitForReady (consolidated Ready+podIP in single jsonpath call)
    if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
      return { stdout: "'True,10.0.0.99'", stderr: '' };
    }

    // Safety Gate: txpool_status
    if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('txpool_status')) {
      return { stdout: txPoolEmptyResponse, stderr: '' };
    }
    // RPC check (readiness + block sync)
    if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('eth_blockNumber')) {
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
      let applyCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          applyCount++;
          if (applyCount === 2) throw new Error('k8s error');
          return { stdout: 'pvc cloned', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

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
      let applyCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          applyCount++;
          if (applyCount === 2) throw new Error('insufficient resources'); // Pod apply fails
          return { stdout: 'pvc cloned', stderr: '' }; // PVC clone apply succeeds
        }
        return { stdout: 'ok', stderr: '' };
      });

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
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'created', stderr: '' };
        }
        // Always return not ready (consolidated Ready+podIP call)
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          return { stdout: "'False,'", stderr: '' };
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
        const common = handleCommonCommands(cmd);
        if (common) return common;
        // createStandbyPod
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'created', stderr: '' };
        }
        // waitForReady (immediate success — consolidated Ready+podIP)
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          return { stdout: "'True,10.0.0.99'", stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('txpool_status')) {
          return { stdout: txPoolEmptyResponse, stderr: '' };
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
    it('should fetch pod spec, modify resources, clone PVC via CSI dataSource', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      // Verify: get pod was called
      const getCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('get pod') && (c[0] as string).includes('-o json') && !(c[0] as string).includes('jsonpath')
      );
      expect(getCalls.length).toBeGreaterThanOrEqual(1);
      expect(getCalls[0][0]).toContain(`${testConfig.statefulSetName}-0`);
      expect(getCalls[0][0]).toContain(`-n ${testConfig.namespace}`);

      // Verify: apply was called (PVC clone + Pod manifest)
      const applyCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('apply -f -')
      );
      // 1 PVC clone apply + 1 Pod apply = 2
      expect(applyCalls.length).toBe(2);

      // Verify Pod manifest content (second apply call)
      const podApply = applyCalls[1];
      expect(podApply[1]).toHaveProperty('stdin');
      const manifest = JSON.parse((podApply[1] as { stdin: string }).stdin);
      expect(manifest.metadata.labels.role).toBe('standby');
      expect(manifest.metadata.labels.slot).toBe('standby');
      expect(manifest.spec.containers[0].resources.requests.cpu).toBe('4');
      expect(manifest.spec.containers[0].resources.requests.memory).toBe('8Gi');
      expect(manifest.spec.containers[0].resources.limits.cpu).toBe('4');
      expect(manifest.spec.containers[0].resources.limits.memory).toBe('8Gi');

      // Verify PVC volume now points to cloned PVC (not emptyDir)
      const dataVolume = manifest.spec.volumes.find((v: Record<string, unknown>) => v.name === 'data');
      expect(dataVolume.persistentVolumeClaim).toBeDefined();
      expect(dataVolume.persistentVolumeClaim.claimName).toMatch(/standby/);

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

      // RPC check (1 readiness + 1 block sync = 2 calls)
      const execCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('exec') && (c[0] as string).includes('eth_blockNumber')
      );
      expect(execCalls.length).toBe(2);
    });

    it('should use a single consolidated kubectl get pod call for Ready+podIP per poll (not two)', async () => {
      setupFullSuccessMocks();
      await zeroDowntimeScale(4, 8, testConfig);

      // Count kubectl "get pod ... jsonpath" calls during waitForReady phase
      const jsonpathGetPodCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => {
          const cmd = c[0] as string;
          return cmd.includes('get pod') && cmd.includes('jsonpath');
        }
      );

      // With consolidated call, there should be exactly 1 get-pod-jsonpath call
      // per successful poll iteration (combining Ready status + podIP).
      // Previously there were 2 separate calls (one for Ready, one for podIP).
      expect(jsonpathGetPodCalls.length).toBe(1);

      // The single call should fetch BOTH Ready status and podIP
      const cmd = jsonpathGetPodCalls[0][0] as string;
      expect(cmd).toContain('Ready');
      expect(cmd).toContain('podIP');
    });

    it('should use exponential backoff intervals [1s, 2s, 5s, 10s] when polling', async () => {
      const sleepCalls: number[] = [];
      _testHooks.sleep = (ms: number) => {
        sleepCalls.push(ms);
        return Promise.resolve();
      };

      let readyCheckCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;

        // Phase 1: createStandbyPod
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'pod/test-geth-standby created', stderr: '' };
        }

        // Phase 2: waitForReady — return not-ready for first 4 attempts, then ready
        // (consolidated Ready+podIP in single jsonpath call)
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          readyCheckCount++;
          if (readyCheckCount <= 4) {
            return { stdout: "'False,'", stderr: '' };
          }
          return { stdout: "'True,10.0.0.99'", stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('txpool_status')) {
          return { stdout: txPoolEmptyResponse, stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget')) {
          return { stdout: rpcSuccessResponse, stderr: '' };
        }

        // Phase 3-5: standard mocks
        if (cmd.includes('get service') && cmd.includes('-o json')) {
          return { stdout: JSON.stringify(mockServiceWithSlot), stderr: '' };
        }
        if (cmd.includes('label pod')) return { stdout: 'pod labeled', stderr: '' };
        if (cmd.includes('patch service')) return { stdout: 'service patched', stderr: '' };
        if (cmd.includes('delete pod')) return { stdout: 'pod deleted', stderr: '' };
        if (cmd.includes('wait --for=delete')) return { stdout: 'condition met', stderr: '' };
        if (cmd.includes('patch statefulset')) return { stdout: 'statefulset patched', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);
      expect(result.success).toBe(true);

      // Filter sleep calls from waitForReady phase (not cleanup phase's 30s sleep)
      // waitForReady sleeps 4 times (one per not-ready check)
      const backoffSleeps = sleepCalls.filter(ms => ms !== 30000);
      expect(backoffSleeps).toEqual([1000, 2000, 5000, 10000]);
    });
  });

  describe('switchTraffic (via orchestration)', () => {
    it('should set up slot selector when not present on service', async () => {
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) return { stdout: 'created', stderr: '' };
        // consolidated Ready+podIP
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) return { stdout: "'True,10.0.0.99'", stderr: '' };
        if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('txpool_status')) return { stdout: txPoolEmptyResponse, stderr: '' };
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

    it('should attempt partial rollback when draining old pod fails', async () => {
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;

        // Phase 1: createStandbyPod
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'pod/test-geth-standby created', stderr: '' };
        }

        // Phase 2: waitForReady (immediate success)
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          return { stdout: "'True,10.0.0.99'", stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget') && cmd.includes('txpool_status')) {
          return { stdout: txPoolEmptyResponse, stderr: '' };
        }
        if (cmd.includes('exec') && cmd.includes('wget')) {
          return { stdout: rpcSuccessResponse, stderr: '' };
        }

        // Phase 3: switchTraffic
        if (cmd.includes('get service') && cmd.includes('-o json')) {
          return { stdout: JSON.stringify(mockServiceWithSlot), stderr: '' };
        }

        // Step 3 (standby -> active): succeeds
        if (cmd.includes('label pod') && cmd.includes('slot=active') && cmd.includes('standby')) {
          return { stdout: 'pod labeled', stderr: '' };
        }

        // Step 4 (old pod -> draining): FAILS
        if (cmd.includes('label pod') && cmd.includes('slot=draining')) {
          throw new Error('failed to label pod: connection refused');
        }

        // Recovery labels (old pod -> active, new pod -> standby) should succeed
        if (cmd.includes('label pod') && cmd.includes('slot=active')) {
          return { stdout: 'pod labeled', stderr: '' };
        }
        if (cmd.includes('label pod') && cmd.includes('slot=standby')) {
          return { stdout: 'pod labeled', stderr: '' };
        }

        // Rollback calls from parent orchestration
        if (cmd.includes('delete pod')) {
          return { stdout: 'pod deleted', stderr: '' };
        }
        if (cmd.includes('label pod')) {
          return { stdout: 'pod labeled', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection refused');

      // Verify partial rollback was attempted:
      // Recovery should re-label old pod as active
      const recoveryActiveCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => {
          const cmd = c[0] as string;
          return cmd.includes('label pod') && cmd.includes(`${testConfig.statefulSetName}-0`) && cmd.includes('slot=active');
        }
      );
      // At least 2: one from switchTraffic init (if no slot), and one from recovery
      // With slot already present, recovery call is the second one
      expect(recoveryActiveCalls.length).toBeGreaterThanOrEqual(2);

      // Recovery should re-label new (standby) pod back to standby
      const recoveryStandbyCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => {
          const cmd = c[0] as string;
          return cmd.includes('label pod') && cmd.includes('standby') && cmd.includes('slot=standby');
        }
      );
      expect(recoveryStandbyCalls.length).toBeGreaterThanOrEqual(1);
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
      let applyCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          applyCount++;
          if (applyCount === 2) throw new Error('apply failed'); // Pod apply fails
          return { stdout: 'pvc cloned', stderr: '' };
        }
        return { stdout: 'ok', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain('apply failed');

      // rollback should attempt label restore
      const labelCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('label pod') && (c[0] as string).includes('slot=active')
      );
      expect(labelCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle rollback failure gracefully with retries', async () => {
      let applyCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          applyCount++;
          if (applyCount === 2) throw new Error('apply failed');
          return { stdout: 'pvc cloned', stderr: '' };
        }
        // All rollback calls fail
        if (cmd.includes('delete pod') || cmd.includes('label pod')) {
          throw new Error('rollback error');
        }
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain('apply failed');
      expect(getSwapState().phase).toBe('failed');
    });
  });

  // ----------------------------------------------------------
  // Safety Gates
  // ----------------------------------------------------------

  describe('block sync gate', () => {
    it('should pass when block gap is within threshold', async () => {
      setupFullSuccessMocks();
      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(true);
      expect(result.safetyGates?.blockSync).toBeDefined();
      expect(result.safetyGates?.blockSync?.synced).toBe(true);
      // Both pods return same block (0x1a4 = 420)
      expect(result.safetyGates?.blockSync?.gap).toBe(0);
    });

    it('should abort when block gap exceeds threshold', async () => {
      const farBehindBlockResponse = JSON.stringify({
        jsonrpc: '2.0', id: 1, result: '0x64',  // 100 — far behind 420
      });

      let execCallCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        // Phase 1
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) {
          return { stdout: 'created', stderr: '' };
        }
        // Phase 2: waitForReady
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          return { stdout: "'True,10.0.0.99'", stderr: '' };
        }
        // RPC calls — readiness check returns standby block, then block sync checks old pod
        if (cmd.includes('exec') && cmd.includes('eth_blockNumber')) {
          execCallCount++;
          if (execCallCount === 1) {
            // Phase 2 readiness: standby pod returns block 420
            return { stdout: rpcSuccessResponse, stderr: '' };
          }
          // Block sync gate: old pod returns block 100 (huge gap)
          return { stdout: farBehindBlockResponse, stderr: '' };
        }
        // Rollback / cleanup
        if (cmd.includes('delete pod') || cmd.includes('label pod')) {
          return { stdout: 'ok', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Block sync gap too large');
      expect(result.safetyGates?.blockSync?.synced).toBe(false);
      expect(result.safetyGates?.blockSync?.gap).toBe(320); // |420 - 100|
    });
  });

  describe('TX drain gate', () => {
    it('should pass when txpool is empty', async () => {
      setupFullSuccessMocks();
      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(true);
      expect(result.safetyGates?.txDrain).toBeDefined();
      expect(result.safetyGates?.txDrain?.drained).toBe(true);
    });

    it('should treat txpool_status RPC failure as drained (graceful fallback)', async () => {
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        if (cmd.includes('apply -f -')) return { stdout: 'created', stderr: '' };
        if (cmd.includes('jsonpath') && cmd.includes('Ready') && cmd.includes('podIP')) {
          return { stdout: "'True,10.0.0.99'", stderr: '' };
        }
        // eth_blockNumber succeeds for both readiness and block sync
        if (cmd.includes('exec') && cmd.includes('eth_blockNumber')) {
          return { stdout: rpcSuccessResponse, stderr: '' };
        }
        // txpool_status fails
        if (cmd.includes('exec') && cmd.includes('txpool_status')) {
          throw new Error('method not found');
        }
        if (cmd.includes('get service') && cmd.includes('-o json')) {
          return { stdout: JSON.stringify(mockServiceWithSlot), stderr: '' };
        }
        if (cmd.includes('label pod')) return { stdout: 'pod labeled', stderr: '' };
        if (cmd.includes('delete pod')) return { stdout: 'pod deleted', stderr: '' };
        if (cmd.includes('wait --for=delete')) return { stdout: 'condition met', stderr: '' };
        if (cmd.includes('patch statefulset')) return { stdout: 'statefulset patched', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(true);
      // txpool_status failure is treated as drained
      expect(result.safetyGates?.txDrain?.drained).toBe(true);
    });
  });

  describe('rollback retry', () => {
    it('should retry rollback up to MAX_ROLLBACK_RETRIES times', async () => {
      let rollbackAttempts = 0;
      let applyCount = 0;
      mockRunK8sCommand.mockImplementation(async (cmd: string) => {
        const common = handleCommonCommands(cmd);
        if (common) return common;
        if (cmd.includes('get pod') && cmd.includes('-o json') && !cmd.includes('jsonpath')) {
          return { stdout: JSON.stringify(mockPodSpec), stderr: '' };
        }
        // PVC clone apply succeeds, Pod apply fails
        if (cmd.includes('apply -f -')) {
          applyCount++;
          if (applyCount === 2) throw new Error('create failed');
          return { stdout: 'pvc cloned', stderr: '' };
        }
        // First 2 rollback attempts fail, third succeeds
        if (cmd.includes('delete pod') || cmd.includes('label pod')) {
          rollbackAttempts++;
          if (rollbackAttempts <= 4) { // 2 retries × 2 steps each
            throw new Error('rollback step failed');
          }
          return { stdout: 'ok', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await zeroDowntimeScale(4, 8, testConfig);

      expect(result.success).toBe(false);
      // Should have attempted multiple rollback cycles
      expect(rollbackAttempts).toBeGreaterThan(1);
    });
  });
});
