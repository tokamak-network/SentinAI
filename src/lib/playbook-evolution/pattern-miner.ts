/**
 * PatternMiner: Learns patterns from operation records
 *
 * Analyzes historical execution data to extract effective incident response patterns.
 * Triggers evolution when threshold (20 records OR 4h elapsed) is met.
 */

import { IncidentPattern, IncidentPatternSchema } from '../types/playbook-evolution';
import type { IStateStore } from '../../types/redis';
import type { Redis } from 'ioredis';

const RECORD_THRESHOLD = 20;
const TIME_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours
const PATTERN_TTL = 24 * 60 * 60; // 24 hours in seconds

/**
 * OperationRecord: Historical record of an executed incident response
 */
export interface OperationRecord {
  id: string;
  anomalyType: string;
  executedAction: string;
  success: boolean;
  duration: number;
}

/**
 * PatternMiner: Learns from operation history
 *
 * Groups operations by (anomalyType, effectiveAction) and calculates:
 * - Success rate (percentage of successful executions)
 * - Execution count (frequency of the pattern)
 * - Average duration (typical execution time)
 * - Correlation strength (confidence in the pattern)
 */
export class PatternMiner {
  constructor(
    private store: IStateStore,
    private redis: Redis
  ) {}

  /**
   * Determine if evolution should be triggered based on record count or time
   */
  async shouldTriggerEvolution(): Promise<boolean> {
    try {
      const getRecordCount = (this.store as any).getOperationRecordCount as
        | (() => Promise<number>)
        | undefined;
      const getLastTime = (this.store as any).getLastEvolutionTime as
        | (() => Promise<number>)
        | undefined;

      const recordCount = (await getRecordCount?.()) ?? 0;
      const lastEvolutionTime = (await getLastTime?.()) ?? 0;
      const timeSinceLastEvolution = Date.now() - lastEvolutionTime;

      return recordCount >= RECORD_THRESHOLD || timeSinceLastEvolution >= TIME_THRESHOLD;
    } catch (err) {
      console.error('[PatternMiner] shouldTriggerEvolution error:', err);
      return false; // Fail safely: don't trigger on error
    }
  }

  /**
   * Analyze operation records to extract patterns
   * Groups by (anomalyType, effectiveAction) and calculates metrics
   */
  async analyzeRecords(records: OperationRecord[]): Promise<IncidentPattern[]> {
    if (records.length === 0) return [];

    // Group by (anomalyType, action)
    const groups = new Map<string, OperationRecord[]>();
    for (const rec of records) {
      const key = `${rec.anomalyType}:${rec.executedAction}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(rec);
    }

    // Calculate metrics per group
    const patterns: IncidentPattern[] = [];
    for (const [key, groupRecords] of groups) {
      const [anomalyType, action] = key.split(':');
      const successCount = groupRecords.filter(r => r.success).length;
      const successRate = (successCount / groupRecords.length) * 100;
      const avgDuration =
        groupRecords.reduce((sum, r) => sum + r.duration, 0) / groupRecords.length;

      const pattern: IncidentPattern = {
        anomalyType,
        effectiveAction: action,
        successRate,
        executionCount: groupRecords.length,
        avgDuration,
        correlationStrength: Math.min(
          1,
          successCount / Math.max(5, groupRecords.length / 2)
        ),
      };

      const result = IncidentPatternSchema.safeParse(pattern);
      if (result.success) {
        patterns.push(result.data);
      }
    }

    return patterns;
  }

  /**
   * Store patterns in Redis with TTL
   */
  async storePatterns(patterns: IncidentPattern[]): Promise<void> {
    try {
      const timestamp = Date.now();
      const key = `marketplace:patterns:${timestamp}`;
      const value = JSON.stringify(patterns);
      await this.redis.setex(key, PATTERN_TTL, value);
    } catch (err) {
      console.error('[PatternMiner] storePatterns error:', err);
      throw err;
    }
  }

  /**
   * Full analyze-and-store pipeline
   *
   * Returns patterns if evolution triggered and patterns found, null otherwise.
   */
  async analyzeAndEvolve(): Promise<IncidentPattern[] | null> {
    try {
      const shouldTrigger = await this.shouldTriggerEvolution();
      if (!shouldTrigger) {
        return null;
      }

      // Fetch recent operation records (max 100)
      const getRecords = (this.store as any).getOperationRecords as
        | ((opts: { limit: number }) => Promise<OperationRecord[]>)
        | undefined;
      const records = (await getRecords?.({ limit: 100 })) ?? [];
      if (records.length === 0) {
        return null;
      }

      const patterns = await this.analyzeRecords(records);
      if (patterns.length > 0) {
        await this.storePatterns(patterns);
      }

      // Update evolution timestamp
      const setLastTime = (this.store as any).setLastEvolutionTime as
        | ((time: number) => Promise<void>)
        | undefined;
      await setLastTime?.(Date.now());

      return patterns.length > 0 ? patterns : null;
    } catch (err) {
      console.error('[PatternMiner] analyzeAndEvolve error:', err);
      return null; // Non-blocking: return null on error
    }
  }
}
