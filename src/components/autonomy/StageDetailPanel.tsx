'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { PipelineState, PipelineEvent } from './types';

interface StageDetailPanelProps {
  state: PipelineState;
}

// Shared: instant transitions when reduced motion is preferred
const noMotion = { initial: false, transition: { duration: 0 } } as const;

function PlanStepsList({ steps, reducedMotion }: { steps: Array<{ title: string; risk: string }>; reducedMotion: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-gray-400 font-semibold uppercase">Plan Steps</p>
      {steps.map((step, i) => (
        <motion.div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/50"
          {...(reducedMotion ? noMotion : { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 }, transition: { delay: i * 0.1 } })}
        >
          <span className="text-[10px] text-gray-500 w-4 shrink-0">{i + 1}</span>
          <span className="text-[11px] text-gray-300 flex-1">{step.title}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            step.risk === 'critical' ? 'bg-red-900/50 text-red-400' :
            step.risk === 'high'     ? 'bg-orange-900/50 text-orange-400' :
            step.risk === 'medium'   ? 'bg-amber-900/50 text-amber-400' :
                                       'bg-emerald-900/50 text-emerald-400'
          }`}>{step.risk}</span>
        </motion.div>
      ))}
    </div>
  );
}

function EventLog({ history }: { history: PipelineEvent[] }) {
  if (history.length === 0) return null;

  const iconMap: Record<PipelineEvent['type'], React.ReactNode> = {
    info: <Clock size={10} className="text-blue-400 shrink-0" />,
    success: <CheckCircle2 size={10} className="text-green-400 shrink-0" />,
    error: <XCircle size={10} className="text-red-400 shrink-0" />,
    warning: <AlertTriangle size={10} className="text-amber-400 shrink-0" />,
  };

  return (
    <div className="space-y-0.5 max-h-24 overflow-y-auto">
      <p className="text-[10px] text-gray-400 font-semibold uppercase sticky top-0 bg-gray-900/90 py-0.5">Event Log</p>
      {history.slice(0, 8).map((event) => (
        <div key={event.id} className="flex items-start gap-1.5 text-[10px]">
          {iconMap[event.type]}
          <span className="text-gray-500 font-mono shrink-0">
            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className="text-gray-400">{event.message}</span>
        </div>
      ))}
    </div>
  );
}

export function StageDetailPanel({ state }: StageDetailPanelProps) {
  const { phase, currentGoal, currentPlan, executionProgress, verificationResult, rollbackProgress, history } = state;
  const prefersReducedMotion = useReducedMotion() ?? false;

  // Shared animation props - disabled when reduced motion is preferred
  const fadeIn = prefersReducedMotion ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  return (
    <motion.div
      className="mt-3 rounded-xl bg-gray-900/60 border border-gray-700/50 p-3"
      {...(prefersReducedMotion ? noMotion : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } })}
    >
      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <motion.div key="idle" {...fadeIn}>
            <p className="text-xs text-gray-500 text-center py-2">Waiting for signals...</p>
          </motion.div>
        )}

        {(phase === 'signal_collecting' || phase === 'goal_generating') && (
          <motion.div key="signal" {...fadeIn}>
            <p className="text-xs text-cyan-400">
              {phase === 'signal_collecting'
                ? 'Collecting signals from 7 sources...'
                : 'Generating goal candidates...'}
            </p>
          </motion.div>
        )}

        {phase === 'goal_queued' && currentGoal && (
          <motion.div key="goal" {...fadeIn} className="space-y-1">
            <p className="text-xs text-cyan-400 font-semibold">Goal Queued</p>
            <p className="text-[11px] text-gray-300">{currentGoal.goal}</p>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-500">confidence: <span className="text-white font-mono">{currentGoal.confidence.toFixed(2)}</span></span>
              <span className={`font-semibold px-1.5 py-0.5 rounded ${
                currentGoal.risk === 'critical' ? 'bg-red-900/50 text-red-400' :
                currentGoal.risk === 'high' ? 'bg-orange-900/50 text-orange-400' :
                currentGoal.risk === 'medium' ? 'bg-amber-900/50 text-amber-400' :
                'bg-emerald-900/50 text-emerald-400'
              }`}>{currentGoal.risk}</span>
            </div>
          </motion.div>
        )}

        {phase === 'planning' && currentPlan && (
          <motion.div key="plan" {...fadeIn} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-400 font-semibold">Plan: {currentPlan.intent}</p>
              <span className="text-[10px] text-gray-500 font-mono">
                {currentPlan.planId ? `${currentPlan.planId.slice(0, 12)}...` : 'generating...'}
              </span>
            </div>
            {currentPlan.steps.length > 0 && <PlanStepsList steps={currentPlan.steps} reducedMotion={prefersReducedMotion} />}
          </motion.div>
        )}

        {phase === 'executing' && executionProgress && (
          <motion.div key="exec" {...fadeIn} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-400 font-semibold">Executing</p>
              <span className="text-[10px] text-gray-500 font-mono">
                {executionProgress.operationId ? `${executionProgress.operationId.slice(0, 12)}...` : ''}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-green-500 rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: `${(executionProgress.current / Math.max(executionProgress.total, 1)) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="flex gap-3 text-[10px]">
              <span className="text-green-400">done: {executionProgress.completedSteps}</span>
              <span className="text-red-400">fail: {executionProgress.failedSteps}</span>
              <span className="text-gray-500">skip: {executionProgress.skippedSteps}</span>
              <span className="text-gray-400">total: {executionProgress.total}</span>
            </div>
            {currentPlan?.steps && currentPlan.steps.length > 0 && <PlanStepsList steps={currentPlan.steps} reducedMotion={prefersReducedMotion} />}
          </motion.div>
        )}

        {(phase === 'verifying' || phase === 'completed') && verificationResult && (
          <motion.div key="verify" {...fadeIn} className="space-y-1">
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold ${verificationResult.status === 'pass' ? 'text-green-400' : 'text-red-400'}`}>
                Verification {verificationResult.status === 'pass' ? 'PASSED' : 'FAILED'}
              </p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                verificationResult.status === 'pass' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
              }`}>{verificationResult.passed}/{verificationResult.total}</span>
            </div>
            {verificationResult.failedChecks > 0 && (
              <p className="text-[10px] text-red-400">{verificationResult.failedChecks} checks failed</p>
            )}
          </motion.div>
        )}

        {phase === 'rolling_back' && rollbackProgress && (
          <motion.div key="rollback" {...fadeIn} className="space-y-1">
            <p className="text-xs text-orange-400 font-semibold">Rolling Back...</p>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-orange-500 rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: `${(rollbackProgress.current / Math.max(rollbackProgress.total, 1)) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="flex gap-3 text-[10px]">
              <span className="text-orange-400">done: {rollbackProgress.completedSteps}</span>
              <span className="text-red-400">fail: {rollbackProgress.failedSteps}</span>
              <span className="text-gray-400">total: {rollbackProgress.total}</span>
            </div>
          </motion.div>
        )}

        {phase === 'failed' && !rollbackProgress && (
          <motion.div key="failed" {...fadeIn}>
            <p className="text-xs text-red-400 font-semibold">Operation Failed</p>
            <p className="text-[10px] text-gray-400 mt-1">Use Rollback to revert changes.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event log always visible */}
      <div className="mt-3 pt-2 border-t border-gray-700/50">
        <EventLog history={history} />
      </div>
    </motion.div>
  );
}
