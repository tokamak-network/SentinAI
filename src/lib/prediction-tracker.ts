/**
 * Prediction Tracker Module (Redis-backed)
 * Tracks prediction accuracy by comparing predictions with actual outcomes
 */

import { PredictionResult, PredictionRecord } from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';
import { getStore } from '@/lib/redis-store';

let idCounter = 0;

/**
 * Generate a unique ID for a prediction record
 */
function generateId(): string {
  idCounter += 1;
  return `pred_${Date.now()}_${idCounter}`;
}

/**
 * Record a new prediction for later verification
 *
 * @param prediction - The prediction result to record
 * @returns The ID of the recorded prediction
 */
export async function recordPrediction(prediction: PredictionResult): Promise<string> {
  const id = generateId();

  const record: PredictionRecord = {
    id,
    prediction,
    actualVcpu: undefined,
    wasAccurate: undefined,
    verifiedAt: undefined,
  };

  const store = getStore();
  await store.addPredictionRecord(record);

  return id;
}

/**
 * Record the actual outcome for a prediction
 *
 * @param id - The prediction ID to update
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether the record was found and updated
 */
export async function recordActual(id: string, actualVcpu: TargetVcpu): Promise<boolean> {
  const store = getStore();
  const records = await store.getPredictionRecords(100);
  const record = records.find((r) => r.id === id);

  if (!record) {
    console.warn(`Prediction record not found: ${id}`);
    return false;
  }

  const diff = Math.abs(record.prediction.predictedVcpu - actualVcpu);

  await store.updatePredictionRecord(id, {
    actualVcpu,
    verifiedAt: new Date().toISOString(),
    wasAccurate: diff <= 1,
  });

  return true;
}

/**
 * Record actual outcome for the most recent unverified prediction
 * Convenience method when we don't have the specific prediction ID
 *
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether a record was found and updated
 */
export async function recordActualForRecent(actualVcpu: TargetVcpu): Promise<boolean> {
  const store = getStore();
  const records = await store.getPredictionRecords(100);
  const record = records.find((r) => r.actualVcpu === undefined);

  if (!record) {
    return false;
  }

  return recordActual(record.id, actualVcpu);
}

/**
 * Calculate prediction accuracy statistics
 *
 * @returns Accuracy statistics
 */
export async function getAccuracy(): Promise<{
  totalPredictions: number;
  verifiedPredictions: number;
  accuratePredictions: number;
  accuracyRate: number;
  recentAccuracy: number;
}> {
  const store = getStore();
  const records = await store.getPredictionRecords(100);

  const verified = records.filter((r) => r.wasAccurate !== undefined);
  const accurate = verified.filter((r) => r.wasAccurate === true);

  // Recent accuracy (last 20 verified predictions)
  const recentVerified = verified.slice(0, 20);
  const recentAccurate = recentVerified.filter((r) => r.wasAccurate === true);

  return {
    totalPredictions: records.length,
    verifiedPredictions: verified.length,
    accuratePredictions: accurate.length,
    accuracyRate: verified.length > 0 ? accurate.length / verified.length : 0,
    recentAccuracy: recentVerified.length > 0 ? recentAccurate.length / recentVerified.length : 0,
  };
}

/**
 * Get all prediction records
 *
 * @param limit - Maximum number of records to return
 * @returns Array of prediction records, newest first
 */
export async function getPredictionRecords(limit: number = 20): Promise<PredictionRecord[]> {
  const store = getStore();
  return store.getPredictionRecords(limit);
}

/**
 * Get unverified predictions (predictions awaiting actual outcomes)
 *
 * @returns Array of unverified prediction records
 */
export async function getUnverifiedPredictions(): Promise<PredictionRecord[]> {
  const store = getStore();
  const records = await store.getPredictionRecords(100);
  return records.filter((r) => r.actualVcpu === undefined);
}

/**
 * Clear all prediction records (for testing)
 */
export async function clearPredictionRecords(): Promise<void> {
  const store = getStore();
  await store.clearPredictionRecords();
}
