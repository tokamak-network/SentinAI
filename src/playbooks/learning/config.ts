/**
 * Playbook Evolution Configuration
 *
 * Centralizes confidence thresholds and ledger limits so that
 * both playbook-generator and learning-feedback-loop share the same values.
 */
import type { PlaybookReviewStatus } from './types';

export const APPROVED_THRESHOLD = Number(process.env.PLAYBOOK_APPROVED_THRESHOLD) || 0.6;
export const PENDING_THRESHOLD = 0.4;

export function inferStatus(confidence: number): PlaybookReviewStatus {
  if (confidence < PENDING_THRESHOLD) return 'draft';
  if (confidence < APPROVED_THRESHOLD) return 'pending';
  return 'approved';
}
