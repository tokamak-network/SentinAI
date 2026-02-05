/**
 * Scaling Decision Module
 * Determine optimal vCPU by combining metrics and AI analysis results
 */

import {
  ScalingMetrics,
  ScalingDecision,
  TargetVcpu,
  AISeverity,
  ScalingConfig,
  DEFAULT_SCALING_CONFIG,
  AI_SEVERITY_SCORES,
} from '@/types/scaling';

/**
 * Calculate scaling score based on metrics (0-100)
 */
export function calculateScalingScore(
  metrics: ScalingMetrics,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): { score: number; breakdown: ScalingDecision['breakdown'] } {
  const { weights } = config;

  // CPU Score: 0-100% → 0-100
  const cpuScore = Math.min(metrics.cpuUsage, 100);

  // Gas Usage Score: 0-1 → 0-100
  const gasScore = Math.min(metrics.gasUsedRatio, 1) * 100;

  // TxPool Score: pending tx count / 200 (100 points if 200 or more)
  const txPoolScore = Math.min(metrics.txPoolPending / 200, 1) * 100;

  // AI Severity Score
  const aiScore = metrics.aiSeverity
    ? AI_SEVERITY_SCORES[metrics.aiSeverity]
    : 0;

  // Weighted Final Score
  const score =
    cpuScore * weights.cpu +
    gasScore * weights.gas +
    txPoolScore * weights.txPool +
    aiScore * weights.ai;

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      cpuScore: Math.round(cpuScore * 100) / 100,
      gasScore: Math.round(gasScore * 100) / 100,
      txPoolScore: Math.round(txPoolScore * 100) / 100,
      aiScore: Math.round(aiScore * 100) / 100,
    },
  };
}

/**
 * Determine target vCPU based on score
 */
export function determineTargetVcpu(
  score: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): TargetVcpu {
  const { thresholds } = config;

  if (score < thresholds.idle) {
    return 1;
  } else if (score < thresholds.normal) {
    return 2;
  } else {
    return 4;
  }
}

/**
 * Generate scaling decision reasoning
 */
export function generateReason(
  score: number,
  targetVcpu: TargetVcpu,
  breakdown: ScalingDecision['breakdown'],
  metrics: ScalingMetrics
): string {
  const parts: string[] = [];

  if (targetVcpu === 1) {
    parts.push('System Idle');
    if (breakdown.cpuScore < 20) parts.push(`CPU ${metrics.cpuUsage.toFixed(1)}% Low`);
    if (breakdown.txPoolScore < 10) parts.push('Low TxPool Pending');
  } else if (targetVcpu === 2) {
    parts.push('Normal Load Detected');
    if (breakdown.cpuScore >= 30) parts.push(`CPU ${metrics.cpuUsage.toFixed(1)}%`);
    if (breakdown.gasScore >= 30) parts.push(`Gas Usage ${(metrics.gasUsedRatio * 100).toFixed(1)}%`);
  } else {
    parts.push('High Load Detected');
    if (breakdown.cpuScore >= 60) parts.push(`CPU ${metrics.cpuUsage.toFixed(1)}% High`);
    if (breakdown.txPoolScore >= 50) parts.push(`TxPool ${metrics.txPoolPending} Pending`);
    if (breakdown.aiScore >= 66) parts.push('AI Warning: High Severity');
  }

  return parts.join(', ') + ` (Score: ${score.toFixed(1)})`;
}

/**
 * Calculate confidence (Based on metric completeness)
 */
export function calculateConfidence(metrics: ScalingMetrics): number {
  let confidence = 0.7; // Base confidence

  // +0.1 if CPU is within valid range
  if (metrics.cpuUsage >= 0 && metrics.cpuUsage <= 100) {
    confidence += 0.1;
  }

  // +0.15 if AI analysis result exists
  if (metrics.aiSeverity) {
    confidence += 0.15;
  }

  // +0.05 if TxPool data is positive
  if (metrics.txPoolPending >= 0) {
    confidence += 0.05;
  }

  return Math.min(confidence, 1);
}

/**
 * Main scaling decision function
 */
export function makeScalingDecision(
  metrics: ScalingMetrics,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): ScalingDecision {
  const { score, breakdown } = calculateScalingScore(metrics, config);
  const targetVcpu = determineTargetVcpu(score, config);
  const targetMemoryGiB = (targetVcpu * 2) as 2 | 4 | 8;
  const reason = generateReason(score, targetVcpu, breakdown, metrics);
  const confidence = calculateConfidence(metrics);

  return {
    targetVcpu,
    targetMemoryGiB,
    reason,
    confidence,
    score,
    breakdown,
  };
}

/**
 * Convert AI analysis result to severity
 */
export function mapAIResultToSeverity(
  aiResult: { severity?: string } | null
): AISeverity | undefined {
  if (!aiResult?.severity) return undefined;

  const severityMap: Record<string, AISeverity> = {
    normal: 'low',
    warning: 'medium',
    critical: 'critical',
    // Additional mapping
    low: 'low',
    medium: 'medium',
    high: 'high',
  };

  return severityMap[aiResult.severity.toLowerCase()] || 'medium';
}
