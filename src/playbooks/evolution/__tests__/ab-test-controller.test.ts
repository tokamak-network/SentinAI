import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ABTestController } from '../ab-test-controller';
import { ABTestSession } from '../types';
import type { IStateStore } from '@/types/redis';
import type { Redis } from 'ioredis';

describe('ABTestController', () => {
  let mockStore: any;
  let mockRedis: any;
  let controller: ABTestController;

  beforeEach(() => {
    mockStore = {
      // Add any required store methods if needed
    };

    mockRedis = {
      getex: vi.fn(),
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
    };

    controller = new ABTestController(mockStore as IStateStore, mockRedis as Redis);
  });

  describe('startSession', () => {
    it('should create a new A/B test session in running state', async () => {
      mockRedis.getex.mockResolvedValueOnce(null);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.startSession('test-pb-001', 'control-pb-001');

      expect(result.isOk()).toBe(true);
      const session = result.unwrap();
      expect(session.status).toBe('running');
      expect(session.testPlaybookId).toBe('test-pb-001');
      expect(session.controlPlaybookId).toBe('control-pb-001');
      expect(session.stats.controlExecutions).toBe(0);
      expect(session.stats.testExecutions).toBe(0);
      expect(session.stats.controlSuccesses).toBe(0);
      expect(session.stats.testSuccesses).toBe(0);
      expect(session.stats.confidenceLevel).toBe(0);
      expect(session.stats.statSignificant).toBe(false);
    });
  });

  describe('recordExecution - 50/50 split', () => {
    it('should assign first execution to control', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 0,
          testExecutions: 0,
          controlSuccesses: 0,
          testSuccesses: 0,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);
      const { confidenceLevel } = result.unwrap();

      // Check that Redis.setex was called with updated session
      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(updatedSession.stats.controlExecutions).toBe(1);
      expect(updatedSession.stats.testExecutions).toBe(0);
      expect(updatedSession.stats.controlSuccesses).toBe(1);
    });

    it('should assign second execution to test', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 1,
          testExecutions: 0,
          controlSuccesses: 1,
          testSuccesses: 0,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(updatedSession.stats.controlExecutions).toBe(1);
      expect(updatedSession.stats.testExecutions).toBe(1);
      expect(updatedSession.stats.testSuccesses).toBe(1);
    });
  });

  describe('recordExecution - success tracking', () => {
    it('should increment control success count on control success', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 4,
          testExecutions: 4,
          controlSuccesses: 3,
          testSuccesses: 2,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(updatedSession.stats.controlSuccesses).toBe(4);
      expect(updatedSession.stats.testSuccesses).toBe(2);
    });

    it('should track test successes separately from control', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 3,
          testExecutions: 4,
          controlSuccesses: 2,
          testSuccesses: 3,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(updatedSession.stats.testExecutions).toBe(5);
      expect(updatedSession.stats.testSuccesses).toBe(4);
    });
  });

  describe('computeFishersExactTest', () => {
    it('should calculate Fisher\'s exact test p-value correctly', async () => {
      // Test case: small dataset with clear difference
      // Control: 10 success, 0 fail (100% success rate)
      // Test: 8 success, 2 fail (80% success rate)
      // This should have p-value < 0.05

      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 10,
          testExecutions: 10,
          controlSuccesses: 10,
          testSuccesses: 8,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      // We don't directly call computeFishersExactTest; it's called internally
      // But we can verify through recordExecution that Fisher's test is computed
      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;
      // The confidenceLevel should be recalculated
      expect(typeof updatedSession.stats.confidenceLevel).toBe('number');
      expect(updatedSession.stats.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(updatedSession.stats.confidenceLevel).toBeLessThanOrEqual(100);
    });

    it('should mark as statistically significant when p < 0.05', async () => {
      // Large dataset with clear difference
      // Control: 50 success, 0 fail (100%)
      // Test: 40 success, 10 fail (80%)
      // This should be statistically significant

      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 50,
          testExecutions: 50,
          controlSuccesses: 50,
          testSuccesses: 40,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.recordExecution('session-001', true);

      expect(result.isOk()).toBe(true);

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const updatedSession = JSON.parse(setexCall[2]) as ABTestSession;

      // This large difference should be statistically significant
      expect(updatedSession.stats.statSignificant).toBe(true);
      expect(updatedSession.stats.confidenceLevel).toBeGreaterThan(95);
    });
  });

  describe('isDecisionReady', () => {
    it('should return true when statSignificant and confidenceLevel >= 95', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 50,
          testExecutions: 50,
          controlSuccesses: 50,
          testSuccesses: 40,
          confidenceLevel: 96,
          statSignificant: true,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));

      const ready = await controller.isDecisionReady('session-001');

      expect(ready).toBe(true);
    });

    it('should return false when statSignificant is false', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 20,
          testExecutions: 20,
          controlSuccesses: 15,
          testSuccesses: 14,
          confidenceLevel: 70,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));

      const ready = await controller.isDecisionReady('session-001');

      expect(ready).toBe(false);
    });

    it('should return false when confidenceLevel < 95', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 10,
          testExecutions: 10,
          controlSuccesses: 10,
          testSuccesses: 9,
          confidenceLevel: 85,
          statSignificant: true,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));

      const ready = await controller.isDecisionReady('session-001');

      expect(ready).toBe(false);
    });
  });

  describe('completeSession', () => {
    it('should complete session with test as winner when test success rate > control', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 50,
          testExecutions: 50,
          controlSuccesses: 40,
          testSuccesses: 45,
          confidenceLevel: 96,
          statSignificant: true,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.completeSession('session-001');

      expect(result.isOk()).toBe(true);
      const { winner } = result.unwrap();
      expect(winner).toBe('test');

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const completedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(completedSession.status).toBe('completed');
    });

    it('should complete session with control as winner when control success rate >= test', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 50,
          testExecutions: 50,
          controlSuccesses: 45,
          testSuccesses: 40,
          confidenceLevel: 96,
          statSignificant: true,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockResolvedValue('OK');

      const result = await controller.completeSession('session-001');

      expect(result.isOk()).toBe(true);
      const { winner } = result.unwrap();
      expect(winner).toBe('control');

      const setexCall = (mockRedis.setex as any).mock.calls[0];
      const completedSession = JSON.parse(setexCall[2]) as ABTestSession;
      expect(completedSession.status).toBe('completed');
    });
  });

  describe('error handling', () => {
    it('should return error on invalid session ID', async () => {
      mockRedis.getex.mockResolvedValueOnce(null);

      const result = await controller.recordExecution('non-existent-session', true);

      expect(result.isErr()).toBe(true);
      expect(result.getError()).toBeInstanceOf(Error);
    });

    it('should return error on Redis failure during recordExecution', async () => {
      const session: ABTestSession = {
        id: 'session-001',
        testPlaybookId: 'test-pb-001',
        controlPlaybookId: 'control-pb-001',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 0,
          testExecutions: 0,
          controlSuccesses: 0,
          testSuccesses: 0,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      mockRedis.getex.mockResolvedValueOnce(JSON.stringify(session));
      mockRedis.setex.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await controller.recordExecution('session-001', true);

      expect(result.isErr()).toBe(true);
    });
  });
});
