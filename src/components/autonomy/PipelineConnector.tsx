'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { StageStatus } from './types';

interface PipelineConnectorProps {
  fromStatus: StageStatus;
  toStatus: StageStatus;
  isRollback?: boolean;
  reducedMotion?: boolean;
}

const PARTICLE_COUNT = 3;

function Particle({ index, color, reverse, speed }: {
  index: number;
  color: string;
  reverse: boolean;
  speed: number;
}) {
  return (
    <motion.div
      className="absolute top-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: 6,
        height: 6,
        backgroundColor: color,
        boxShadow: `0 0 8px ${color}`,
      }}
      initial={{ left: reverse ? '100%' : '0%', opacity: 0 }}
      animate={{
        left: reverse ? ['100%', '0%'] : ['0%', '100%'],
        opacity: [0, 1, 1, 0],
      }}
      transition={{
        duration: speed,
        repeat: Infinity,
        delay: index * (speed / PARTICLE_COUNT),
        ease: 'linear',
      }}
    />
  );
}

export function PipelineConnector({
  fromStatus,
  toStatus,
  isRollback = false,
  reducedMotion = false,
}: PipelineConnectorProps) {
  // Determine if particles should flow
  const isFlowing = fromStatus === 'active' || fromStatus === 'executing' || fromStatus === 'success'
    || toStatus === 'active' || toStatus === 'executing';
  const isRollbackFlow = isRollback || fromStatus === 'rollback' || toStatus === 'rollback';

  // Particle color
  const color = isRollbackFlow
    ? 'rgb(249, 115, 22)' // orange
    : fromStatus === 'executing' || toStatus === 'executing'
      ? 'rgb(34, 197, 94)' // green
      : 'rgb(6, 182, 212)'; // cyan

  // Speed: faster during execution
  const speed = fromStatus === 'executing' ? 1.2 : 2.5;

  // Idle state: very dim
  const isIdle = fromStatus === 'idle' && toStatus === 'idle';

  // Determine line color for static display
  const lineColor = isIdle
    ? 'rgba(75,85,99,0.3)'
    : isRollbackFlow
      ? 'rgba(249,115,22,0.3)'
      : 'rgba(6,182,212,0.2)';

  // Arrow color
  const arrowColor = isIdle
    ? 'rgba(75,85,99,0.3)'
    : isRollbackFlow
      ? 'rgba(249,115,22,0.5)'
      : 'rgba(6,182,212,0.4)';

  return (
    <div className="relative flex items-center mx-1" style={{ width: 40, height: 4 }}>
      {/* Base line */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: lineColor }}
      />

      {/* Flowing particles (disabled when reduced motion is preferred) */}
      {!reducedMotion && (
        <AnimatePresence>
          {(isFlowing || isRollbackFlow) && (
            <>
              {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
                <Particle
                  key={`particle-${i}`}
                  index={i}
                  color={color}
                  reverse={isRollbackFlow}
                  speed={speed}
                />
              ))}
            </>
          )}
          {isIdle && (
            <Particle key="idle-particle" index={0} color="rgba(107,114,128,0.4)" reverse={false} speed={5} />
          )}
        </AnimatePresence>
      )}

      {/* Static flow indicator when reduced motion is on and flowing */}
      {reducedMotion && (isFlowing || isRollbackFlow) && (
        <div
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: color, opacity: 0.4 }}
        />
      )}

      {/* Arrow head */}
      <div
        className="absolute right-0 w-0 h-0"
        style={{
          borderTop: '4px solid transparent',
          borderBottom: '4px solid transparent',
          borderLeft: `6px solid ${arrowColor}`,
          transform: isRollbackFlow ? 'rotate(180deg)' : undefined,
        }}
      />
    </div>
  );
}
