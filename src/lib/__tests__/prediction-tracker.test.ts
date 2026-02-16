/**
 * Unit tests for prediction-tracker module
 * Tests prediction recording and accuracy tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as predictionTracker from '@/lib/prediction-tracker';
import type { PredictionResult, PredictionRecord } from '@/types/prediction';

// Mock redis-store
vi.mock('@/lib/redis-store', () => {
  let predictionRecords: PredictionRecord[] = [];

  return {
    getStore: () => ({
      addPredictionRecord: async (record: PredictionRecord) => {
        predictionRecords.push(record);
      },
      getPredictionRecords: async (limit: number = 20) => {
        return predictionRecords.slice(0, limit);
      },
      updatePredictionRecord: async (id: string, updates: Partial<PredictionRecord>) => {
        const index = predictionRecords.findIndex((r) => r.id === id);
        if (index >= 0) {
          predictionRecords[index] = { ...predictionRecords[index], ...updates };
        }
      },
      clearPredictionRecords: async () => {
        predictionRecords = [];
      },
    }),
  };
});

/**
 * Helper: Create mock prediction result
 */
function createPrediction(overrides?: Partial<PredictionResult>): PredictionResult {
  return {
    predictedVcpu: 4,
    confidence: 0.85,
    reason: 'CPU trending up',
    ...overrides,
  };
}

describe('prediction-tracker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await predictionTracker.clearPredictionRecords();
  });

  describe('Recording Predictions', () => {
    it('should record a new prediction', async () => {
      const prediction = createPrediction();

      const id = await predictionTracker.recordPrediction(prediction);

      expect(id).toBeTruthy();
      expect(id).toMatch(/^pred_/);
    });

    it('should generate unique IDs for consecutive predictions', async () => {
      const prediction1 = createPrediction({ predictedVcpu: 2 });
      const prediction2 = createPrediction({ predictedVcpu: 4 });

      const id1 = await predictionTracker.recordPrediction(prediction1);
      const id2 = await predictionTracker.recordPrediction(prediction2);

      expect(id1).not.toBe(id2);
    });

    it('should store prediction with undefined actual vCPU initially', async () => {
      const prediction = createPrediction();

      const id = await predictionTracker.recordPrediction(prediction);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].id).toBe(id);
      expect(records[0].actualVcpu).toBeUndefined();
      expect(records[0].wasAccurate).toBeUndefined();
    });

    it('should record multiple predictions', async () => {
      for (let i = 0; i < 5; i++) {
        await predictionTracker.recordPrediction(
          createPrediction({ predictedVcpu: 1 + (i % 3) })
        );
      }

      const records = await predictionTracker.getPredictionRecords(10);

      expect(records).toHaveLength(5);
    });
  });

  describe('Recording Actual Outcomes', () => {
    it('should record actual vCPU for existing prediction', async () => {
      const prediction = createPrediction({ predictedVcpu: 4 });
      const id = await predictionTracker.recordPrediction(prediction);

      const success = await predictionTracker.recordActual(id, 4);

      expect(success).toBe(true);
    });

    it('should mark prediction accurate when diff <= 1', async () => {
      const prediction = createPrediction({ predictedVcpu: 2 });
      const id = await predictionTracker.recordPrediction(prediction);

      await predictionTracker.recordActual(id, 2);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].wasAccurate).toBe(true);
    });

    it('should mark prediction accurate when predicted=2, actual=3 (diff=1)', async () => {
      const prediction = createPrediction({ predictedVcpu: 2 });
      const id = await predictionTracker.recordPrediction(prediction);

      await predictionTracker.recordActual(id, 3);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].wasAccurate).toBe(true);
    });

    it('should mark prediction inaccurate when diff > 1', async () => {
      const prediction = createPrediction({ predictedVcpu: 1 });
      const id = await predictionTracker.recordPrediction(prediction);

      await predictionTracker.recordActual(id, 4);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].wasAccurate).toBe(false);
    });

    it('should set verifiedAt timestamp', async () => {
      const prediction = createPrediction();
      const id = await predictionTracker.recordPrediction(prediction);

      await predictionTracker.recordActual(id, 2);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].verifiedAt).toBeTruthy();
    });

    it('should return false for non-existent prediction ID', async () => {
      const success = await predictionTracker.recordActual('non-existent-id', 2);

      expect(success).toBe(false);
    });

    it('should handle all vCPU tier values (1, 2, 4)', async () => {
      for (const vcpu of [1, 2, 4] as const) {
        const prediction = createPrediction({ predictedVcpu: vcpu });
        const id = await predictionTracker.recordPrediction(prediction);

        const success = await predictionTracker.recordActual(id, vcpu);

        expect(success).toBe(true);
      }
    });
  });

  describe('Recording Recent Actual', () => {
    it('should record actual for most recent unverified prediction', async () => {
      const prediction1 = createPrediction({ predictedVcpu: 2 });
      const prediction2 = createPrediction({ predictedVcpu: 4 });

      await predictionTracker.recordPrediction(prediction1);
      await predictionTracker.recordPrediction(prediction2);

      const success = await predictionTracker.recordActualForRecent(4);

      expect(success).toBe(true);
      const records = await predictionTracker.getPredictionRecords(10);
      expect(records[0].actualVcpu).toBe(4); // Most recent should be updated
    });

    it('should return false when no unverified predictions exist', async () => {
      const prediction = createPrediction();
      const id = await predictionTracker.recordPrediction(prediction);

      // Verify the prediction first
      await predictionTracker.recordActual(id, 2);

      // Try to record actual for recent (none exist)
      const success = await predictionTracker.recordActualForRecent(2);

      expect(success).toBe(false);
    });

    it('should skip already verified predictions', async () => {
      const prediction1 = createPrediction({ predictedVcpu: 2 });
      const prediction2 = createPrediction({ predictedVcpu: 4 });

      const id1 = await predictionTracker.recordPrediction(prediction1);
      await predictionTracker.recordPrediction(prediction2);

      // Verify first prediction
      await predictionTracker.recordActual(id1, 2);

      // Record recent should find second prediction
      const success = await predictionTracker.recordActualForRecent(4);

      expect(success).toBe(true);
    });
  });

  describe('Accuracy Calculation', () => {
    it('should calculate 0% accuracy with no verified predictions', async () => {
      const accuracy = await predictionTracker.getAccuracy();

      expect(accuracy.totalPredictions).toBe(0);
      expect(accuracy.verifiedPredictions).toBe(0);
      expect(accuracy.accuratePredictions).toBe(0);
      expect(accuracy.accuracyRate).toBe(0);
    });

    it('should calculate 100% accuracy when all correct', async () => {
      for (let i = 0; i < 5; i++) {
        const vcpu = 1 + (i % 3);
        const prediction = createPrediction({ predictedVcpu: vcpu as 1 | 2 | 4 });
        const id = await predictionTracker.recordPrediction(prediction);
        await predictionTracker.recordActual(id, vcpu as 1 | 2 | 4);
      }

      const accuracy = await predictionTracker.getAccuracy();

      expect(accuracy.accuracyRate).toBe(1.0); // 100%
      expect(accuracy.accuratePredictions).toBe(5);
    });

    it('should calculate 50% accuracy with mixed results', async () => {
      // 2 accurate predictions
      for (let i = 0; i < 2; i++) {
        const prediction = createPrediction({ predictedVcpu: 2 });
        const id = await predictionTracker.recordPrediction(prediction);
        await predictionTracker.recordActual(id, 2);
      }

      // 2 inaccurate predictions
      for (let i = 0; i < 2; i++) {
        const prediction = createPrediction({ predictedVcpu: 1 });
        const id = await predictionTracker.recordPrediction(prediction);
        await predictionTracker.recordActual(id, 4);
      }

      const accuracy = await predictionTracker.getAccuracy();

      expect(accuracy.accuracyRate).toBe(0.5); // 50%
      expect(accuracy.verifiedPredictions).toBe(4);
      expect(accuracy.accuratePredictions).toBe(2);
    });

    it('should count total including unverified predictions', async () => {
      for (let i = 0; i < 10; i++) {
        await predictionTracker.recordPrediction(createPrediction());
      }

      // Verify only 5
      const records = await predictionTracker.getPredictionRecords(10);
      for (let i = 0; i < 5; i++) {
        await predictionTracker.recordActual(records[i].id, 2);
      }

      const accuracy = await predictionTracker.getAccuracy();

      expect(accuracy.totalPredictions).toBe(10);
      expect(accuracy.verifiedPredictions).toBe(5);
    });

    it('should calculate recent accuracy (last 20)', async () => {
      // Create 30 predictions
      const recordIds: string[] = [];
      for (let i = 0; i < 30; i++) {
        const id = await predictionTracker.recordPrediction(createPrediction());
        recordIds.push(id);
      }

      // Verify first 10 as accurate, next 10 as inaccurate
      for (let i = 0; i < 10; i++) {
        await predictionTracker.recordActual(recordIds[i], 2);
      }
      for (let i = 10; i < 20; i++) {
        await predictionTracker.recordActual(recordIds[i], 4); // Inaccurate (diff > 1)
      }

      const accuracy = await predictionTracker.getAccuracy();

      // Recent accuracy should be based on last 20 verified (10 accurate, 10 inaccurate)
      expect(accuracy.recentAccuracy).toBe(0.5); // 50%
    });
  });

  describe('Retrieving Records', () => {
    it('should get prediction records up to limit', async () => {
      for (let i = 0; i < 30; i++) {
        await predictionTracker.recordPrediction(createPrediction());
      }

      const records = await predictionTracker.getPredictionRecords(10);

      expect(records).toHaveLength(10);
    });

    it('should return all records if less than limit', async () => {
      for (let i = 0; i < 5; i++) {
        await predictionTracker.recordPrediction(createPrediction());
      }

      const records = await predictionTracker.getPredictionRecords(20);

      expect(records).toHaveLength(5);
    });

    it('should get unverified predictions only', async () => {
      const id1 = await predictionTracker.recordPrediction(createPrediction());
      const id2 = await predictionTracker.recordPrediction(createPrediction());
      const id3 = await predictionTracker.recordPrediction(createPrediction());

      // Verify two predictions
      await predictionTracker.recordActual(id1, 2);
      await predictionTracker.recordActual(id2, 2);

      const unverified = await predictionTracker.getUnverifiedPredictions();

      expect(unverified).toHaveLength(1);
      expect(unverified[0].id).toBe(id3);
    });

    it('should return empty list when all verified', async () => {
      const id = await predictionTracker.recordPrediction(createPrediction());
      await predictionTracker.recordActual(id, 2);

      const unverified = await predictionTracker.getUnverifiedPredictions();

      expect(unverified).toHaveLength(0);
    });
  });

  describe('Integration: Full Prediction Lifecycle', () => {
    it('should track complete prediction lifecycle', async () => {
      // Record prediction
      const prediction = createPrediction({ predictedVcpu: 4, confidence: 0.92 });
      const id = await predictionTracker.recordPrediction(prediction);

      // Verify initial state
      let records = await predictionTracker.getPredictionRecords(1);
      expect(records[0].actualVcpu).toBeUndefined();

      // Record actual outcome
      await predictionTracker.recordActual(id, 4);

      // Verify final state
      records = await predictionTracker.getPredictionRecords(1);
      expect(records[0].actualVcpu).toBe(4);
      expect(records[0].wasAccurate).toBe(true);
      expect(records[0].verifiedAt).toBeTruthy();

      // Get accuracy
      const accuracy = await predictionTracker.getAccuracy();
      expect(accuracy.accuracyRate).toBe(1.0);
    });

    it('should handle multiple prediction tracking', async () => {
      // Create and verify multiple predictions
      const predictions = [
        { vcpu: 2, actual: 2, accurate: true },
        { vcpu: 4, actual: 2, accurate: false },
        { vcpu: 1, actual: 1, accurate: true },
        { vcpu: 2, actual: 3, accurate: true },
      ];

      for (const p of predictions) {
        const id = await predictionTracker.recordPrediction(
          createPrediction({ predictedVcpu: p.vcpu as 1 | 2 | 4 })
        );
        await predictionTracker.recordActual(id, p.actual as 1 | 2 | 4);
      }

      const accuracy = await predictionTracker.getAccuracy();

      expect(accuracy.totalPredictions).toBe(4);
      expect(accuracy.verifiedPredictions).toBe(4);
      expect(accuracy.accuratePredictions).toBe(3); // 3 out of 4
      expect(accuracy.accuracyRate).toBeCloseTo(0.75, 2); // 75%
    });
  });

  describe('Edge Cases', () => {
    it('should handle prediction with high confidence', async () => {
      const prediction = createPrediction({ confidence: 0.99 });

      await predictionTracker.recordPrediction(prediction);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].prediction.confidence).toBe(0.99);
    });

    it('should handle prediction with low confidence', async () => {
      const prediction = createPrediction({ confidence: 0.1 });

      await predictionTracker.recordPrediction(prediction);
      const records = await predictionTracker.getPredictionRecords(1);

      expect(records[0].prediction.confidence).toBe(0.1);
    });

    it('should clear all prediction records', async () => {
      for (let i = 0; i < 10; i++) {
        await predictionTracker.recordPrediction(createPrediction());
      }

      await predictionTracker.clearPredictionRecords();

      const records = await predictionTracker.getPredictionRecords(20);
      expect(records).toHaveLength(0);
    });

    it('should handle concurrent prediction recording', async () => {
      const promises = Array(10)
        .fill(null)
        .map(() => predictionTracker.recordPrediction(createPrediction()));

      const ids = await Promise.all(promises);

      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10); // All unique
    });
  });
});
