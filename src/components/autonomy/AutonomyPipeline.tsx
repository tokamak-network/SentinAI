'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useAutonomyState } from './hooks/useAutonomyState';
import { PipelineStage } from './PipelineStage';
import { PipelineConnector } from './PipelineConnector';
import { StageDetailPanel } from './StageDetailPanel';
import { AutonomyControls } from './AutonomyControls';
import { PIPELINE_STAGES } from './types';
import type { PipelineState } from './types';

function getStageSubtitle(stageId: string, state: PipelineState): string | undefined {
  switch (stageId) {
    case 'signal':
      return state.phase === 'signal_collecting' ? 'collecting...' : undefined;
    case 'goal':
      return state.currentGoal ? `${state.currentGoal.risk}` : undefined;
    case 'plan':
      return state.currentPlan ? `${state.currentPlan.stepCount} steps` : undefined;
    case 'act':
      if (state.executionProgress) {
        return `${state.executionProgress.completedSteps}/${state.executionProgress.total}`;
      }
      return undefined;
    case 'verify':
      if (state.verificationResult) {
        return `${state.verificationResult.passed}/${state.verificationResult.total}`;
      }
      return undefined;
    default:
      return undefined;
  }
}

interface AutonomyPipelineProps {
  onSeedInjected?: () => void;
}

export function AutonomyPipeline({ onSeedInjected }: AutonomyPipelineProps) {
  const {
    state,
    goalManager,
    autonomyPolicy,
    autonomousIntent,
    autonomyActionRunning,
    feedback,
    setAutonomousIntent,
    runAction,
    updateAutonomyLevel,
    refreshData,
  } = useAutonomyState({ onSeedInjected });

  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const isRollingBack = state.phase === 'rolling_back';

  // Responsive: detect mobile for reduced 3D perspective
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const rotateX = reducedMotion ? 0 : isMobile ? 4 : 12;

  return (
    <div
      className="bg-gray-950 rounded-2xl p-5 shadow-lg border border-gray-800 mb-6"
      data-testid="autonomy-pipeline-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-cyan-400" />
          <h3 className="font-bold text-white text-lg">Autonomy Pipeline</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] bg-indigo-900/50 text-indigo-400 px-2 py-1 rounded font-bold"
            data-testid="autonomy-current-level-badge"
          >
            {autonomyPolicy?.level || 'A?'}
          </span>
          <span className={`text-[10px] px-2 py-1 rounded font-bold ${
            goalManager?.config.enabled
              ? 'bg-green-900/50 text-green-400'
              : 'bg-gray-800 text-gray-500'
          }`}>
            {goalManager?.config.enabled ? 'active' : 'standby'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <AutonomyControls
        currentLevel={autonomyPolicy?.level}
        autonomousIntent={autonomousIntent}
        actionRunning={autonomyActionRunning}
        goalManagerEnabled={goalManager?.config.enabled ?? false}
        hasOperationId={!!state.executionProgress?.operationId}
        hasPlan={!!state.currentPlan}
        onLevelChange={updateAutonomyLevel}
        onIntentChange={setAutonomousIntent}
        onAction={runAction}
        onRefresh={refreshData}
      />

      {/* 3D Pipeline Visualization */}
      <div
        className="mt-5 py-6 flex items-center justify-center overflow-x-auto md:overflow-hidden"
        style={{
          perspective: isMobile ? '800px' : '1200px',
        }}
      >
        <motion.div
          className="flex items-center gap-0 min-w-max"
          style={{
            transformStyle: 'preserve-3d',
          }}
          animate={{
            rotateX,
          }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.5 }}
        >
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage.id} className="flex items-center">
              <PipelineStage
                stage={stage}
                status={state.stageStatuses[stage.id] || 'idle'}
                subtitle={getStageSubtitle(stage.id, state)}
                reducedMotion={reducedMotion}
              />
              {i < PIPELINE_STAGES.length - 1 && (
                <PipelineConnector
                  fromStatus={state.stageStatuses[PIPELINE_STAGES[i].id] || 'idle'}
                  toStatus={state.stageStatuses[PIPELINE_STAGES[i + 1].id] || 'idle'}
                  isRollback={isRollingBack}
                  reducedMotion={reducedMotion}
                />
              )}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Rollback reverse lane */}
      <AnimatePresence>
        {isRollingBack && !reducedMotion && (
          <motion.div
            className="mx-auto h-1 rounded-full bg-orange-500/30 mb-2 overflow-hidden"
            style={{ width: '80%' }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="h-full w-4 rounded-full bg-orange-500"
              animate={{ x: ['100%', '0%'] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            />
          </motion.div>
        )}
        {isRollingBack && reducedMotion && (
          <div
            className="mx-auto h-1 rounded-full bg-orange-500/50 mb-2"
            style={{ width: '80%' }}
          />
        )}
      </AnimatePresence>

      {/* Detail Panel */}
      <StageDetailPanel state={state} />

      {/* Feedback toast */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            className={`mt-3 text-[11px] px-3 py-2 rounded-lg border ${
              feedback.type === 'success'
                ? 'bg-green-900/30 border-green-800 text-green-400'
                : 'bg-red-900/30 border-red-800 text-red-400'
            }`}
            initial={reducedMotion ? undefined : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
            data-testid="autonomy-action-feedback"
          >
            {feedback.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
