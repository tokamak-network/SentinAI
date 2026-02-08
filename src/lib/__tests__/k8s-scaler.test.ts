import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks
const { mockRunK8sCommand, mockZeroDowntimeScale, mockIsSwapInProgress, mockGetSwapState } = vi.hoisted(() => ({
  mockRunK8sCommand: vi.fn(),
  mockZeroDowntimeScale: vi.fn(),
  mockIsSwapInProgress: vi.fn(),
  mockGetSwapState: vi.fn(),
}));

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: mockRunK8sCommand,
}));

vi.mock('@/lib/zero-downtime-scaler', () => ({
  zeroDowntimeScale: mockZeroDowntimeScale,
  isSwapInProgress: mockIsSwapInProgress,
  getSwapState: mockGetSwapState,
}));

import {
  scaleOpGeth,
  isZeroDowntimeEnabled,
  setZeroDowntimeEnabled,
  setSimulationMode,
  getScalingState,
  updateScalingState,
} from '../k8s-scaler';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import { INITIAL_SWAP_STATE } from '@/types/zero-downtime';

describe('k8s-scaler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default state
    setZeroDowntimeEnabled(false);
    setSimulationMode(true); // default: simulation mode
    updateScalingState({
      currentVcpu: 1,
      currentMemoryGiB: 2,
      lastScalingTime: null,
      lastDecision: null,
      cooldownRemaining: 0,
      autoScalingEnabled: true,
    });
    mockGetSwapState.mockReturnValue({ ...INITIAL_SWAP_STATE });
    // Default mock for runK8sCommand (used by getCurrentVcpu in non-simulation mode)
    mockRunK8sCommand.mockResolvedValue({ stdout: "'1'", stderr: '' });
  });

  // ----------------------------------------------------------
  // Zero-downtime toggle
  // ----------------------------------------------------------

  describe('isZeroDowntimeEnabled / setZeroDowntimeEnabled', () => {
    it('should default to disabled', () => {
      expect(isZeroDowntimeEnabled()).toBe(false);
    });

    it('should enable zero-downtime mode', () => {
      setZeroDowntimeEnabled(true);
      expect(isZeroDowntimeEnabled()).toBe(true);
    });

    it('should disable zero-downtime mode', () => {
      setZeroDowntimeEnabled(true);
      setZeroDowntimeEnabled(false);
      expect(isZeroDowntimeEnabled()).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // scaleOpGeth with zero-downtime mode
  // ----------------------------------------------------------

  describe('scaleOpGeth (zero-downtime branch)', () => {
    beforeEach(() => {
      // Disable simulation mode so we hit the real/zero-downtime branch
      setSimulationMode(false);
      setZeroDowntimeEnabled(true);
    });

    it('should call zeroDowntimeScale when zero-downtime mode is enabled', async () => {
      mockZeroDowntimeScale.mockResolvedValue({
        success: true,
        totalDurationMs: 5000,
        phaseDurations: { creating_standby: 1000 },
        finalPhase: 'completed',
      });

      const result = await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      expect(result.success).toBe(true);
      expect(result.zeroDowntime).toBe(true);
      expect(result.rolloutPhase).toBe('completed');
      expect(result.rolloutDurationMs).toBe(5000);
      expect(result.message).toContain('Zero-Downtime');
      expect(mockZeroDowntimeScale).toHaveBeenCalledWith(4, 8, DEFAULT_SCALING_CONFIG);
      // kubectl patch should NOT be called — only getCurrentVcpu's get command is allowed
      const patchCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('patch statefulset')
      );
      expect(patchCalls.length).toBe(0);
    });

    it('should return failure when zeroDowntimeScale fails', async () => {
      mockZeroDowntimeScale.mockResolvedValue({
        success: false,
        totalDurationMs: 3000,
        phaseDurations: {},
        finalPhase: 'failed',
        error: 'Standby pod failed to become ready',
      });

      const result = await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      expect(result.success).toBe(false);
      expect(result.zeroDowntime).toBe(true);
      expect(result.error).toBe('Standby pod failed to become ready');
      expect(result.message).toContain('Zero-Downtime');
      expect(result.message).toContain('Failed');
    });

    it('should handle unexpected exceptions from zeroDowntimeScale', async () => {
      mockZeroDowntimeScale.mockRejectedValue(new Error('network failure'));

      const result = await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      expect(result.success).toBe(false);
      expect(result.zeroDowntime).toBe(true);
      expect(result.error).toBe('network failure');
    });

    it('should update scaling state on success', async () => {
      mockZeroDowntimeScale.mockResolvedValue({
        success: true,
        totalDurationMs: 5000,
        phaseDurations: {},
        finalPhase: 'completed',
      });

      await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      const state = getScalingState();
      expect(state.currentVcpu).toBe(4);
      expect(state.currentMemoryGiB).toBe(8);
      expect(state.lastScalingTime).not.toBeNull();
    });

    it('should not update scaling state on failure', async () => {
      const stateBefore = getScalingState();
      const vcpuBefore = stateBefore.currentVcpu;

      mockZeroDowntimeScale.mockResolvedValue({
        success: false,
        totalDurationMs: 1000,
        phaseDurations: {},
        finalPhase: 'failed',
        error: 'some error',
      });

      await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      const stateAfter = getScalingState();
      expect(stateAfter.currentVcpu).toBe(vcpuBefore);
    });
  });

  // ----------------------------------------------------------
  // scaleOpGeth without zero-downtime mode (legacy kubectl patch)
  // ----------------------------------------------------------

  describe('scaleOpGeth (legacy branch)', () => {
    beforeEach(() => {
      setSimulationMode(false);
      setZeroDowntimeEnabled(false);
    });

    it('should use kubectl patch when zero-downtime mode is disabled', async () => {
      mockRunK8sCommand.mockResolvedValue({ stdout: "'1'", stderr: '' });

      const result = await scaleOpGeth(4, 8, DEFAULT_SCALING_CONFIG);

      expect(result.success).toBe(true);
      expect(result.zeroDowntime).toBeUndefined();
      expect(mockZeroDowntimeScale).not.toHaveBeenCalled();

      // Should have called kubectl patch (after getCurrentVcpu get call)
      const patchCalls = mockRunK8sCommand.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('patch statefulset')
      );
      expect(patchCalls.length).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // scaleOpGeth guards (range, cooldown, same-value skip)
  // ----------------------------------------------------------

  describe('scaleOpGeth (guards)', () => {
    it('should reject out of range vCPU', async () => {
      const result = await scaleOpGeth(999, 1998, DEFAULT_SCALING_CONFIG);
      expect(result.success).toBe(false);
      expect(result.error).toBe('OUT_OF_RANGE');
    });

    it('should skip scaling when already at target (simulation mode)', async () => {
      setSimulationMode(true);
      // State defaults to 1 vCPU — scaling to 1 should be a no-op
      const result = await scaleOpGeth(1, 2, DEFAULT_SCALING_CONFIG);
      expect(result.success).toBe(true);
      expect(result.message).toContain('No scaling needed');
    });
  });
});
