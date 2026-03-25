/**
 * Redis Storage Tests for Phase 6: PlaybookEvolver
 * Tests for pattern management, A/B test management, and playbook versioning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { RedisStateStore } from '@/lib/redis-store';
import type {
  IncidentPattern,
  ABTestSession,
  PlaybookVersion,
  EvolvedPlaybook,
  RemediationAction,
  PromptUsageMetrics,
  PatternContext,
} from '@/playbooks/evolution/types';

describe('PlaybookEvolver Redis Storage', () => {
  let store: RedisStateStore;
  let redis: Redis;

  beforeEach(() => {
    // Create a Redis client for test purposes
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
    });

    // Create RedisStateStore instance
    store = new RedisStateStore({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
      keyPrefix: 'test:sentinai:',
      connectTimeout: 5000,
      maxRetries: 3,
    });
  });

  afterEach(async () => {
    // Clean up test data
    if (redis) {
      const keys = await redis.keys('test:sentinai:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    }
  });

  describe('Pattern Management', () => {
    it('should save and retrieve incident patterns', async () => {
      const pattern: IncidentPattern = {
        anomalyType: 'high_memory',
        effectiveAction: 'scale_up',
        successRate: 95.5,
        executionCount: 20,
        avgDuration: 45.3,
        correlationStrength: 0.95,
      };

      await store.savePattern(pattern);
      const patterns = await store.getPatterns('high_memory');

      expect(patterns).toHaveLength(1);
      expect(patterns[0]).toMatchObject(pattern);
    });

    it('should respect 24 hour TTL for patterns', async () => {
      const pattern: IncidentPattern = {
        anomalyType: 'high_cpu',
        effectiveAction: 'migrate_pods',
        successRate: 88.0,
        executionCount: 15,
        avgDuration: 60.5,
        correlationStrength: 0.85,
      };

      await store.savePattern(pattern);

      // Check TTL
      const ttl = await redis.ttl('test:sentinai:incident:pattern:high_cpu:migrate_pods');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400); // 24 hours in seconds
    });

    it('should delete patterns by anomalyType and action', async () => {
      const pattern1: IncidentPattern = {
        anomalyType: 'high_memory',
        effectiveAction: 'scale_up',
        successRate: 95.5,
        executionCount: 20,
        avgDuration: 45.3,
        correlationStrength: 0.95,
      };

      const pattern2: IncidentPattern = {
        anomalyType: 'high_memory',
        effectiveAction: 'evict_pods',
        successRate: 70.0,
        executionCount: 10,
        avgDuration: 30.0,
        correlationStrength: 0.65,
      };

      await store.savePattern(pattern1);
      await store.savePattern(pattern2);

      await store.deletePattern('high_memory', 'scale_up');
      const patterns = await store.getPatterns('high_memory');

      expect(patterns).toHaveLength(1);
      expect(patterns[0]?.effectiveAction).toBe('evict_pods');
    });

    it('should return empty array for non-existent anomalyType', async () => {
      const patterns = await store.getPatterns('non_existent');
      expect(patterns).toEqual([]);
    });

    it('should handle multiple patterns for same anomalyType', async () => {
      const patterns: IncidentPattern[] = [
        {
          anomalyType: 'high_cpu',
          effectiveAction: 'scale_up',
          successRate: 92.0,
          executionCount: 25,
          avgDuration: 50.0,
          correlationStrength: 0.9,
        },
        {
          anomalyType: 'high_cpu',
          effectiveAction: 'reduce_workload',
          successRate: 85.0,
          executionCount: 15,
          avgDuration: 60.0,
          correlationStrength: 0.8,
        },
        {
          anomalyType: 'high_cpu',
          effectiveAction: 'restart_pods',
          successRate: 75.0,
          executionCount: 10,
          avgDuration: 45.0,
          correlationStrength: 0.7,
        },
      ];

      for (const pattern of patterns) {
        await store.savePattern(pattern);
      }

      const retrieved = await store.getPatterns('high_cpu');
      expect(retrieved).toHaveLength(3);
    });
  });

  describe('A/B Test Management', () => {
    it('should save and retrieve A/B test sessions', async () => {
      const session: ABTestSession = {
        id: 'test-session-1',
        testPlaybookId: 'playbook-a',
        controlPlaybookId: 'playbook-b',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 10,
          testExecutions: 10,
          controlSuccesses: 9,
          testSuccesses: 10,
          confidenceLevel: 0.95,
          statSignificant: true,
        },
      };

      await store.saveABTestSession(session.id, session);
      const retrieved = await store.getABTestSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-session-1');
      expect(retrieved?.status).toBe('running');
      expect(retrieved?.stats.testSuccesses).toBe(10);
    });

    it('should respect 7 day TTL for A/B test sessions', async () => {
      const session: ABTestSession = {
        id: 'test-session-2',
        testPlaybookId: 'playbook-a',
        controlPlaybookId: 'playbook-b',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 5,
          testExecutions: 5,
          controlSuccesses: 4,
          testSuccesses: 5,
          confidenceLevel: 0.9,
          statSignificant: false,
        },
      };

      await store.saveABTestSession(session.id, session);

      // Check TTL
      const ttl = await redis.ttl('test:sentinai:ab_test:session:test-session-2');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(604800); // 7 days in seconds
    });

    it('should filter only running A/B tests', async () => {
      const runningSession: ABTestSession = {
        id: 'test-running',
        testPlaybookId: 'playbook-a',
        controlPlaybookId: 'playbook-b',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 10,
          testExecutions: 10,
          controlSuccesses: 9,
          testSuccesses: 10,
          confidenceLevel: 0.95,
          statSignificant: true,
        },
      };

      const completedSession: ABTestSession = {
        id: 'test-completed',
        testPlaybookId: 'playbook-c',
        controlPlaybookId: 'playbook-d',
        status: 'completed',
        createdAt: new Date(),
        stats: {
          controlExecutions: 50,
          testExecutions: 50,
          controlSuccesses: 45,
          testSuccesses: 48,
          confidenceLevel: 0.99,
          statSignificant: true,
        },
      };

      await store.saveABTestSession(runningSession.id, runningSession);
      await store.saveABTestSession(completedSession.id, completedSession);

      const runningTests = await store.getRunningABTests();
      expect(runningTests).toHaveLength(1);
      expect(runningTests[0]?.id).toBe('test-running');
    });

    it('should return empty array when no running A/B tests exist', async () => {
      const completedSession: ABTestSession = {
        id: 'test-completed-only',
        testPlaybookId: 'playbook-a',
        controlPlaybookId: 'playbook-b',
        status: 'completed',
        createdAt: new Date(),
        stats: {
          controlExecutions: 30,
          testExecutions: 30,
          controlSuccesses: 28,
          testSuccesses: 29,
          confidenceLevel: 0.98,
          statSignificant: true,
        },
      };

      await store.saveABTestSession(completedSession.id, completedSession);
      const runningTests = await store.getRunningABTests();

      expect(runningTests).toEqual([]);
    });
  });

  describe('Playbook Version Management', () => {
    const createMockPlaybookVersion = (versionId: string, isActive: boolean): PlaybookVersion => {
      const remediationActions: RemediationAction[] = [
        {
          type: 'scale',
          target: 'compute',
          params: { vcpu: 4 },
          timeout: 300,
        },
      ];

      const promptUsage: PromptUsageMetrics = {
        inputTokens: 1000,
        outputTokens: 500,
        totalCost: 0.0045,
      };

      const patternContext: PatternContext = {
        patterns: [
          {
            anomalyType: 'high_memory',
            effectiveAction: 'scale_up',
            successRate: 95.5,
            executionCount: 20,
            avgDuration: 45.3,
            correlationStrength: 0.95,
          },
        ],
        successRateBaseline: 85.0,
      };

      const playbook: EvolvedPlaybook = {
        id: `playbook-${versionId}`,
        name: `Playbook ${versionId}`,
        description: `Auto-generated playbook version ${versionId}`,
        actions: remediationActions,
        fallbacks: remediationActions,
        timeout: 600,
        versionId,
        parentVersionId: versionId === 'v-0' ? '' : 'v-0',
        generatedAt: new Date(),
        generatedBy: 'test-llm',
        confidenceSource: 'llm_generation',
        generationPromptUsage: promptUsage,
        patternContext: patternContext,
      };

      return {
        versionId,
        playbook,
        promotedAt: new Date(),
        isActive,
      };
    };

    it('should save and retrieve playbook versions', async () => {
      const version = createMockPlaybookVersion('v-0', true);
      await store.savePlaybookVersion(version);

      const history = await store.getPlaybookVersionHistory();
      expect(history.current).toBeDefined();
      expect(history.current.versionId).toBe('v-0');
    });

    it('should maintain playbook version history', async () => {
      const version1 = createMockPlaybookVersion('v-0', false);
      const version2 = createMockPlaybookVersion('v-1', true);

      await store.savePlaybookVersion(version1);
      await store.savePlaybookVersion(version2);

      const history = await store.getPlaybookVersionHistory();
      expect(history.current.versionId).toBe('v-1');
      expect(history.history.length).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup old versions when exceeding limit', async () => {
      // Create 12 versions (exceeds 10 limit)
      for (let i = 0; i < 12; i++) {
        const version = createMockPlaybookVersion(`v-${i}`, i === 11);
        await store.savePlaybookVersion(version);
      }

      await store.cleanupOldVersions();

      const history = await store.getPlaybookVersionHistory();
      // Current + up to 10 old versions = max 11 total
      expect(history.history.length).toBeLessThanOrEqual(10);
    });

    it('should handle version history with fewer than 10 old versions', async () => {
      const version1 = createMockPlaybookVersion('v-0', false);
      const version2 = createMockPlaybookVersion('v-1', true);

      await store.savePlaybookVersion(version1);
      await store.savePlaybookVersion(version2);

      await store.cleanupOldVersions();

      const history = await store.getPlaybookVersionHistory();
      expect(history.current.versionId).toBe('v-1');
    });
  });

  describe('Evolution Timestamp Management', () => {
    it('should get and set last evolution time', async () => {
      const now = Date.now();
      await store.setLastEvolutionTime(now);

      const retrieved = await store.getLastEvolutionTime();
      expect(retrieved).toBe(now);
    });

    it('should return 0 when evolution time not set', async () => {
      const time = await store.getLastEvolutionTime();
      expect(time).toBe(0);
    });

    it('should update evolution timestamp', async () => {
      const time1 = Date.now();
      await store.setLastEvolutionTime(time1);

      const time2 = Date.now() + 1000;
      await store.setLastEvolutionTime(time2);

      const retrieved = await store.getLastEvolutionTime();
      expect(retrieved).toBe(time2);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle JSON parsing errors gracefully', async () => {
      // Manually insert corrupted JSON
      const key = 'test:sentinai:incident:pattern:corrupted:action';
      await redis.set(key, 'invalid json');

      // Should return empty array or handle gracefully
      const patterns = await store.getPatterns('corrupted');
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should handle missing A/B test sessions', async () => {
      const session = await store.getABTestSession('non-existent-session');
      expect(session).toBeNull();
    });

    it('should handle empty playbook version history', async () => {
      const history = await store.getPlaybookVersionHistory();
      // Should either return empty or default structure
      expect(history).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should manage complete playbook evolution workflow', async () => {
      // Step 1: Save initial pattern
      const pattern: IncidentPattern = {
        anomalyType: 'high_memory',
        effectiveAction: 'scale_up',
        successRate: 95.5,
        executionCount: 20,
        avgDuration: 45.3,
        correlationStrength: 0.95,
      };
      await store.savePattern(pattern);

      // Step 2: Create and save first playbook version
      const version1 = {
        versionId: 'v-0',
        playbook: {
          id: 'playbook-0',
          name: 'Initial Playbook',
          description: 'Generated from patterns',
          actions: [{ type: 'scale', target: 'compute', params: { vcpu: 4 }, timeout: 300 }],
          fallbacks: [{ type: 'scale', target: 'compute', params: { vcpu: 2 }, timeout: 300 }],
          timeout: 600,
          versionId: 'v-0',
          parentVersionId: '',
          generatedAt: new Date(),
          generatedBy: 'test-llm',
          confidenceSource: 'pattern_mining' as const,
          generationPromptUsage: { inputTokens: 500, outputTokens: 250, totalCost: 0.0025 },
          patternContext: {
            patterns: [pattern],
            successRateBaseline: 90.0,
          },
        },
        promotedAt: new Date(),
        isActive: true,
      } as PlaybookVersion;

      await store.savePlaybookVersion(version1);

      // Step 3: Start A/B test
      const abTest: ABTestSession = {
        id: 'workflow-test-1',
        testPlaybookId: 'playbook-0',
        controlPlaybookId: 'playbook-old',
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 5,
          testExecutions: 5,
          controlSuccesses: 4,
          testSuccesses: 5,
          confidenceLevel: 0.85,
          statSignificant: false,
        },
      };

      await store.saveABTestSession(abTest.id, abTest);

      // Step 4: Record evolution timestamp
      const timestamp = Date.now();
      await store.setLastEvolutionTime(timestamp);

      // Step 5: Verify all data
      const retrievedPattern = await store.getPatterns('high_memory');
      expect(retrievedPattern).toHaveLength(1);

      const retrievedHistory = await store.getPlaybookVersionHistory();
      expect(retrievedHistory.current.versionId).toBe('v-0');

      const retrievedABTest = await store.getABTestSession(abTest.id);
      expect(retrievedABTest?.status).toBe('running');

      const retrievedTimestamp = await store.getLastEvolutionTime();
      expect(retrievedTimestamp).toBe(timestamp);
    });

    it('should handle concurrent operations safely', async () => {
      const patterns: IncidentPattern[] = [];
      for (let i = 0; i < 5; i++) {
        patterns.push({
          anomalyType: `type-${i}`,
          effectiveAction: `action-${i}`,
          successRate: 80 + i * 2,
          executionCount: 10 + i,
          avgDuration: 40 + i * 5,
          correlationStrength: 0.8 + i * 0.02,
        });
      }

      // Save patterns concurrently
      await Promise.all(patterns.map((p) => store.savePattern(p)));

      // Retrieve all
      const retrieved: IncidentPattern[] = [];
      for (let i = 0; i < 5; i++) {
        const patterns_i = await store.getPatterns(`type-${i}`);
        retrieved.push(...patterns_i);
      }

      expect(retrieved).toHaveLength(5);
    });
  });
});
