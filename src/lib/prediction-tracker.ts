/**
 * Prediction Tracker Module
 * Tracks prediction accuracy by comparing predictions with actual outcomes
 */

import { PredictionResult, PredictionRecord } from '@/types/prediction';
import { TargetVcpu } from '@/types/scaling';

/** Maximum number of prediction records to keep */
const MAX_RECORDS = 100;

/** In-memory storage for prediction records */
let predictionRecords: PredictionRecord[] = [];

/** Counter for generating unique IDs */
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
export function recordPrediction(prediction: PredictionResult): string {
  const id = generateId();

  const record: PredictionRecord = {
    id,
    prediction,
    actualVcpu: undefined,
    wasAccurate: undefined,
    verifiedAt: undefined,
  };

  predictionRecords.push(record);

  // Evict oldest records if over capacity
  if (predictionRecords.length > MAX_RECORDS) {
    predictionRecords = predictionRecords.slice(-MAX_RECORDS);
  }

  return id;
}

/**
 * Record the actual outcome for a prediction
 *
 * @param id - The prediction ID to update
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether the record was found and updated
 */
export function recordActual(id: string, actualVcpu: TargetVcpu): boolean {
  const record = predictionRecords.find(r => r.id === id);

  if (!record) {
    console.warn(`Prediction record not found: ${id}`);
    return false;
  }

  record.actualVcpu = actualVcpu;
  record.verifiedAt = new Date().toISOString();

  // A prediction is "accurate" if within 1 vCPU of actual
  // e.g., predicted 2, actual 2 or 1 or 4 with small tolerance
  const diff = Math.abs(record.prediction.predictedVcpu - actualVcpu);
  record.wasAccurate = diff <= 1;

  return true;
}

/**
 * Record actual outcome for the most recent unverified prediction
 * Convenience method when we don't have the specific prediction ID
 *
 * @param actualVcpu - The actual vCPU that was needed
 * @returns Whether a record was found and updated
 */
export function recordActualForRecent(actualVcpu: TargetVcpu): boolean {
  // Find the most recent unverified prediction
  const record = [...predictionRecords]
    .reverse()
    .find(r => r.actualVcpu === undefined);

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
export function getAccuracy(): {
  totalPredictions: number;
  verifiedPredictions: number;
  accuratePredictions: number;
  accuracyRate: number;
  recentAccuracy: number;
} {
  const verified = predictionRecords.filter(r => r.wasAccurate !== undefined);
  const accurate = verified.filter(r => r.wasAccurate === true);

  // Recent accuracy (last 20 verified predictions)
  const recentVerified = verified.slice(-20);
  const recentAccurate = recentVerified.filter(r => r.wasAccurate === true);

  return {
    totalPredictions: predictionRecords.length,
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
export function getPredictionRecords(limit: number = 20): PredictionRecord[] {
  return [...predictionRecords].reverse().slice(0, limit);
}

/**
 * Get unverified predictions (predictions awaiting actual outcomes)
 *
 * @returns Array of unverified prediction records
 */
export function getUnverifiedPredictions(): PredictionRecord[] {
  return predictionRecords.filter(r => r.actualVcpu === undefined);
}

/**
 * Clear all prediction records (for testing)
 */
export function clearPredictionRecords(): void {
  predictionRecords = [];
  idCounter = 0;
}
