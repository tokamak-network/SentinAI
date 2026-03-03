/**
 * Outcome Tracker Tests
 *
 * Verifies outcome classification, billing event creation,
 * and experience recording integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock experience-store before import
const mockRecordExperience = vi.fn().mockResolvedValue({});

vi.mock('@/lib/experience-store', () => ({
  recordExperience: (...args: unknown[]) => mockRecordExperience(...args),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { classifyOutcome, createBillingEvent, trackOutcome } from '@/lib/outcome-tracker';

describe('outcome-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyOutcome', () => {
    it('should classify executed+passed as auto-resolved', () => {
      expect(classifyOutcome({ executed: true, passed: true })).toBe('auto-resolved');
    });

    it('should classify executed+failed as escalated', () => {
      expect(classifyOutcome({ executed: true, passed: false })).toBe('escalated');
    });

    it('should classify not-executed+passed as false-positive', () => {
      expect(classifyOutcome({ executed: false, passed: true })).toBe('false-positive');
    });

    it('should classify not-executed+failed as failed', () => {
      expect(classifyOutcome({ executed: false, passed: false })).toBe('failed');
    });
  });

  describe('createBillingEvent', () => {
    it('should create event with correct fields', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-1',
        outcomeType: 'auto-resolved',
      });

      expect(event.id).toBeDefined();
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(event.timestamp).toBeDefined();
      expect(event.eventType).toBe('operation-outcome');
      expect(event.outcomeType).toBe('auto-resolved');
      expect(event.instanceId).toBe('inst-1');
      expect(event.operationId).toBe('op-1');
      expect(event.value).toBe(1.0);
      expect(event.metadata).toEqual({});
    });

    it('should assign zero value to false-positives', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-2',
        outcomeType: 'false-positive',
      });
      expect(event.value).toBe(0);
    });

    it('should assign partial value to escalated outcomes', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-3',
        outcomeType: 'escalated',
      });
      expect(event.value).toBe(0.3);
    });

    it('should assign zero value to failed outcomes', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-4',
        outcomeType: 'failed',
      });
      expect(event.value).toBe(0);
    });

    it('should include custom metadata when provided', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-5',
        outcomeType: 'auto-resolved',
        metadata: { chain: 'thanos', region: 'ap-northeast-2' },
      });
      expect(event.metadata).toEqual({ chain: 'thanos', region: 'ap-northeast-2' });
    });
  });

  describe('trackOutcome', () => {
    it('should classify and create billing event', async () => {
      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-1',
        executed: true,
        passed: true,
        resolutionMs: 30000,
      });

      expect(event.outcomeType).toBe('auto-resolved');
      expect(event.value).toBe(1.0);
      expect(event.eventType).toBe('operation-outcome');
    });

    it('should classify escalated outcome correctly', async () => {
      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-2',
        executed: true,
        passed: false,
        resolutionMs: 60000,
      });

      expect(event.outcomeType).toBe('escalated');
      expect(event.value).toBe(0.3);
    });

    it('should classify false-positive outcome correctly', async () => {
      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-3',
        executed: false,
        passed: true,
        resolutionMs: 5000,
      });

      expect(event.outcomeType).toBe('false-positive');
      expect(event.value).toBe(0);
    });

    it('should classify failed outcome correctly', async () => {
      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-4',
        executed: false,
        passed: false,
        resolutionMs: 10000,
      });

      expect(event.outcomeType).toBe('failed');
      expect(event.value).toBe(0);
    });

    it('should not record experience when trigger info is absent', async () => {
      await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-5',
        executed: true,
        passed: true,
        resolutionMs: 30000,
      });

      expect(mockRecordExperience).not.toHaveBeenCalled();
    });

    it('should record experience when trigger info is provided', async () => {
      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-6',
        executed: true,
        passed: true,
        resolutionMs: 45000,
        trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
        action: 'scale_up',
        protocolId: 'opstack',
        metricsSnapshot: { cpuUsage: 85 },
      });

      expect(event.outcomeType).toBe('auto-resolved');
      expect(mockRecordExperience).toHaveBeenCalledOnce();
      expect(mockRecordExperience).toHaveBeenCalledWith({
        instanceId: 'inst-1',
        protocolId: 'opstack',
        category: 'anomaly-resolution',
        trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
        action: 'scale_up',
        outcome: 'success',
        resolutionMs: 45000,
        metricsSnapshot: { cpuUsage: 85 },
      });
    });

    it('should map escalated outcome to partial experience', async () => {
      await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-7',
        executed: true,
        passed: false,
        resolutionMs: 60000,
        trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.95 },
        action: 'scale_up',
        protocolId: 'opstack',
        metricsSnapshot: { gasUsedRatio: 0.95 },
      });

      expect(mockRecordExperience).toHaveBeenCalledOnce();
      expect(mockRecordExperience.mock.calls[0][0].outcome).toBe('partial');
    });

    it('should map failed outcome to failure experience', async () => {
      await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-8',
        executed: false,
        passed: false,
        resolutionMs: 10000,
        trigger: { type: 'z-score', metric: 'cpuUsage', value: 4.0 },
        action: 'scale_up',
      });

      expect(mockRecordExperience).toHaveBeenCalledOnce();
      expect(mockRecordExperience.mock.calls[0][0].outcome).toBe('failure');
      expect(mockRecordExperience.mock.calls[0][0].protocolId).toBe('unknown');
      expect(mockRecordExperience.mock.calls[0][0].metricsSnapshot).toEqual({});
    });

    it('should gracefully handle experience recording failure', async () => {
      mockRecordExperience.mockRejectedValueOnce(new Error('Redis connection failed'));

      const event = await trackOutcome({
        instanceId: 'inst-1',
        operationId: 'op-9',
        executed: true,
        passed: true,
        resolutionMs: 30000,
        trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
        action: 'scale_up',
      });

      // Should still return a valid billing event despite experience recording failure
      expect(event.outcomeType).toBe('auto-resolved');
      expect(event.value).toBe(1.0);
    });
  });
});
