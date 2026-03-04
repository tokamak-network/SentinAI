/**
 * Experience Transfer Protocol
 *
 * Enables new agent instances to bootstrap with patterns learned by
 * existing agents on the same protocol type. This is the core value
 * proposition of Agent-for-Hire: "Hire an experienced agent."
 *
 * Transfer flow:
 *   Agent(Thanos, 6 months) has 47 patterns
 *     → New OP Stack chain onboarding
 *     → bootstrapNewAgent() transfers 47 patterns at 50% confidence
 *     → Patterns validated on new chain → confidence restored to 100%
 *
 * Privacy model:
 *   Shared:     pattern schema + success rate + protocol type + occurrences
 *   Not shared: raw metrics, RPC URLs, operator identity, financial data
 */

import { getExperienceLog, recordExperience } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import logger from '@/lib/logger';
import type { ExperienceEntry, TransferablePattern, TransferResult } from '@/types/experience';

const MIN_CONFIDENCE = 0.7;
const MIN_OCCURRENCES = 5;
const CONFIDENCE_DISCOUNT = 0.5;

/**
 * Extract transferable patterns from a specific protocol's experience history.
 * Filters for high-confidence, well-tested patterns and strips instance-specific data.
 */
export async function extractTransferablePatterns(
  protocolId: string,
): Promise<TransferablePattern[]> {
  const allEntries = await getExperienceLog(5000);
  const protocolEntries = allEntries.filter(
    (e: ExperienceEntry) => e.protocolId === protocolId,
  );

  if (protocolEntries.length === 0) return [];

  const { patterns } = extractPatterns(protocolEntries, MIN_OCCURRENCES);

  return patterns
    .filter((p) => p.confidence >= MIN_CONFIDENCE && p.occurrences >= MIN_OCCURRENCES)
    .map((p) => ({
      signature: p.signature,
      trigger: p.trigger,
      action: p.action,
      successRate: p.successRate,
      occurrences: p.occurrences,
      confidence: p.confidence,
      sourceProtocol: protocolId,
    }));
}

/**
 * Bootstrap a new agent instance with patterns from an existing protocol.
 * Applies a 50% confidence discount — patterns must be re-validated on the new chain.
 */
export async function bootstrapNewAgent(
  instanceId: string,
  protocolId: string,
): Promise<TransferResult> {
  const patterns = await extractTransferablePatterns(protocolId);

  const discountedPatterns = patterns.map((p) => ({
    ...p,
    confidence: p.confidence * CONFIDENCE_DISCOUNT,
  }));

  // Record transfer event in experience store
  if (discountedPatterns.length > 0) {
    try {
      await recordExperience({
        instanceId,
        protocolId,
        category: 'remediation',
        trigger: { type: 'bootstrap', metric: 'experience-transfer', value: discountedPatterns.length },
        action: `transferred ${discountedPatterns.length} patterns from ${protocolId}`,
        outcome: 'success',
        resolutionMs: 0,
        metricsSnapshot: {
          patternsTransferred: discountedPatterns.length,
          discountApplied: CONFIDENCE_DISCOUNT,
        },
      });
    } catch (err) {
      logger.warn('[ExperienceTransfer] Failed to record transfer event', { error: err });
    }
  }

  logger.info('[ExperienceTransfer] Bootstrap complete', {
    instanceId,
    protocolId,
    patternsTransferred: discountedPatterns.length,
  });

  return {
    patternsTransferred: discountedPatterns.length,
    sourceProtocol: protocolId,
    discountApplied: CONFIDENCE_DISCOUNT,
    patterns: discountedPatterns,
  };
}
