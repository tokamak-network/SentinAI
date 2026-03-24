'use client';

import type { GuardianScore } from '@/types/review';
import { getGuardianColor, getGuardianEmoji, getGuardianLabel } from '@/lib/guardian-score';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

interface GuardianTemperatureProps {
  score: GuardianScore;
  /** 'compact' = inline badge, 'full' = bar + details */
  variant?: 'compact' | 'full';
}

export function GuardianTemperature({ score, variant = 'full' }: GuardianTemperatureProps) {
  const color = getGuardianColor(score.level);
  const emoji = getGuardianEmoji(score.level);
  const label = getGuardianLabel(score.level);

  if (variant === 'compact') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: FONT, fontSize: 10,
      }}>
        <span>{emoji}</span>
        <span style={{ fontWeight: 700, color }}>{score.temperature}°C</span>
        {score.reviewCount > 0 && (
          <span style={{ color: '#A0A0A0', fontSize: 8 }}>({score.reviewCount})</span>
        )}
      </span>
    );
  }

  // Full variant with thermometer bar
  const fillPercent = Math.min((score.temperature / 99) * 100, 100);

  return (
    <div style={{
      border: '1px solid #E0E0E0',
      padding: 14,
      fontFamily: FONT,
    }}>
      {/* Top row: emoji + temp + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
          {score.temperature}°C
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color,
          letterSpacing: '0.1em', padding: '2px 6px',
          border: `1px solid ${color}`, borderRadius: 2,
        }}>
          {label}
        </span>
      </div>

      {/* Thermometer bar */}
      <div style={{
        background: '#F0F0F0', height: 8, borderRadius: 4,
        overflow: 'hidden', marginBottom: 8,
      }}>
        <div style={{
          height: '100%', borderRadius: 4,
          width: `${fillPercent}%`,
          background: `linear-gradient(90deg, #0055AA 0%, #CC6600 40%, #D40000 70%, #FFD700 100%)`,
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Bottom row: review count + avg rating */}
      <div style={{ display: 'flex', gap: 16, fontSize: 9, color: '#707070' }}>
        <span>
          <span style={{ fontWeight: 700, color: '#3A3A3A' }}>{score.reviewCount}</span> reviews
        </span>
        {score.avgRating > 0 && (
          <span>
            avg <span style={{ fontWeight: 700, color: '#3A3A3A' }}>★ {score.avgRating}</span>
          </span>
        )}
      </div>
    </div>
  );
}
