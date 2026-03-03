'use client';

import { motion } from 'framer-motion';
import {
  Radio, Target, ClipboardList, Play, ShieldCheck,
  Loader2, CheckCircle2, XCircle, RotateCcw,
} from 'lucide-react';
import type { StageConfig, StageStatus } from './types';
import { STAGE_GLOW_COLORS } from './types';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Radio, Target, ClipboardList, Play, ShieldCheck,
};

interface PipelineStageProps {
  stage: StageConfig;
  status: StageStatus;
  subtitle?: string;
  reducedMotion?: boolean;
  onClick?: () => void;
}

const statusBorder: Record<StageStatus, string> = {
  idle: 'border-gray-700/50',
  waiting: 'border-blue-500/60 border-dashed',
  active: 'border-cyan-400',
  executing: 'border-green-400',
  success: 'border-green-500',
  failed: 'border-red-500',
  rollback: 'border-orange-400',
};

const statusBg: Record<StageStatus, string> = {
  idle: 'bg-gray-900/60',
  waiting: 'bg-gray-900/70',
  active: 'bg-gray-900/80',
  executing: 'bg-gray-900/90',
  success: 'bg-gray-900/80',
  failed: 'bg-gray-900/80',
  rollback: 'bg-gray-900/80',
};

function StatusIndicator({ status }: { status: StageStatus }) {
  switch (status) {
    case 'executing':
      return <Loader2 size={12} className="animate-spin text-green-400" />;
    case 'success':
      return <CheckCircle2 size={12} className="text-green-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'rollback':
      return <RotateCcw size={12} className="animate-spin text-orange-400" style={{ animationDirection: 'reverse' }} />;
    default:
      return null;
  }
}

export function PipelineStage({ stage, status, subtitle, reducedMotion = false, onClick }: PipelineStageProps) {
  const Icon = ICON_MAP[stage.icon] || Radio;
  const glowColor = STAGE_GLOW_COLORS[status];
  const isActive = status !== 'idle';

  // When reduced motion is preferred, use instant transitions and no pulsing
  const animateScale = reducedMotion
    ? 1
    : status === 'executing'
      ? [1, 1.05, 1]
      : 1;

  const transitionConfig = reducedMotion
    ? { duration: 0 }
    : {
        scale: { repeat: status === 'executing' ? Infinity : 0, duration: 1.5 },
        opacity: { duration: 0.3 },
      };

  return (
    <motion.div
      data-testid={`pipeline-stage-${stage.id}`}
      className={`
        relative flex flex-col items-center justify-center
        w-24 h-20 rounded-xl border-2
        ${statusBorder[status]} ${statusBg[status]}
        cursor-pointer select-none
        transition-colors duration-300
      `}
      style={{
        transform: 'translateZ(20px)',
        boxShadow: isActive
          ? `0 0 20px ${glowColor}, 0 4px 12px rgba(0,0,0,0.3)`
          : '0 4px 12px rgba(0,0,0,0.2)',
      }}
      animate={{
        scale: animateScale,
        opacity: status === 'idle' ? 0.5 : 1,
      }}
      transition={transitionConfig}
      whileHover={reducedMotion ? undefined : { scale: 1.08 }}
      onClick={onClick}
    >
      {/* Glow ring for active/executing */}
      {!reducedMotion && (status === 'active' || status === 'executing') && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ boxShadow: `0 0 30px ${glowColor}` }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
        />
      )}

      <div className="flex items-center gap-1.5">
        <Icon size={16} className={isActive ? 'text-white' : 'text-gray-500'} />
        <StatusIndicator status={status} />
      </div>

      <span className={`text-xs font-bold mt-1 ${isActive ? 'text-white' : 'text-gray-500'}`}>
        {stage.label}
      </span>

      {subtitle && (
        <motion.span
          className="text-[10px] text-gray-400 mt-0.5 font-mono"
          initial={reducedMotion ? undefined : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.3 }}
        >
          {subtitle}
        </motion.span>
      )}
    </motion.div>
  );
}
