'use client';

import { Zap, TrendingUp } from 'lucide-react';

interface ScalingPanelProps {
  score: number;
  currentVcpu: number;
  targetVcpu: number;
  predictionTier?: string;
  predictionConfidence?: number;
  lastDecision?: string;
  autoScalingEnabled: boolean;
}

// Dot gauge: how many of 4 dots to fill for each vCPU tier
const VCPU_DOTS: Record<number, number> = { 1: 1, 2: 2, 4: 3, 8: 4 };

function scoreTierColor(score: number): string {
  if (score >= 77) return '#F87171';
  if (score >= 70) return '#FB923C';
  if (score >= 30) return '#6EE7F7';
  return '#4ADE80';
}

function scoreTierLabel(score: number): string {
  if (score >= 77) return 'Emergency';
  if (score >= 70) return 'High';
  if (score >= 30) return 'Normal';
  return 'Idle';
}

export function ScalingPanel({
  score,
  currentVcpu,
  targetVcpu,
  predictionTier,
  predictionConfidence,
  lastDecision,
  autoScalingEnabled,
}: ScalingPanelProps) {
  const color = scoreTierColor(score);
  const label = scoreTierLabel(score);
  const isAlert = score >= 70;
  const filledDots = VCPU_DOTS[currentVcpu] ?? 1;

  return (
    <div className={`glass-panel rounded-xl p-4 space-y-4 transition-all duration-500 ${isAlert ? 'glass-panel-alert' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Zap className="size-3 text-white/40" />
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          Scaling Score
        </span>
      </div>

      {/* Big score */}
      <div className="flex items-end gap-2">
        <span
          className="text-5xl font-light tabular-nums font-mono leading-none transition-colors duration-500"
          style={{ color }}
        >
          {score}
        </span>
        <span className="text-white/25 text-lg font-mono mb-1">/ 100</span>
        <span
          className="ml-auto text-xs font-mono mb-1 transition-colors duration-500"
          style={{ color }}
        >
          {label}
        </span>
      </div>

      {/* Score bar */}
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>

      {/* vCPU dot gauge */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">vCPU</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="size-2 rounded-full transition-all duration-500"
                style={{
                  backgroundColor: i <= filledDots ? color : 'rgba(255,255,255,0.1)',
                  boxShadow: i <= filledDots ? `0 0 6px ${color}80` : 'none',
                }}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-white/60">{currentVcpu} vCPU</span>
        </div>
      </div>

      {/* Target (when different) */}
      {targetVcpu !== currentVcpu && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Target</span>
          <span className="font-mono text-[#6EE7F7]">→ {targetVcpu} vCPU</span>
        </div>
      )}

      {/* Auto-scale */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Auto-scale</span>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
          autoScalingEnabled
            ? 'text-[#4ADE80] border-[#4ADE80]/30 bg-[#4ADE80]/[0.08]'
            : 'text-white/30 border-white/10 bg-white/[0.03]'
        }`}>
          {autoScalingEnabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* AI prediction */}
      {predictionTier && (
        <div className="border-t border-white/[0.06] pt-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3 text-white/30" />
            <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">AI Prediction</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/70">{predictionTier}</span>
            {predictionConfidence && (
              <span className="text-[10px] font-mono text-white/40">{predictionConfidence}%</span>
            )}
          </div>
        </div>
      )}

      {/* Last decision */}
      {lastDecision && (
        <p className="text-[10px] text-white/25 font-mono truncate">{lastDecision}</p>
      )}
    </div>
  );
}
