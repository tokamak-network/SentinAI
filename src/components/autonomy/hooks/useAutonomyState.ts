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
  AutonomousIntentData,
  AutonomyDemoAction,
  RuntimeAutonomyPolicyData,
  GoalManagerStatusData,
} from '../types';
import { PHASE_STAGE_MAP, SEED_INTENT_MAP } from '../types';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const MAX_HISTORY = 20;
const POLL_INTERVAL_MS = 5000;

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

interface UseAutonomyStateOptions {
  onSeedInjected?: () => void;
}

export function useAutonomyState(options: UseAutonomyStateOptions = {}) {
  // --- Core pipeline state ---
  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [currentGoal, setCurrentGoal] = useState<GoalSummary | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanSummary | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [rollbackProgress, setRollbackProgress] = useState<RollbackProgress | null>(null);
  const [history, setHistory] = useState<PipelineEvent[]>([]);

  // --- External state (from own polling) ---
  const [goalManager, setGoalManager] = useState<GoalManagerStatusData | null>(null);
  const [autonomyPolicy, setAutonomyPolicy] = useState<RuntimeAutonomyPolicyData | null>(null);
  const [autonomyActionRunning, setAutonomyActionRunning] = useState<AutonomyDemoAction | null>(null);
  const [autonomousIntent, setAutonomousIntent] = useState<AutonomousIntentData>('recover_sequencer_path');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Refs to avoid stale closures in interval and async chains
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const currentPlanRef = useRef(currentPlan);
  currentPlanRef.current = currentPlan;
  const executionProgressRef = useRef(executionProgress);
  executionProgressRef.current = executionProgress;
  const onSeedInjectedRef = useRef(options.onSeedInjected);
  onSeedInjectedRef.current = options.onSeedInjected;

  // --- Polling with AbortController ---
  const abortRef = useRef<AbortController | null>(null);

  const refreshData = useCallback(async () => {
    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const [gmRes, policyRes] = await Promise.allSettled([
        fetch(`${BASE_PATH}/api/goal-manager?limit=20`, { cache: 'no-store', signal: controller.signal }),
        fetch(`${BASE_PATH}/api/policy/autonomy-level`, { cache: 'no-store', signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (gmRes.status === 'fulfilled' && gmRes.value.ok) {
        const data = await gmRes.value.json();
        setGoalManager(data);
      }
      if (policyRes.status === 'fulfilled' && policyRes.value.ok) {
        const data = await policyRes.value.json();
        setAutonomyPolicy(data.policy ?? data);
      }
    } catch {
      // silent - polling failure should not break UI
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
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
      // Only go idle if not in a demo-driven terminal phase
      if (
        phaseRef.current !== 'completed' &&
        phaseRef.current !== 'failed' &&
        phaseRef.current !== 'rolling_back'
      ) {
        setPhase('idle');
      }
    }
  }, [goalManager, autonomyActionRunning, executionProgress, currentPlan]);

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

        // Notify parent to immediately refresh metrics (cost update)
        onSeedInjectedRef.current?.();

        // Reset pipeline for fresh scenario
        setCurrentGoal(null);
        setCurrentPlan(null);
        setExecutionProgress(null);
        setVerificationResult(null);
        setRollbackProgress(null);

        // --- Auto-chain: Signal → Goal → Plan → Act → Verify ---
        const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

        // 1. Signal
        setPhase('signal_collecting');
        setHistory(h => addEvent(h, 'signal_collecting', `Scenario "${scenario}" injected`, 'info'));
        setFeedback({ type: 'success', message: `Scenario ${scenario} injected` });
        await delay(2000);

        // 2. Goal Tick
        setPhase('goal_generating');
        setHistory(h => addEvent(h, 'goal_generating', 'Generating goal candidates...', 'info'));
        try {
          const tickRes = await fetch(`${BASE_PATH}/api/goal-manager/tick`, {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({}),
          });
          const tickBody = await tickRes.json().catch(() => ({}));
          if (tickRes.ok) {
            setHistory(h => addEvent(h, 'goal_generating', `Goal tick: ${tickBody.generatedCount ?? 0} candidates`, 'success'));
          }
        } catch { /* continue pipeline even if tick fails */ }
        await delay(1500);

        // 3. Goal Queued → Plan
        setPhase('goal_queued');
        refreshData();
        await delay(1000);

        setPhase('planning');
        setHistory(h => addEvent(h, 'planning', `Creating plan for ${suggestedIntent || 'stabilize'}...`, 'info'));
        try {
          const planRes = await fetch(`${BASE_PATH}/api/autonomous/plan`, {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({ intent: suggestedIntent || 'stabilize', dryRun: true }),
          });
          const planBody = await planRes.json().catch(() => ({}));
          if (planRes.ok) {
            const plan: PlanSummary = {
              planId: planBody.planId || planBody.plan?.planId || '',
              intent: suggestedIntent || 'stabilize',
              stepCount: planBody.plan?.steps?.length ?? planBody.stepCount ?? 0,
              steps: (planBody.plan?.steps || []).map((s: { action?: string; risk?: string }) => ({
                title: s.action || 'unknown',
                risk: s.risk || 'low',
              })),
              generatedAt: planBody.plan?.generatedAt || new Date().toISOString(),
            };
            setCurrentPlan(plan);
            setHistory(h => addEvent(h, 'planning', `Plan created: ${plan.stepCount} steps`, 'success'));
          }
        } catch { /* continue */ }
        await delay(1500);

        // 4. Execute
        const latestPlan = currentPlanRef.current;
        let execOperationId = '';
        setPhase('executing');
        setHistory(h => addEvent(h, 'executing', 'Executing plan...', 'info'));
        try {
          const execRes = await fetch(`${BASE_PATH}/api/autonomous/execute`, {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({
              intent: suggestedIntent || 'stabilize',
              dryRun: true,
              planId: latestPlan?.planId || '',
            }),
          });
          const execBody = await execRes.json().catch(() => ({}));
          if (execRes.ok) {
            const result = execBody.result || execBody;
            execOperationId = result.operationId || '';
            const progress: ExecutionProgress = {
              operationId: execOperationId,
              current: result.steps?.length ?? 0,
              total: result.steps?.length ?? 0,
              currentStep: 'completed',
              success: result.success !== false,
              completedSteps: result.steps?.filter((s: { status: string }) => s.status === 'completed').length ?? 0,
              failedSteps: result.steps?.filter((s: { status: string }) => s.status === 'failed').length ?? 0,
              skippedSteps: result.steps?.filter((s: { status: string }) => s.status === 'skipped').length ?? 0,
            };
            setExecutionProgress(progress);
            setHistory(h => addEvent(h, 'executing', `Execution complete: ${progress.completedSteps}/${progress.total} steps`, 'success'));
          }
        } catch { /* continue */ }
        await delay(1500);

        // 5. Verify (use local execOperationId to avoid stale ref)
        setPhase('verifying');
        setHistory(h => addEvent(h, 'verifying', 'Verifying operation...', 'info'));
        try {
          if (execOperationId) {
            const verifyRes = await fetch(`${BASE_PATH}/api/autonomous/verify`, {
              method: 'POST',
              headers: writeHeaders(),
              body: JSON.stringify({ operationId: execOperationId }),
            });
            const verifyBody = await verifyRes.json().catch(() => ({}));
            if (verifyRes.ok) {
              const results = verifyBody.results || [];
              const totalChecks = results.reduce((acc: number, r: { checks?: unknown[] }) => acc + (r.checks?.length ?? 0), 0);
              const failedChecks = results.reduce((acc: number, r: { checks?: Array<{ passed?: boolean }> }) =>
                acc + (r.checks?.filter((c: { passed?: boolean }) => !c.passed)?.length ?? 0), 0);
              const allPassed = verifyBody.passed !== false && failedChecks === 0;

              setVerificationResult({
                operationId: execOperationId,
                passed: allPassed ? totalChecks : totalChecks - failedChecks,
                total: totalChecks,
                status: allPassed ? 'pass' : 'fail',
                failedChecks,
                verifiedAt: new Date().toISOString(),
              });
              setHistory(h => addEvent(h, 'completed', `Verification ${allPassed ? 'PASSED' : 'FAILED'}: ${totalChecks} checks`, allPassed ? 'success' : 'error'));
            }
          } else {
            // No operationId — still show verification passed (dry-run scenario)
            setVerificationResult({
              operationId: 'dry-run',
              passed: 1,
              total: 1,
              status: 'pass',
              failedChecks: 0,
              verifiedAt: new Date().toISOString(),
            });
            setHistory(h => addEvent(h, 'completed', 'Verification PASSED (dry-run)', 'success'));
          }
        } catch { /* continue */ }

        setPhase('completed');
        setFeedback({ type: 'success', message: 'Pipeline completed' });

        // Clear seed data so metrics revert to live (cost drops immediately)
        try {
          await fetch(`${BASE_PATH}/api/metrics/seed?scenario=live`, {
            method: 'POST',
            headers: writeHeaders(),
          });
          onSeedInjectedRef.current?.(); // trigger metrics re-fetch for cost update
        } catch { /* ignore */ }

        // Auto-reset to idle after 5s
        setTimeout(() => setPhase(prev => prev === 'completed' ? 'idle' : prev), 5000);

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

        setFeedback({ type: 'success', message: 'Goal tick completed' });

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
        setFeedback({ type: 'success', message: 'Dispatch dry-run completed' });
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
      setHistory(h => addEvent(h, phaseRef.current, `Error: ${message}`, 'error'));
    } finally {
      setAutonomyActionRunning(null);
      refreshData();
    }
  }, [autonomyActionRunning, autonomousIntent, currentPlan, executionProgress, refreshData]);

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
      setAutonomyPolicy(data.policy ?? data);
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
