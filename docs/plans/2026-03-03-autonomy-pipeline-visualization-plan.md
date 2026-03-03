# Autonomy Pipeline 3D Visualization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Autonomy Cockpit panel in `page.tsx` with an animated 3D pipeline visualization showing the autonomous operation lifecycle (Signal → Goal → Plan → Execute → Verify → Rollback) using CSS 3D transforms and Framer Motion.

**Architecture:** Extract the inline Autonomy Cockpit (~335 lines, page.tsx:1757-2097) into modular components under `src/components/autonomy/`. A custom hook `useAutonomyState` drives a state machine that maps API responses to pipeline phases. CSS `perspective` + `rotateX` create the 3D depth effect; Framer Motion handles particle flows and stage transition animations.

**Tech Stack:** React 19, Next.js 16, TypeScript, Tailwind CSS 4, Framer Motion (new dependency), Lucide icons

**Design Doc:** `docs/plans/2026-03-03-autonomy-pipeline-visualization-design.md`

---

## Task 1: Install framer-motion and verify build

**Files:**
- Modify: `package.json`

**Step 1: Install framer-motion**

Run: `npm install framer-motion`

**Step 2: Verify build still passes**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Verify framer-motion works with React 19**

Create a throwaway test: add `import { motion } from 'framer-motion'` to any existing file, run build, then revert. This confirms compatibility.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add framer-motion for autonomy pipeline animation"
```

---

## Task 2: Create pipeline types and constants

**Files:**
- Create: `src/components/autonomy/types.ts`

**Step 1: Write type definitions**

```typescript
// src/components/autonomy/types.ts

// --- Pipeline Phase State Machine ---
export type PipelinePhase =
  | 'idle'
  | 'signal_collecting'
  | 'goal_generating'
  | 'goal_queued'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'rolling_back';

export type StageStatus =
  | 'idle'
  | 'waiting'
  | 'active'
  | 'executing'
  | 'success'
  | 'failed'
  | 'rollback';

export interface StageConfig {
  id: string;
  label: string;
  icon: string; // Lucide icon name
}

export interface GoalSummary {
  goalId: string;
  intent: string;
  confidence: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  goal: string;
}

export interface PlanSummary {
  planId: string;
  intent: string;
  stepCount: number;
  steps: Array<{ title: string; risk: string }>;
  generatedAt: string | null;
}

export interface ExecutionProgress {
  operationId: string;
  current: number;
  total: number;
  currentStep: string;
  success?: boolean;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
}

export interface VerificationResult {
  operationId: string;
  passed: number;
  total: number;
  status: 'pass' | 'fail';
  failedChecks: number;
  verifiedAt: string | null;
}

export interface RollbackProgress {
  operationId: string;
  current: number;
  total: number;
  success?: boolean;
  completedSteps: number;
  failedSteps: number;
}

export interface PipelineEvent {
  id: string;
  timestamp: string;
  phase: PipelinePhase;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface PipelineState {
  phase: PipelinePhase;
  stageStatuses: Record<string, StageStatus>;
  currentGoal: GoalSummary | null;
  currentPlan: PlanSummary | null;
  executionProgress: ExecutionProgress | null;
  verificationResult: VerificationResult | null;
  rollbackProgress: RollbackProgress | null;
  history: PipelineEvent[];
}

export const PIPELINE_STAGES: StageConfig[] = [
  { id: 'signal', label: 'Signal', icon: 'Radio' },
  { id: 'goal', label: 'Goal', icon: 'Target' },
  { id: 'plan', label: 'Plan', icon: 'ClipboardList' },
  { id: 'act', label: 'Act', icon: 'Play' },
  { id: 'verify', label: 'Verify', icon: 'ShieldCheck' },
];

// Phase → which stages are active/executing/etc.
export const PHASE_STAGE_MAP: Record<PipelinePhase, Record<string, StageStatus>> = {
  idle:               { signal: 'waiting', goal: 'idle', plan: 'idle', act: 'idle', verify: 'idle' },
  signal_collecting:  { signal: 'active', goal: 'idle', plan: 'idle', act: 'idle', verify: 'idle' },
  goal_generating:    { signal: 'success', goal: 'active', plan: 'idle', act: 'idle', verify: 'idle' },
  goal_queued:        { signal: 'success', goal: 'success', plan: 'waiting', act: 'idle', verify: 'idle' },
  planning:           { signal: 'success', goal: 'success', plan: 'executing', act: 'idle', verify: 'idle' },
  executing:          { signal: 'success', goal: 'success', plan: 'success', act: 'executing', verify: 'idle' },
  verifying:          { signal: 'success', goal: 'success', plan: 'success', act: 'success', verify: 'executing' },
  completed:          { signal: 'success', goal: 'success', plan: 'success', act: 'success', verify: 'success' },
  failed:             { signal: 'success', goal: 'success', plan: 'success', act: 'failed', verify: 'idle' },
  rolling_back:       { signal: 'success', goal: 'success', plan: 'rollback', act: 'rollback', verify: 'failed' },
};

// Stage glow colors per status
export const STAGE_GLOW_COLORS: Record<StageStatus, string> = {
  idle: 'transparent',
  waiting: 'rgba(59, 130, 246, 0.3)',    // blue
  active: 'rgba(6, 182, 212, 0.5)',      // cyan
  executing: 'rgba(34, 197, 94, 0.6)',   // green
  success: 'rgba(34, 197, 94, 0.4)',     // green (dimmer)
  failed: 'rgba(239, 68, 68, 0.6)',      // red
  rollback: 'rgba(249, 115, 22, 0.5)',   // orange
};
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit src/components/autonomy/types.ts` (or just `npm run build`)
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/autonomy/types.ts
git commit -m "feat(autonomy-viz): add pipeline types and constants"
```

---

## Task 3: Create useAutonomyState hook

**Files:**
- Create: `src/components/autonomy/hooks/useAutonomyState.ts`

This hook encapsulates all state management for the pipeline. It:
- Polls `/api/goal-manager` and `/api/agent-loop` at intervals
- Maps API responses to `PipelinePhase`
- Tracks demo action execution state
- Exposes action handlers (seed, tick, dispatch, plan, execute, verify, rollback)

**Step 1: Create the hook**

```typescript
// src/components/autonomy/hooks/useAutonomyState.ts
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  PipelineState,
  PipelinePhase,
  PipelineEvent,
  GoalSummary,
  PlanSummary,
  ExecutionProgress,
  VerificationResult,
  RollbackProgress,
} from '../types';
import { PHASE_STAGE_MAP } from '../types';

const BASE_PATH = '';
const MAX_HISTORY = 20;

// Reuse the types from page.tsx that we need
type AutonomousIntentData =
  | 'stabilize_throughput'
  | 'recover_sequencer_path'
  | 'reduce_cost_idle_window'
  | 'restore_l1_connectivity'
  | 'protect_critical_eoa';

type AutonomyDemoAction =
  | 'seed-stable'
  | 'seed-rising'
  | 'seed-spike'
  | 'goal-tick'
  | 'goal-dispatch-dry-run'
  | 'autonomous-plan'
  | 'autonomous-execute'
  | 'autonomous-verify'
  | 'autonomous-rollback';

interface RuntimeAutonomyPolicyData {
  level: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5';
  minConfidenceDryRun: number;
  minConfidenceWrite: number;
}

interface GoalManagerStatusData {
  config: {
    enabled: boolean;
    dispatchEnabled: boolean;
    llmEnhancerEnabled: boolean;
    dispatchDryRun: boolean;
    dispatchAllowWrites: boolean;
  };
  activeGoalId: string | null;
  queueDepth: number;
  queue: Array<{
    goalId: string;
    status: string;
    goal: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    score: { total: number };
  }>;
  dlq: Array<{ id: string; goalId: string; reason: string; attempts: number }>;
  suppression: Array<{ id: string; reasonCode: string; timestamp: string }>;
  lastTickSuppressedCount?: number;
}

const SEED_INTENT_MAP: Record<string, AutonomousIntentData> = {
  spike: 'stabilize_throughput',
  rising: 'reduce_cost_idle_window',
  stable: 'protect_critical_eoa',
  falling: 'recover_sequencer_path',
};

function writeHeaders(): Record<string, string> {
  const apiKey = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_SENTINAI_API_KEY || '')
    : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

function addEvent(
  history: PipelineEvent[],
  phase: PipelinePhase,
  message: string,
  type: PipelineEvent['type'] = 'info',
): PipelineEvent[] {
  const event: PipelineEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    phase,
    message,
    type,
  };
  return [event, ...history].slice(0, MAX_HISTORY);
}

export function useAutonomyState() {
  // --- Core pipeline state ---
  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [currentGoal, setCurrentGoal] = useState<GoalSummary | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanSummary | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [rollbackProgress, setRollbackProgress] = useState<RollbackProgress | null>(null);
  const [history, setHistory] = useState<PipelineEvent[]>([]);

  // --- External state (from page.tsx props or own polling) ---
  const [goalManager, setGoalManager] = useState<GoalManagerStatusData | null>(null);
  const [autonomyPolicy, setAutonomyPolicy] = useState<RuntimeAutonomyPolicyData | null>(null);
  const [autonomyActionRunning, setAutonomyActionRunning] = useState<AutonomyDemoAction | null>(null);
  const [autonomousIntent, setAutonomousIntent] = useState<AutonomousIntentData>('recover_sequencer_path');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // --- Polling ---
  const refreshData = useCallback(async () => {
    try {
      const [gmRes, policyRes] = await Promise.allSettled([
        fetch(`${BASE_PATH}/api/goal-manager?limit=20`, { cache: 'no-store' }),
        fetch(`${BASE_PATH}/api/policy/autonomy-level`, { cache: 'no-store' }),
      ]);
      if (gmRes.status === 'fulfilled' && gmRes.value.ok) {
        const data = await gmRes.value.json();
        setGoalManager(data);
      }
      if (policyRes.status === 'fulfilled' && policyRes.value.ok) {
        const data = await policyRes.value.json();
        setAutonomyPolicy(data);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 5000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // --- Phase derivation from goal manager state ---
  useEffect(() => {
    if (autonomyActionRunning) return; // Don't override during demo actions

    if (!goalManager) {
      setPhase('idle');
      return;
    }

    if (goalManager.activeGoalId) {
      // An active goal exists - check what phase we should be in
      if (executionProgress) {
        setPhase('executing');
      } else if (currentPlan) {
        setPhase('planning');
      } else {
        setPhase('goal_queued');
      }
    } else if (goalManager.queueDepth > 0) {
      setPhase('goal_queued');
      const top = goalManager.queue[0];
      if (top) {
        setCurrentGoal({
          goalId: top.goalId,
          intent: '',
          confidence: top.confidence,
          risk: top.risk,
          goal: top.goal,
        });
      }
    } else {
      // Only go idle if not in a demo-driven phase
      if (phase !== 'completed' && phase !== 'failed' && phase !== 'rolling_back') {
        setPhase('idle');
      }
    }
  }, [goalManager, autonomyActionRunning, executionProgress, currentPlan, phase]);

  // --- Demo action handler ---
  const runAction = useCallback(async (action: AutonomyDemoAction) => {
    if (autonomyActionRunning) return;

    setAutonomyActionRunning(action);
    setFeedback(null);

    try {
      if (action.startsWith('seed-')) {
        const scenario = action.replace('seed-', '');
        const res = await fetch(`${BASE_PATH}/api/metrics/seed?scenario=${scenario}`, {
          method: 'POST',
          headers: writeHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Seed injection failed');

        const suggestedIntent = SEED_INTENT_MAP[scenario];
        if (suggestedIntent) setAutonomousIntent(suggestedIntent);

        // Reset pipeline for fresh scenario
        setCurrentGoal(null);
        setCurrentPlan(null);
        setExecutionProgress(null);
        setVerificationResult(null);
        setRollbackProgress(null);

        setPhase('signal_collecting');
        setHistory(h => addEvent(h, 'signal_collecting', `Scenario "${scenario}" injected`, 'info'));
        setFeedback({ type: 'success', message: `Scenario ${scenario} injected` });

        // Animate: signal_collecting → idle after 2s
        setTimeout(() => {
          setPhase(prev => prev === 'signal_collecting' ? 'idle' : prev);
        }, 2000);

      } else if (action === 'goal-tick') {
        const res = await fetch(`${BASE_PATH}/api/goal-manager/tick`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({}),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Goal tick failed');

        setPhase('goal_generating');
        setHistory(h => addEvent(h, 'goal_generating', `Goal tick: ${body.generatedCount ?? 0} candidates`, 'info'));

        // Brief animation then settle
        setTimeout(() => {
          setPhase(prev => prev === 'goal_generating' ? 'goal_queued' : prev);
          refreshData();
        }, 1500);

        setFeedback({ type: 'success', message: `Goal tick completed` });

      } else if (action === 'goal-dispatch-dry-run') {
        const res = await fetch(`${BASE_PATH}/api/goal-manager/dispatch`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ dryRun: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Dispatch failed');

        setPhase('goal_queued');
        setHistory(h => addEvent(h, 'goal_queued', `Dispatch dry-run: ${body.dispatched ? 'dispatched' : 'skipped'}`, 'info'));
        setFeedback({ type: 'success', message: `Dispatch dry-run completed` });
        refreshData();

      } else if (action === 'autonomous-plan') {
        setPhase('planning');
        setHistory(h => addEvent(h, 'planning', `Creating plan for ${autonomousIntent}...`, 'info'));

        const res = await fetch(`${BASE_PATH}/api/autonomous/plan`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ intent: autonomousIntent, dryRun: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Plan creation failed');

        const plan: PlanSummary = {
          planId: body.planId || body.plan?.planId || '',
          intent: autonomousIntent,
          stepCount: body.plan?.steps?.length ?? body.stepCount ?? 0,
          steps: (body.plan?.steps || []).map((s: { action?: string; risk?: string }) => ({
            title: s.action || 'unknown',
            risk: s.risk || 'low',
          })),
          generatedAt: body.plan?.generatedAt || new Date().toISOString(),
        };
        setCurrentPlan(plan);
        setHistory(h => addEvent(h, 'planning', `Plan created: ${plan.stepCount} steps`, 'success'));
        setFeedback({ type: 'success', message: `Plan created: ${plan.stepCount} steps` });

      } else if (action === 'autonomous-execute') {
        if (!currentPlan) {
          setFeedback({ type: 'error', message: 'No plan to execute. Create a plan first.' });
          return;
        }
        setPhase('executing');
        setHistory(h => addEvent(h, 'executing', `Executing plan ${currentPlan.planId}...`, 'info'));

        const res = await fetch(`${BASE_PATH}/api/autonomous/execute`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({
            intent: autonomousIntent,
            dryRun: true,
            planId: currentPlan.planId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Execution failed');

        const result = body.result || body;
        const progress: ExecutionProgress = {
          operationId: result.operationId || '',
          current: result.steps?.length ?? 0,
          total: result.steps?.length ?? 0,
          currentStep: 'completed',
          success: result.success !== false,
          completedSteps: result.steps?.filter((s: { status: string }) => s.status === 'completed').length ?? 0,
          failedSteps: result.steps?.filter((s: { status: string }) => s.status === 'failed').length ?? 0,
          skippedSteps: result.steps?.filter((s: { status: string }) => s.status === 'skipped').length ?? 0,
        };
        setExecutionProgress(progress);

        if (progress.success) {
          setPhase('verifying');
          setHistory(h => addEvent(h, 'executing', `Execution complete: ${progress.completedSteps}/${progress.total} steps`, 'success'));
        } else {
          setPhase('failed');
          setHistory(h => addEvent(h, 'failed', `Execution failed: ${progress.failedSteps} steps failed`, 'error'));
        }
        setFeedback({ type: progress.success ? 'success' : 'error', message: `Execution ${progress.success ? 'succeeded' : 'failed'}` });

      } else if (action === 'autonomous-verify') {
        if (!executionProgress?.operationId) {
          setFeedback({ type: 'error', message: 'No operation to verify.' });
          return;
        }
        setPhase('verifying');
        setHistory(h => addEvent(h, 'verifying', `Verifying operation ${executionProgress.operationId}...`, 'info'));

        const res = await fetch(`${BASE_PATH}/api/autonomous/verify`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ operationId: executionProgress.operationId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Verification failed');

        const results = body.results || [];
        const totalChecks = results.reduce((acc: number, r: { checks?: unknown[] }) => acc + (r.checks?.length ?? 0), 0);
        const failedChecks = results.reduce((acc: number, r: { checks?: Array<{ passed?: boolean }> }) =>
          acc + (r.checks?.filter((c: { passed?: boolean }) => !c.passed)?.length ?? 0), 0);
        const allPassed = body.passed !== false && failedChecks === 0;

        const verification: VerificationResult = {
          operationId: executionProgress.operationId,
          passed: allPassed ? totalChecks : totalChecks - failedChecks,
          total: totalChecks,
          status: allPassed ? 'pass' : 'fail',
          failedChecks,
          verifiedAt: new Date().toISOString(),
        };
        setVerificationResult(verification);

        if (allPassed) {
          setPhase('completed');
          setHistory(h => addEvent(h, 'completed', `Verification PASSED: ${totalChecks} checks`, 'success'));
          // Auto-reset to idle after 5 seconds
          setTimeout(() => setPhase(prev => prev === 'completed' ? 'idle' : prev), 5000);
        } else {
          setPhase('failed');
          setHistory(h => addEvent(h, 'failed', `Verification FAILED: ${failedChecks}/${totalChecks} checks failed`, 'error'));
        }
        setFeedback({ type: allPassed ? 'success' : 'error', message: `Verification ${allPassed ? 'PASSED' : 'FAILED'}` });

      } else if (action === 'autonomous-rollback') {
        if (!executionProgress?.operationId) {
          setFeedback({ type: 'error', message: 'No operation to rollback.' });
          return;
        }
        setPhase('rolling_back');
        setHistory(h => addEvent(h, 'rolling_back', `Rolling back operation ${executionProgress.operationId}...`, 'warning'));

        const res = await fetch(`${BASE_PATH}/api/autonomous/rollback`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ operationId: executionProgress.operationId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Rollback failed');

        const result = body.result || body;
        const rollback: RollbackProgress = {
          operationId: executionProgress.operationId,
          current: result.steps?.length ?? 0,
          total: result.steps?.length ?? 0,
          success: result.success !== false,
          completedSteps: result.steps?.filter((s: { status: string }) => s.status === 'completed').length ?? 0,
          failedSteps: result.steps?.filter((s: { status: string }) => s.status === 'failed').length ?? 0,
        };
        setRollbackProgress(rollback);
        setHistory(h => addEvent(h, 'rolling_back', `Rollback ${rollback.success ? 'completed' : 'failed'}`, rollback.success ? 'success' : 'error'));
        setFeedback({ type: rollback.success ? 'success' : 'error', message: `Rollback ${rollback.success ? 'completed' : 'failed'}` });

        // Reset to idle after rollback
        setTimeout(() => {
          setPhase('idle');
          setCurrentGoal(null);
          setCurrentPlan(null);
          setExecutionProgress(null);
          setVerificationResult(null);
          setRollbackProgress(null);
        }, 3000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setFeedback({ type: 'error', message });
      setHistory(h => addEvent(h, phase, `Error: ${message}`, 'error'));
    } finally {
      setAutonomyActionRunning(null);
      refreshData();
    }
  }, [autonomyActionRunning, autonomousIntent, currentPlan, executionProgress, phase, refreshData]);

  // --- Autonomy level update ---
  const updateAutonomyLevel = useCallback(async (level: RuntimeAutonomyPolicyData['level']) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/policy/autonomy-level`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ level }),
      });
      if (!res.ok) throw new Error('Failed to update autonomy level');
      const data = await res.json();
      setAutonomyPolicy(data);
      setFeedback({ type: 'success', message: `Autonomy level set to ${level}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      setFeedback({ type: 'error', message });
    }
  }, []);

  // Build derived state
  const stageStatuses = PHASE_STAGE_MAP[phase];

  const pipelineState: PipelineState = {
    phase,
    stageStatuses,
    currentGoal,
    currentPlan,
    executionProgress,
    verificationResult,
    rollbackProgress,
    history,
  };

  return {
    state: pipelineState,
    goalManager,
    autonomyPolicy,
    autonomousIntent,
    autonomyActionRunning,
    feedback,
    setAutonomousIntent,
    runAction,
    updateAutonomyLevel,
    refreshData,
  };
}
```

**Step 2: Verify the hook compiles**

Run: `npm run build`
Expected: Build succeeds (hook not yet used, but types should check)

**Step 3: Commit**

```bash
git add src/components/autonomy/hooks/useAutonomyState.ts
git commit -m "feat(autonomy-viz): add useAutonomyState hook with pipeline state machine"
```

---

## Task 4: Create PipelineStage component

**Files:**
- Create: `src/components/autonomy/PipelineStage.tsx`

The individual 3D card for each pipeline stage (Signal, Goal, Plan, Act, Verify).

**Step 1: Write the component**

```typescript
// src/components/autonomy/PipelineStage.tsx
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
  onClick?: () => void;
}

const statusBorder: Record<StageStatus, string> = {
  idle: 'border-gray-300/50',
  waiting: 'border-blue-300 border-dashed',
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

export function PipelineStage({ stage, status, subtitle, onClick }: PipelineStageProps) {
  const Icon = ICON_MAP[stage.icon] || Radio;
  const glowColor = STAGE_GLOW_COLORS[status];
  const isActive = status !== 'idle';

  return (
    <motion.div
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
        scale: status === 'executing' ? [1, 1.05, 1] : 1,
        opacity: status === 'idle' ? 0.5 : 1,
      }}
      transition={{
        scale: { repeat: status === 'executing' ? Infinity : 0, duration: 1.5 },
        opacity: { duration: 0.3 },
      }}
      whileHover={{ scale: 1.08, translateZ: 30 }}
      onClick={onClick}
    >
      {/* Glow ring for active/executing */}
      {(status === 'active' || status === 'executing') && (
        <motion.div
          className="absolute inset-0 rounded-xl"
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {subtitle}
        </motion.span>
      )}
    </motion.div>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/autonomy/PipelineStage.tsx
git commit -m "feat(autonomy-viz): add PipelineStage 3D card component"
```

---

## Task 5: Create PipelineConnector and PipelineParticle components

**Files:**
- Create: `src/components/autonomy/PipelineConnector.tsx`

The connector line between stages with flowing particles.

**Step 1: Write the connector component**

```typescript
// src/components/autonomy/PipelineConnector.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { StageStatus } from './types';

interface PipelineConnectorProps {
  fromStatus: StageStatus;
  toStatus: StageStatus;
  isRollback?: boolean;
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

export function PipelineConnector({ fromStatus, toStatus, isRollback = false }: PipelineConnectorProps) {
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

  // Idle state: very dim, slow particles
  const isIdle = fromStatus === 'idle' && toStatus === 'idle';

  return (
    <div className="relative flex items-center mx-1" style={{ width: 40, height: 4 }}>
      {/* Base line */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          backgroundColor: isIdle ? 'rgba(75,85,99,0.3)' : isRollbackFlow ? 'rgba(249,115,22,0.3)' : 'rgba(6,182,212,0.2)',
        }}
      />

      {/* Flowing particles */}
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

      {/* Arrow head */}
      <div
        className="absolute right-0 w-0 h-0"
        style={{
          borderTop: '4px solid transparent',
          borderBottom: '4px solid transparent',
          borderLeft: `6px solid ${isIdle ? 'rgba(75,85,99,0.3)' : isRollbackFlow ? 'rgba(249,115,22,0.5)' : 'rgba(6,182,212,0.4)'}`,
          transform: isRollbackFlow ? 'rotate(180deg)' : undefined,
        }}
      />
    </div>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/autonomy/PipelineConnector.tsx
git commit -m "feat(autonomy-viz): add PipelineConnector with particle flow animation"
```

---

## Task 6: Create StageDetailPanel component

**Files:**
- Create: `src/components/autonomy/StageDetailPanel.tsx`

Shows detailed information about the currently active pipeline stage.

**Step 1: Write the component**

```typescript
// src/components/autonomy/StageDetailPanel.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { PipelineState, PipelineEvent } from './types';

interface StageDetailPanelProps {
  state: PipelineState;
}

function PlanStepsList({ steps }: { steps: Array<{ title: string; risk: string }> }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-gray-400 font-semibold uppercase">Plan Steps</p>
      {steps.map((step, i) => (
        <motion.div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/50"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
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

  const iconMap = {
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

  return (
    <motion.div
      className="mt-3 rounded-xl bg-gray-900/60 border border-gray-700/50 p-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="text-xs text-gray-500 text-center py-2">Waiting for signals...</p>
          </motion.div>
        )}

        {(phase === 'signal_collecting' || phase === 'goal_generating') && (
          <motion.div key="signal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="text-xs text-cyan-400">Collecting signals from 7 sources...</p>
          </motion.div>
        )}

        {phase === 'goal_queued' && currentGoal && (
          <motion.div key="goal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
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
          <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-400 font-semibold">Plan: {currentPlan.intent}</p>
              <span className="text-[10px] text-gray-500 font-mono">{currentPlan.planId.slice(0, 12)}...</span>
            </div>
            {currentPlan.steps.length > 0 && <PlanStepsList steps={currentPlan.steps} />}
          </motion.div>
        )}

        {phase === 'executing' && executionProgress && (
          <motion.div key="exec" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-400 font-semibold">Executing</p>
              <span className="text-[10px] text-gray-500 font-mono">{executionProgress.operationId.slice(0, 12)}...</span>
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
            {currentPlan?.steps && <PlanStepsList steps={currentPlan.steps} />}
          </motion.div>
        )}

        {(phase === 'verifying' || phase === 'completed') && verificationResult && (
          <motion.div key="verify" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
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
          <motion.div key="rollback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
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
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/autonomy/StageDetailPanel.tsx
git commit -m "feat(autonomy-viz): add StageDetailPanel with phase-aware content"
```

---

## Task 7: Create AutonomyControls component

**Files:**
- Create: `src/components/autonomy/AutonomyControls.tsx`

Top bar with Autonomy Level selector, Seed buttons, Goal Manager actions, and Autonomous Ops API controls.

**Step 1: Write the component**

```typescript
// src/components/autonomy/AutonomyControls.tsx
'use client';

import { RefreshCw } from 'lucide-react';

type AutonomousIntentData =
  | 'stabilize_throughput'
  | 'recover_sequencer_path'
  | 'reduce_cost_idle_window'
  | 'restore_l1_connectivity'
  | 'protect_critical_eoa';

type AutonomyDemoAction =
  | 'seed-stable'
  | 'seed-rising'
  | 'seed-spike'
  | 'goal-tick'
  | 'goal-dispatch-dry-run'
  | 'autonomous-plan'
  | 'autonomous-execute'
  | 'autonomous-verify'
  | 'autonomous-rollback';

type AutonomyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const AUTONOMY_LEVELS: AutonomyLevel[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

const AUTONOMOUS_INTENT_OPTIONS: Array<{ value: AutonomousIntentData; label: string }> = [
  { value: 'stabilize_throughput', label: 'Stabilize Throughput' },
  { value: 'recover_sequencer_path', label: 'Recover Sequencer' },
  { value: 'reduce_cost_idle_window', label: 'Reduce Cost' },
  { value: 'restore_l1_connectivity', label: 'Restore L1' },
  { value: 'protect_critical_eoa', label: 'Protect EOA' },
];

interface AutonomyControlsProps {
  currentLevel: AutonomyLevel | undefined;
  autonomousIntent: AutonomousIntentData;
  actionRunning: AutonomyDemoAction | null;
  goalManagerEnabled: boolean;
  hasOperationId: boolean;
  hasPlan: boolean;
  onLevelChange: (level: AutonomyLevel) => void;
  onIntentChange: (intent: AutonomousIntentData) => void;
  onAction: (action: AutonomyDemoAction) => void;
  onRefresh: () => void;
}

export function AutonomyControls({
  currentLevel,
  autonomousIntent,
  actionRunning,
  goalManagerEnabled,
  hasOperationId,
  hasPlan,
  onLevelChange,
  onIntentChange,
  onAction,
  onRefresh,
}: AutonomyControlsProps) {
  const disabled = actionRunning !== null;

  return (
    <div className="space-y-3">
      {/* Row 1: Autonomy Level */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Level</span>
        {AUTONOMY_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => onLevelChange(level)}
            disabled={disabled}
            className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all disabled:opacity-50 ${
              currentLevel === level
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {level}
          </button>
        ))}
        <button
          onClick={onRefresh}
          disabled={disabled}
          className="ml-auto p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Row 2: Seed Scenarios */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Seed</span>
        {(['seed-stable', 'seed-rising', 'seed-spike'] as const).map((action) => {
          const label = action.replace('seed-', '');
          const colors = {
            'seed-stable': 'bg-blue-900/50 text-blue-400 hover:bg-blue-900/70',
            'seed-rising': 'bg-amber-900/50 text-amber-400 hover:bg-amber-900/70',
            'seed-spike': 'bg-red-900/50 text-red-400 hover:bg-red-900/70',
          };
          return (
            <button
              key={action}
              onClick={() => onAction(action)}
              disabled={disabled}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-md disabled:opacity-50 ${colors[action]}`}
            >
              {actionRunning === action ? '...' : label}
            </button>
          );
        })}

        <div className="w-px h-4 bg-gray-700 mx-1" />

        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Goal</span>
        <button
          onClick={() => onAction('goal-tick')}
          disabled={disabled || !goalManagerEnabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-50"
        >
          {actionRunning === 'goal-tick' ? '...' : 'Tick'}
        </button>
        <button
          onClick={() => onAction('goal-dispatch-dry-run')}
          disabled={disabled || !goalManagerEnabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-indigo-900/50 text-indigo-400 hover:bg-indigo-900/70 disabled:opacity-50"
        >
          {actionRunning === 'goal-dispatch-dry-run' ? '...' : 'Dispatch'}
        </button>
      </div>

      {/* Row 3: Autonomous Ops */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Ops</span>
        <select
          value={autonomousIntent}
          onChange={(e) => onIntentChange(e.target.value as AutonomousIntentData)}
          disabled={disabled}
          className="px-2 py-1 text-[10px] rounded-md bg-gray-800 text-gray-300 border border-gray-700 disabled:opacity-50"
        >
          {AUTONOMOUS_INTENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={() => onAction('autonomous-plan')}
          disabled={disabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-plan' ? '...' : 'Plan'}
        </button>
        <button
          onClick={() => onAction('autonomous-execute')}
          disabled={disabled || !hasPlan}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-cyan-900/50 text-cyan-400 hover:bg-cyan-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-execute' ? '...' : 'Execute'}
        </button>
        <button
          onClick={() => onAction('autonomous-verify')}
          disabled={disabled || !hasOperationId}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-violet-900/50 text-violet-400 hover:bg-violet-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-verify' ? '...' : 'Verify'}
        </button>
        <button
          onClick={() => onAction('autonomous-rollback')}
          disabled={disabled || !hasOperationId}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-rose-900/50 text-rose-400 hover:bg-rose-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-rollback' ? '...' : 'Rollback'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/autonomy/AutonomyControls.tsx
git commit -m "feat(autonomy-viz): add AutonomyControls with level, seed, and ops actions"
```

---

## Task 8: Create AutonomyPipeline top-level component

**Files:**
- Create: `src/components/autonomy/AutonomyPipeline.tsx`
- Create: `src/components/autonomy/index.ts`

The main container that assembles all sub-components with 3D perspective.

**Step 1: Write the main component**

```typescript
// src/components/autonomy/AutonomyPipeline.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useAutonomyState } from './hooks/useAutonomyState';
import { PipelineStage } from './PipelineStage';
import { PipelineConnector } from './PipelineConnector';
import { StageDetailPanel } from './StageDetailPanel';
import { AutonomyControls } from './AutonomyControls';
import { PIPELINE_STAGES } from './types';

function getStageSubtitle(stageId: string, state: ReturnType<typeof useAutonomyState>['state']): string | undefined {
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

export function AutonomyPipeline() {
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
  } = useAutonomyState();

  const isRollingBack = state.phase === 'rolling_back';

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
          <span className="text-[10px] bg-indigo-900/50 text-indigo-400 px-2 py-1 rounded font-bold">
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
        className="mt-5 py-6 flex items-center justify-center overflow-hidden"
        style={{
          perspective: '1200px',
        }}
      >
        <motion.div
          className="flex items-center gap-0"
          style={{
            transformStyle: 'preserve-3d',
          }}
          animate={{
            rotateX: 12,
          }}
          transition={{ duration: 0.5 }}
        >
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage.id} className="flex items-center">
              <PipelineStage
                stage={stage}
                status={state.stageStatuses[stage.id] || 'idle'}
                subtitle={getStageSubtitle(stage.id, state)}
              />
              {i < PIPELINE_STAGES.length - 1 && (
                <PipelineConnector
                  fromStatus={state.stageStatuses[PIPELINE_STAGES[i].id] || 'idle'}
                  toStatus={state.stageStatuses[PIPELINE_STAGES[i + 1].id] || 'idle'}
                  isRollback={isRollingBack}
                />
              )}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Rollback reverse lane */}
      <AnimatePresence>
        {isRollingBack && (
          <motion.div
            className="mx-auto h-1 rounded-full bg-orange-500/30 mb-2"
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
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            data-testid="autonomy-action-feedback"
          >
            {feedback.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

**Step 2: Create barrel export**

```typescript
// src/components/autonomy/index.ts
export { AutonomyPipeline } from './AutonomyPipeline';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/autonomy/AutonomyPipeline.tsx src/components/autonomy/index.ts
git commit -m "feat(autonomy-viz): add AutonomyPipeline top-level container with 3D perspective"
```

---

## Task 9: Integrate AutonomyPipeline into page.tsx

**Files:**
- Modify: `src/app/page.tsx` (lines ~1757-2097)

Replace the inline Autonomy Cockpit panel with the new `<AutonomyPipeline />` component.

**Step 1: Add import to page.tsx**

At the top of `page.tsx` (around line 3, after existing imports), add:

```typescript
import { AutonomyPipeline } from '@/components/autonomy';
```

**Step 2: Replace the Autonomy Cockpit panel**

Find the section (approximately lines 1757-2097):
```tsx
{/* Autonomy Cockpit Panel */}
<div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6" data-testid="autonomy-cockpit-panel">
  ...entire cockpit content...
</div>
```

Replace with:
```tsx
{/* Autonomy Pipeline (3D Visualization) */}
<AutonomyPipeline />
```

**Important**: The new `AutonomyPipeline` component manages its own state via `useAutonomyState`. The removed state variables from page.tsx (`autonomyPolicy`, `autonomousPlanSummary`, `autonomousExecuteSummary`, `autonomousRollbackSummary`, `autonomousVerifySummary`, `autonomousPlanId`, `autonomousOperationId`, `autonomousPlanSteps`, `autonomousIntent`, `autonomyActionRunning`, `autonomyActionFeedback`, `autonomyPolicyUpdating`) should be verified for any remaining references in page.tsx (e.g., the Agent Loop panel may reference `autonomyPolicy`).

If `autonomyPolicy` is used elsewhere in page.tsx (e.g., Agent Loop panel header badge), keep the state variable and polling for it in page.tsx OR pass it down. Check for all remaining references before removing state.

**Step 3: Clean up unused state variables**

After integration, remove any state variables and handlers that are no longer used:
- `autonomousPlanSummary`, `setAutonomousPlanSummary`
- `autonomousExecuteSummary`, `setAutonomousExecuteSummary`
- `autonomousRollbackSummary`, `setAutonomousRollbackSummary`
- `autonomousVerifySummary`, `setAutonomousVerifySummary`
- `autonomousPlanId`, `setAutonomousPlanId`
- `autonomousOperationId`, `setAutonomousOperationId`
- `autonomousPlanSteps`, `setAutonomousPlanSteps`
- `autonomyActionRunning`, `setAutonomyActionRunning`
- `autonomyActionFeedback`, `setAutonomyActionFeedback`
- `autonomyPolicyUpdating`, `setAutonomyPolicyUpdating`
- `runAutonomyDemoAction` function
- `updateAutonomyPolicyLevel` function
- Constants: `AUTONOMY_LEVEL_OPTIONS`, `SEED_INTENT_MAP`, `AUTONOMOUS_INTENT_OPTIONS`, `AUTONOMY_LEVEL_GUIDE`

**BUT KEEP** if still referenced by other panels:
- `autonomyPolicy` / `setAutonomyPolicy` — check if Agent Loop panel uses this
- `goalManager` / `setGoalManager` — check if Agent Loop panel uses this
- `refreshAutonomyPanels` — check if called from elsewhere

Do a search for each variable name in page.tsx before removing.

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds with no type errors

**Step 5: Manual visual check**

Run: `npm run dev`
Open `http://localhost:3002` in browser.
Expected: The Autonomy Cockpit is replaced by the dark-themed 3D pipeline visualization with 5 stage cards.

**Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(autonomy-viz): integrate AutonomyPipeline into dashboard, replace Autonomy Cockpit"
```

---

## Task 10: Add reduced-motion and mobile support

**Files:**
- Modify: `src/components/autonomy/AutonomyPipeline.tsx`
- Modify: `src/components/autonomy/PipelineStage.tsx`
- Modify: `src/components/autonomy/PipelineConnector.tsx`

**Step 1: Add reduced-motion support**

In `AutonomyPipeline.tsx`, add a hook to detect `prefers-reduced-motion`:

```typescript
import { useReducedMotion } from 'framer-motion';

// Inside component:
const prefersReducedMotion = useReducedMotion();

// Pass to children:
<PipelineStage ... reducedMotion={prefersReducedMotion ?? false} />
<PipelineConnector ... reducedMotion={prefersReducedMotion ?? false} />
```

In `PipelineStage.tsx`, when `reducedMotion` is true:
- Disable `animate` scale pulsing
- Use instant `transition: { duration: 0 }` instead of animated transitions
- Still show glow colors but no animation

In `PipelineConnector.tsx`, when `reducedMotion` is true:
- Don't render particles at all
- Show a static connector line with appropriate color

**Step 2: Add mobile responsive layout**

In `AutonomyPipeline.tsx`, the 3D perspective container:

```typescript
// Mobile: reduce rotateX, add horizontal scroll
<div className="mt-5 py-6 flex items-center justify-center overflow-x-auto md:overflow-hidden">
  <motion.div
    className="flex items-center gap-0 min-w-max"
    style={{ transformStyle: 'preserve-3d' }}
    animate={{ rotateX: typeof window !== 'undefined' && window.innerWidth < 768 ? 0 : 12 }}
  />
</div>
```

Better approach: use a CSS media query class:

```tsx
<motion.div
  className="flex items-center gap-0 min-w-max md:[transform:rotateX(12deg)]"
  style={{ transformStyle: 'preserve-3d' }}
>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/autonomy/
git commit -m "feat(autonomy-viz): add reduced-motion and mobile responsive support"
```

---

## Task 11: Verify data-testid attributes for E2E compatibility

**Files:**
- Modify: `src/components/autonomy/AutonomyPipeline.tsx` (if needed)
- Modify: `src/components/autonomy/AutonomyControls.tsx` (if needed)

**Step 1: Ensure critical data-testid attributes are preserved**

The existing Autonomy Cockpit had these test IDs:
- `autonomy-cockpit-panel` → replace with `autonomy-pipeline-panel` (already done)
- `autonomy-current-level-badge` → add to header badge
- `autonomy-level-btn-{level}` → add to AutonomyControls level buttons
- `autonomy-action-feedback` → already added to feedback toast

Add missing `data-testid` attributes to:
1. Level buttons: `data-testid={`autonomy-level-btn-${level}`}`
2. Level badge: `data-testid="autonomy-current-level-badge"`
3. Each pipeline stage: `data-testid={`pipeline-stage-${stage.id}`}`

**Step 2: Verify existing E2E tests still reference correct test IDs**

Run: `grep -r "autonomy-cockpit-panel\|autonomy-current-level-badge\|autonomy-level-btn\|autonomy-action-feedback" e2e/ src/` to find any E2E tests that reference the old panel.

Update any references from `autonomy-cockpit-panel` to `autonomy-pipeline-panel`.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/autonomy/ e2e/
git commit -m "fix(autonomy-viz): preserve data-testid attributes for E2E compatibility"
```

---

## Task 12: Final build verification and cleanup

**Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Run linter**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Run tests**

Run: `npm run test:run`
Expected: Tests pass (the new components don't have tests yet, but existing tests shouldn't break)

**Step 4: Manual smoke test**

Run: `npm run dev`

Check these scenarios in browser:
1. Dashboard loads → Autonomy Pipeline panel visible with dark theme and 5 stage cards
2. Click Autonomy Level buttons → Level changes, badge updates
3. Click "Spike" seed → Signal card glows, particles flow briefly
4. Click "Tick" → Goal card activates
5. Click "Plan" → Plan card activates, detail panel shows steps
6. Click "Execute" → Act card shows progress
7. Click "Verify" → Verify card shows checks
8. Click "Rollback" → Orange reverse particles, cards reset

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(autonomy-viz): final build fixes and cleanup"
```

---

## Summary

| Task | Component | Lines of Code (est.) |
|------|-----------|---------------------|
| 1 | framer-motion install | 0 (deps only) |
| 2 | types.ts | ~120 |
| 3 | useAutonomyState.ts | ~300 |
| 4 | PipelineStage.tsx | ~110 |
| 5 | PipelineConnector.tsx | ~90 |
| 6 | StageDetailPanel.tsx | ~180 |
| 7 | AutonomyControls.tsx | ~130 |
| 8 | AutonomyPipeline.tsx + index.ts | ~120 |
| 9 | page.tsx integration | ~-340 (remove) +5 (add import + component) |
| 10 | a11y + mobile | ~30 |
| 11 | data-testid compat | ~15 |
| 12 | Build verify | 0 |
| **Total** | | ~1100 new, ~340 removed |
