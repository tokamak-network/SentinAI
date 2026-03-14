import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IncidentPatternSchema,
  EvolvedPlaybookSchema,
  IncidentPattern,
} from '../types/playbook-evolution';
import { PatternMiner, type OperationRecord } from './pattern-miner';
import type { IStateStore } from '../../types/redis';
import type { Redis } from 'ioredis';

describe('Playbook Evolution Types', () => {
  it('should validate IncidentPattern with required fields', () => {
    const pattern = {
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 85,
      executionCount: 42,
      avgDuration: 8500,
      correlationStrength: 0.92,
    };

    const result = IncidentPatternSchema.safeParse(pattern);
    expect(result.success).toBe(true);
  });

  it('should reject pattern with invalid successRate', () => {
    const pattern = {
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 105, // Invalid: > 100
      executionCount: 42,
      avgDuration: 8500,
      correlationStrength: 0.92,
    };

    const result = IncidentPatternSchema.safeParse(pattern);
    expect(result.success).toBe(false);
  });

  it('should validate EvolvedPlaybook with all Phase 6 fields', () => {
    const playbook = {
      id: 'pb-001',
      name: 'Optimized High CPU Response',
      description: 'Auto-generated v1',
      actions: [
        { type: 'scale', target: 'sequencer', params: { replicas: 5 }, timeout: 30000 },
      ],
      fallbacks: [
        { type: 'drain', target: 'sequencer', timeout: 15000 },
      ],
      timeout: 60000,
      versionId: 'v-1',
      parentVersionId: 'v-0',
      generatedAt: new Date(),
      generatedBy: 'claude-sonnet-4-5-20250929',
      confidenceSource: 'llm_generation',
      generationPromptUsage: {
        inputTokens: 4200,
        outputTokens: 1850,
        totalCost: 0.042,
      },
      patternContext: {
        patterns: [],
        successRateBaseline: 78,
      },
    };

    const result = EvolvedPlaybookSchema.safeParse(playbook);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// PatternMiner Tests
// ============================================================

describe('PatternMiner', () => {
  let mockStore: any;
  let mockRedis: any;
  let miner: PatternMiner;

  beforeEach(() => {
    mockStore = {
      getOperationRecordCount: vi.fn().mockResolvedValue(0),
      getLastEvolutionTime: vi.fn().mockResolvedValue(0),
      getOperationRecords: vi.fn().mockResolvedValue([]),
      setLastEvolutionTime: vi.fn().mockResolvedValue(undefined),
    };

    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
    };

    miner = new PatternMiner(mockStore as IStateStore, mockRedis as Redis);
  });

  it('should extract patterns from 20+ operation records', async () => {
    // Simulate 25 successful "scale_up" executions for high_cpu
    const records: OperationRecord[] = Array(25)
      .fill(null)
      .map((_, i) => ({
        id: `op-${i}`,
        anomalyType: 'high_cpu',
        executedAction: 'scale_up',
        success: true,
        duration: 8000 + Math.random() * 2000,
      }));

    const patterns = await miner.analyzeRecords(records);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 100,
      executionCount: 25,
    });
  });

  it('should handle mixed success and failure records', async () => {
    const records: OperationRecord[] = [
      ...Array(15)
        .fill(null)
        .map((_, i) => ({
          id: `op-${i}`,
          anomalyType: 'high_cpu',
          executedAction: 'scale_up',
          success: true,
          duration: 8000 + Math.random() * 2000,
        })),
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `op-fail-${i}`,
          anomalyType: 'high_cpu',
          executedAction: 'scale_up',
          success: false,
          duration: 5000 + Math.random() * 1000,
        })),
    ];

    const patterns = await miner.analyzeRecords(records);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.successRate).toBe(75);
    expect(patterns[0]?.executionCount).toBe(20);
  });

  it('should group patterns by anomalyType and action', async () => {
    const records: OperationRecord[] = [
      ...Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `op-cpu-${i}`,
          anomalyType: 'high_cpu',
          executedAction: 'scale_up',
          success: true,
          duration: 8000,
        })),
      ...Array(8)
        .fill(null)
        .map((_, i) => ({
          id: `op-mem-${i}`,
          anomalyType: 'high_memory',
          executedAction: 'scale_up',
          success: true,
          duration: 7000,
        })),
      ...Array(6)
        .fill(null)
        .map((_, i) => ({
          id: `op-latency-${i}`,
          anomalyType: 'high_latency',
          executedAction: 'drain',
          success: true,
          duration: 6000,
        })),
    ];

    const patterns = await miner.analyzeRecords(records);
    expect(patterns).toHaveLength(3);

    const cpuPattern = patterns.find(p => p.anomalyType === 'high_cpu');
    expect(cpuPattern?.effectiveAction).toBe('scale_up');
    expect(cpuPattern?.executionCount).toBe(10);

    const memPattern = patterns.find(p => p.anomalyType === 'high_memory');
    expect(memPattern?.effectiveAction).toBe('scale_up');
    expect(memPattern?.executionCount).toBe(8);

    const latencyPattern = patterns.find(p => p.anomalyType === 'high_latency');
    expect(latencyPattern?.effectiveAction).toBe('drain');
    expect(latencyPattern?.executionCount).toBe(6);
  });

  it('should return empty array for empty records', async () => {
    const patterns = await miner.analyzeRecords([]);
    expect(patterns).toEqual([]);
  });

  it('should trigger evolution on 20+ records', async () => {
    (mockStore.getOperationRecordCount as any).mockResolvedValue(20);
    const shouldTrigger = await miner.shouldTriggerEvolution();
    expect(shouldTrigger).toBe(true);
  });

  it('should trigger evolution on 4h+ elapsed time', async () => {
    (mockStore.getOperationRecordCount as any).mockResolvedValue(5);
    (mockStore.getLastEvolutionTime as any).mockResolvedValue(
      Date.now() - 5 * 60 * 60 * 1000
    );
    const shouldTrigger = await miner.shouldTriggerEvolution();
    expect(shouldTrigger).toBe(true);
  });

  it('should not trigger evolution with <20 records and <4h elapsed', async () => {
    (mockStore.getOperationRecordCount as any).mockResolvedValue(10);
    (mockStore.getLastEvolutionTime as any).mockResolvedValue(
      Date.now() - 30 * 60 * 1000 // 30 minutes
    );
    const shouldTrigger = await miner.shouldTriggerEvolution();
    expect(shouldTrigger).toBe(false);
  });

  it('should store patterns in Redis with 24h TTL', async () => {
    const patterns: IncidentPattern[] = [
      {
        anomalyType: 'high_cpu',
        effectiveAction: 'scale_up',
        successRate: 90,
        executionCount: 50,
        avgDuration: 8200,
        correlationStrength: 0.92,
      },
    ];

    await miner.storePatterns(patterns);
    expect(mockRedis.setex).toHaveBeenCalled();

    const call = (mockRedis.setex as any).mock.calls[0];
    expect(call[0]).toContain('marketplace:patterns:');
    expect(call[1]).toBe(24 * 60 * 60); // 24 hours in seconds
    expect(typeof call[2]).toBe('string'); // JSON string
  });

  it('should handle Redis errors gracefully in storePatterns', async () => {
    (mockRedis.setex as any).mockRejectedValueOnce(new Error('Redis error'));
    const patterns: IncidentPattern[] = [
      {
        anomalyType: 'high_cpu',
        effectiveAction: 'scale_up',
        successRate: 90,
        executionCount: 50,
        avgDuration: 8200,
        correlationStrength: 0.92,
      },
    ];

    await expect(miner.storePatterns(patterns)).rejects.toThrow('Redis error');
  });

  it('should handle store errors gracefully in shouldTriggerEvolution', async () => {
    (mockStore.getOperationRecordCount as any).mockRejectedValueOnce(
      new Error('Store error')
    );
    const shouldTrigger = await miner.shouldTriggerEvolution();
    expect(shouldTrigger).toBe(false);
  });

  it('should execute analyzeAndEvolve pipeline successfully', async () => {
    const records: OperationRecord[] = Array(25)
      .fill(null)
      .map((_, i) => ({
        id: `op-${i}`,
        anomalyType: 'high_cpu',
        executedAction: 'scale_up',
        success: true,
        duration: 8000,
      }));

    (mockStore.getOperationRecordCount as any).mockResolvedValue(25);
    (mockStore.getLastEvolutionTime as any).mockResolvedValue(0);
    (mockStore.getOperationRecords as any).mockResolvedValue(records);

    const patterns = await miner.analyzeAndEvolve();
    expect(patterns).not.toBeNull();
    expect(patterns).toHaveLength(1);
    expect((mockStore.setLastEvolutionTime as any)).toHaveBeenCalledWith(
      expect.any(Number)
    );
  });

  it('should return null from analyzeAndEvolve if no trigger', async () => {
    (mockStore.getOperationRecordCount as any).mockResolvedValue(5);
    (mockStore.getLastEvolutionTime as any).mockResolvedValue(Date.now());

    const patterns = await miner.analyzeAndEvolve();
    expect(patterns).toBeNull();
  });

  it('should return null from analyzeAndEvolve if no records', async () => {
    (mockStore.getOperationRecordCount as any).mockResolvedValue(20);
    (mockStore.getLastEvolutionTime as any).mockResolvedValue(0);
    (mockStore.getOperationRecords as any).mockResolvedValue([]);

    const patterns = await miner.analyzeAndEvolve();
    expect(patterns).toBeNull();
  });

  it('should return null from analyzeAndEvolve on error', async () => {
    (mockStore.getOperationRecordCount as any).mockRejectedValueOnce(
      new Error('Store error')
    );

    const patterns = await miner.analyzeAndEvolve();
    expect(patterns).toBeNull();
  });
});
