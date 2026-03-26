/**
 * Guardian Score Engine
 * Calculates operator trust temperature (당근마켓 매너온도 inspired)
 *
 * - Base temperature: 36.5°C (new operator)
 * - Each review shifts temperature by ±0.5°C max
 * - Recent reviews have more weight (90-day half-life)
 * - Temperature range: 0°C ~ 99.0°C
 */

import type { OperatorReview, GuardianScore, GuardianLevel } from '@/types/review';

const BASE_TEMP = 36.5;
const MIN_TEMP = 0;
const MAX_TEMP = 99.0;
const HALF_LIFE_DAYS = 90;
const DELTA_PER_REVIEW = 0.25; // multiplier: (avg - 3.0) * 0.25 = ±0.5 max per review
const TRADE_TEMP_BONUS = 0.1;  // per trade (capped), much lower than review weight

/**
 * Calculate Guardian Temperature from reviews + trade count
 * Reviews (star ratings) have 5x more weight than trade count.
 * This prevents wash trading from inflating temperature.
 */
export function calculateGuardianScore(
  reviews: OperatorReview[],
  tradeCount: number = 0
): GuardianScore {
  if (reviews.length === 0 && tradeCount === 0) {
    return { temperature: BASE_TEMP, level: 'new', reviewCount: 0, avgRating: 0 };
  }

  const now = Date.now();

  // Calculate weighted temperature delta
  let weightedSum = 0;
  let totalWeight = 0;
  let ratingSum = 0;

  for (const review of reviews) {
    const avg = (
      review.ratings.dataAccuracy +
      review.ratings.responseSpeed +
      review.ratings.uptime +
      review.ratings.valueForMoney
    ) / 4;

    ratingSum += avg;

    // Delta: 3.0 = neutral, 5.0 = +0.5°C, 1.0 = -0.5°C
    const delta = (avg - 3.0) * DELTA_PER_REVIEW;

    // Time decay: recent reviews matter more
    const ageMs = now - new Date(review.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const weight = Math.exp((-ageDays * Math.LN2) / HALF_LIFE_DAYS);

    weightedSum += delta * weight;
    totalWeight += weight;
  }

  // Normalize by weighted count to prevent runaway accumulation
  // but still reward volume (sqrt scaling)
  const volumeFactor = Math.sqrt(reviews.length);
  const normalizedDelta = totalWeight > 0
    ? (weightedSum / totalWeight) * volumeFactor
    : 0;

  // Trade count bonus: √tradeCount × 0.1°C, capped at +3°C
  // Much weaker than review-based delta (prevents wash trading)
  const tradeBonus = Math.min(3.0, Math.sqrt(tradeCount) * TRADE_TEMP_BONUS);

  const temperature = Math.round(
    Math.max(MIN_TEMP, Math.min(MAX_TEMP, BASE_TEMP + normalizedDelta + tradeBonus)) * 10
  ) / 10;

  const level = getLevel(temperature);
  const avgRating = Math.round((ratingSum / reviews.length) * 10) / 10;

  return { temperature, level, reviewCount: reviews.length, avgRating };
}

function getLevel(temp: number): GuardianLevel {
  if (temp < 20) return 'cold';
  if (temp < BASE_TEMP) return 'cool';
  if (temp === BASE_TEMP) return 'new';
  if (temp < 50) return 'warm';
  if (temp < 70) return 'hot';
  return 'legendary';
}

/**
 * Get display color for a guardian level
 */
export function getGuardianColor(level: GuardianLevel): string {
  const colors: Record<GuardianLevel, string> = {
    cold: '#0055AA',
    cool: '#707070',
    new: '#A0A0A0',
    warm: '#CC6600',
    hot: '#D40000',
    legendary: '#FFD700',
  };
  return colors[level];
}

/**
 * Get emoji for a guardian level
 */
export function getGuardianEmoji(level: GuardianLevel): string {
  const emojis: Record<GuardianLevel, string> = {
    cold: '🥶',
    cool: '😐',
    new: '🆕',
    warm: '😊',
    hot: '🔥',
    legendary: '🏆',
  };
  return emojis[level];
}

/**
 * Get label text for a guardian level
 */
export function getGuardianLabel(level: GuardianLevel): string {
  const labels: Record<GuardianLevel, string> = {
    cold: 'COLD',
    cool: 'COOL',
    new: 'NEW',
    warm: 'WARM',
    hot: 'HOT',
    legendary: 'LEGENDARY',
  };
  return labels[level];
}
