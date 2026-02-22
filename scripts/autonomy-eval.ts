#!/usr/bin/env tsx
/**
 * Autonomy evaluation runner for Proposal 25.
 * Replays deterministic scenarios and generates scorecard artifacts.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { buildGoalPlan, executeGoalPlan } from '../src/lib/goal-planner';
import { generateRuleBasedGoalCandidates } from '../src/lib/goal-candidate-generator';
import { prioritizeGoalCandidates } from '../src/lib/goal-priority-engine';
import {
  computeAutonomyScorecard,
  formatAutonomyScorecardMarkdown,
  type AutonomyEvalScenarioResult,
} from '../src/lib/autonomy-scorecard';
import type { GoalSignalSnapshot } from '../src/types/goal-manager';

type PlanReplayScenario = {
  kind: 'plan';
  scenarioId: string;
  goal: string;
  dryRun: boolean;
  allowWrites: boolean;
};

type GoalGenerationExpectation =
  | 'queue_non_empty'
  | 'suppressed_duplicate'
  | 'suppressed_low_confidence'
  | 'suppressed_stale';

type GoalGenerationScenario = {
  kind: 'goal-generation';
  scenarioId: string;
  goal: string;
  snapshot: GoalSignalSnapshot;
  expectation: GoalGenerationExpectation;
};

type ReplayScenario = PlanReplayScenario | GoalGenerationScenario;

function createSyntheticSnapshot(params: {
  snapshotId: string;
  collectedAt: string;
  cpu: number;
  txPool: number;
  activeAnomaly: number;
  criticalAnomaly: number;
  failoverRecent: number;
  avgVcpu: number;
  avgUtil: number;
  dataPoints: number;
}): GoalSignalSnapshot {
  return {
    snapshotId: params.snapshotId,
    collectedAt: params.collectedAt,
    chainType: 'thanos',
    sources: ['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory'],
    metrics: {
      latestCpuUsage: params.cpu,
      latestTxPoolPending: params.txPool,
      latestGasUsedRatio: 0.65,
      currentVcpu: 2,
      cooldownRemaining: 0,
      cpuTrend: params.cpu >= 70 ? 'rising' : 'stable',
      txPoolTrend: params.txPool >= 500 ? 'rising' : 'stable',
      gasTrend: 'stable',
    },
    anomalies: {
      activeCount: params.activeAnomaly,
      criticalCount: params.criticalAnomaly,
      latestEventTimestamp: params.activeAnomaly > 0 ? params.collectedAt : null,
    },
    failover: {
      recentCount: params.failoverRecent,
      latestEventTimestamp: params.failoverRecent > 0 ? params.collectedAt : null,
      activeL1RpcUrl: 'https://rpc.sepolia.org',
    },
    cost: {
      avgVcpu: params.avgVcpu,
      peakVcpu: Math.max(1, Math.ceil(params.avgVcpu)),
      avgUtilization: params.avgUtil,
      dataPointCount: params.dataPoints,
    },
    memory: {
      recentEntryCount: 2,
      recentIncidentCount: 1,
      recentHighSeverityCount: 0,
      latestEntryTimestamp: params.collectedAt,
    },
    policy: {
      readOnlyMode: false,
      autoScalingEnabled: true,
    },
  };
}

const SCENARIOS: ReplayScenario[] = [
  { kind: 'plan', scenarioId: 'S01', goal: 'L2 stabilize for high cpu', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S02', goal: 'generate a cost-optimization execution plan', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S03', goal: 'investigate txpool spike and run rca', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S04', goal: 'recover op node by restart strategy', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S05', goal: 'set cost-first routing and analyze effect', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S06', goal: 'analyze block delay anomaly', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S07', goal: 'stabilize with 4 vcpu target', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S08', goal: 'investigate root cause quickly', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S09', goal: 'recover from execution instability', dryRun: true, allowWrites: false },
  { kind: 'plan', scenarioId: 'S10', goal: 'custom goal for diagnostics and rca', dryRun: true, allowWrites: false },
  {
    kind: 'goal-generation',
    scenarioId: 'G01',
    goal: 'high-pressure snapshot should produce queueable goal',
    expectation: 'queue_non_empty',
    snapshot: createSyntheticSnapshot({
      snapshotId: 'goal-gen-1',
      collectedAt: new Date().toISOString(),
      cpu: 86,
      txPool: 1800,
      activeAnomaly: 1,
      criticalAnomaly: 1,
      failoverRecent: 0,
      avgVcpu: 2.6,
      avgUtil: 68,
      dataPoints: 180,
    }),
  },
  {
    kind: 'goal-generation',
    scenarioId: 'G02',
    goal: 'duplicate signature should be suppressed',
    expectation: 'suppressed_duplicate',
    snapshot: createSyntheticSnapshot({
      snapshotId: 'goal-gen-2',
      collectedAt: new Date().toISOString(),
      cpu: 80,
      txPool: 1200,
      activeAnomaly: 1,
      criticalAnomaly: 0,
      failoverRecent: 0,
      avgVcpu: 2.2,
      avgUtil: 62,
      dataPoints: 120,
    }),
  },
  {
    kind: 'goal-generation',
    scenarioId: 'G03',
    goal: 'low confidence candidate should be suppressed',
    expectation: 'suppressed_low_confidence',
    snapshot: createSyntheticSnapshot({
      snapshotId: 'goal-gen-3',
      collectedAt: new Date().toISOString(),
      cpu: 72,
      txPool: 800,
      activeAnomaly: 0,
      criticalAnomaly: 0,
      failoverRecent: 0,
      avgVcpu: 2.1,
      avgUtil: 40,
      dataPoints: 100,
    }),
  },
  {
    kind: 'goal-generation',
    scenarioId: 'G04',
    goal: 'stale snapshot should be suppressed',
    expectation: 'suppressed_stale',
    snapshot: createSyntheticSnapshot({
      snapshotId: 'goal-gen-4',
      collectedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      cpu: 90,
      txPool: 2200,
      activeAnomaly: 1,
      criticalAnomaly: 1,
      failoverRecent: 0,
      avgVcpu: 2.8,
      avgUtil: 75,
      dataPoints: 220,
    }),
  },
];

function parseBooleanFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runPlanScenario(scenario: PlanReplayScenario): Promise<AutonomyEvalScenarioResult> {
  const startedAt = Date.now();
  try {
    const plan = await buildGoalPlan(scenario.goal, scenario.dryRun);
    const withExecution = parseBooleanFlag('--with-execution');

    if (!withExecution) {
      const planFailed =
        plan.failureReasonCode &&
        plan.failureReasonCode !== 'none' &&
        plan.failureReasonCode !== 'fallback_rule_based';
      return {
        scenarioId: scenario.scenarioId,
        goal: scenario.goal,
        completed: plan.steps.length > 0 && !planFailed,
        falseActionCount: planFailed ? 1 : 0,
        policyViolationCount: 0,
        rollbackTriggered: 0,
        rollbackSucceeded: 0,
        timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        errors: planFailed ? [`plan failure reason: ${plan.failureReasonCode}`] : [],
      };
    }

    const executed = await executeGoalPlan(plan, {
      dryRun: scenario.dryRun,
      allowWrites: scenario.allowWrites,
      initiatedBy: 'scheduler',
    });

    const failedSteps = executed.plan.steps.filter((step) => step.status === 'failed');
    const rollbackTriggered = executed.executionLog.filter((log) => log.message.includes('rollback')).length;
    const rollbackSucceeded = executed.executionLog.filter((log) => log.message.includes('rollback:')).length;

    return {
      scenarioId: scenario.scenarioId,
      goal: scenario.goal,
      completed: executed.plan.status === 'completed',
      falseActionCount: failedSteps.length,
      policyViolationCount: 0,
      rollbackTriggered,
      rollbackSucceeded,
      timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      errors: failedSteps.map((step) => step.resultSummary || `${step.action} failed`),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scenario error';
    return {
      scenarioId: scenario.scenarioId,
      goal: scenario.goal,
      completed: false,
      falseActionCount: 1,
      policyViolationCount: 0,
      rollbackTriggered: 0,
      rollbackSucceeded: 0,
      timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      errors: [message],
    };
  }
}

async function runGoalGenerationScenario(scenario: GoalGenerationScenario): Promise<AutonomyEvalScenarioResult> {
  const startedAt = Date.now();

  try {
    const now = Date.now();
    let candidates = generateRuleBasedGoalCandidates(scenario.snapshot, {
      now,
      llmEnhancerEnabled: false,
      maxCandidates: 6,
    });

    if (candidates.length === 0) {
      return {
        scenarioId: scenario.scenarioId,
        goal: scenario.goal,
        completed: false,
        falseActionCount: 1,
        policyViolationCount: 0,
        rollbackTriggered: 0,
        rollbackSucceeded: 0,
        timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        errors: ['no candidates generated'],
      };
    }

    if (scenario.expectation === 'suppressed_low_confidence') {
      candidates = candidates.map((candidate, index) => (
        index === 0
          ? { ...candidate, confidence: 0.2, updatedAt: new Date(now).toISOString() }
          : candidate
      ));
    }

    const existingQueue = scenario.expectation === 'suppressed_duplicate'
      ? [{
          goalId: 'existing-goal-1',
          candidateId: 'existing-candidate-1',
          enqueuedAt: new Date(now - 60_000).toISOString(),
          attempts: 0,
          status: 'queued' as const,
          goal: 'existing duplicate',
          intent: candidates[0].intent,
          source: candidates[0].source,
          risk: candidates[0].risk,
          confidence: candidates[0].confidence,
          signature: candidates[0].signature,
          score: { impact: 20, urgency: 10, confidence: 10, policyFit: 8, total: 48 },
        }]
      : [];

    const prioritized = prioritizeGoalCandidates({
      snapshot: scenario.snapshot,
      candidates,
      existingQueue,
      now,
      policy: {
        staleSignalMinutes: scenario.expectation === 'suppressed_stale' ? 60 : 90,
      },
    });

    const hasSuppressed = (reason: string): boolean => (
      prioritized.suppressed.some((record) => record.reasonCode === reason)
    );

    const expectationPassed = (
      (scenario.expectation === 'queue_non_empty' && prioritized.queued.length > 0) ||
      (scenario.expectation === 'suppressed_duplicate' && hasSuppressed('duplicate_goal')) ||
      (scenario.expectation === 'suppressed_low_confidence' && hasSuppressed('low_confidence')) ||
      (scenario.expectation === 'suppressed_stale' && hasSuppressed('stale_signal'))
    );

    return {
      scenarioId: scenario.scenarioId,
      goal: scenario.goal,
      completed: expectationPassed,
      falseActionCount: expectationPassed ? 0 : 1,
      policyViolationCount: 0,
      rollbackTriggered: 0,
      rollbackSucceeded: 0,
      timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      errors: expectationPassed
        ? []
        : [`expectation not met: ${scenario.expectation}`],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scenario error';
    return {
      scenarioId: scenario.scenarioId,
      goal: scenario.goal,
      completed: false,
      falseActionCount: 1,
      policyViolationCount: 0,
      rollbackTriggered: 0,
      rollbackSucceeded: 0,
      timeToStabilitySec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      errors: [message],
    };
  }
}

async function runScenario(scenario: ReplayScenario): Promise<AutonomyEvalScenarioResult> {
  if (scenario.kind === 'plan') {
    return runPlanScenario(scenario);
  }
  return runGoalGenerationScenario(scenario);
}

async function main(): Promise<void> {
  // Keep replay deterministic and offline by default.
  process.env.GOAL_PLANNER_LLM_ENABLED = process.env.GOAL_PLANNER_LLM_ENABLED || 'false';

  const strictMode = parseBooleanFlag('--strict') || process.env.AUTONOMY_EVAL_STRICT === 'true';
  const outputDir = path.resolve(process.cwd(), 'docs/verification');
  await mkdir(outputDir, { recursive: true });

  const results: AutonomyEvalScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  const scorecard = computeAutonomyScorecard(results);
  const markdown = formatAutonomyScorecardMarkdown(scorecard);
  const jsonPath = path.join(outputDir, 'proposal-25-autonomy-eval-latest.json');
  const markdownPath = path.join(outputDir, 'proposal-25-autonomy-eval-latest.md');

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(scorecard, null, 2), 'utf-8'),
    writeFile(markdownPath, markdown, 'utf-8'),
  ]);

  console.info(`[autonomy-eval] scenarios=${scorecard.scenarioCount} passed=${scorecard.passed}`);
  console.info(`[autonomy-eval] report-json=${jsonPath}`);
  console.info(`[autonomy-eval] report-md=${markdownPath}`);

  if (strictMode && !scorecard.passed) {
    console.error('[autonomy-eval] strict mode enabled and scorecard failed checks.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown fatal error';
  console.error(`[autonomy-eval] fatal: ${message}`);
  process.exitCode = 1;
});
