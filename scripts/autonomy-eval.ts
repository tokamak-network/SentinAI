#!/usr/bin/env tsx
/**
 * Autonomy evaluation runner for Proposal 25.
 * Replays deterministic scenarios and generates scorecard artifacts.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { buildGoalPlan, executeGoalPlan } from '../src/lib/goal-planner';
import {
  computeAutonomyScorecard,
  formatAutonomyScorecardMarkdown,
  type AutonomyEvalScenarioResult,
} from '../src/lib/autonomy-scorecard';

type ReplayScenario = {
  scenarioId: string;
  goal: string;
  dryRun: boolean;
  allowWrites: boolean;
};

const SCENARIOS: ReplayScenario[] = [
  { scenarioId: 'S01', goal: 'L2 stabilize for high cpu', dryRun: true, allowWrites: false },
  { scenarioId: 'S02', goal: '비용 최적화 실행 계획 생성', dryRun: true, allowWrites: false },
  { scenarioId: 'S03', goal: 'investigate txpool spike and run rca', dryRun: true, allowWrites: false },
  { scenarioId: 'S04', goal: 'recover op node by restart strategy', dryRun: true, allowWrites: false },
  { scenarioId: 'S05', goal: 'set cost-first routing and analyze effect', dryRun: true, allowWrites: false },
  { scenarioId: 'S06', goal: 'analyze block delay anomaly', dryRun: true, allowWrites: false },
  { scenarioId: 'S07', goal: 'stabilize with 4 vcpu target', dryRun: true, allowWrites: false },
  { scenarioId: 'S08', goal: 'investigate root cause quickly', dryRun: true, allowWrites: false },
  { scenarioId: 'S09', goal: 'recover from execution instability', dryRun: true, allowWrites: false },
  { scenarioId: 'S10', goal: 'custom goal for diagnostics and rca', dryRun: true, allowWrites: false },
];

function parseBooleanFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runScenario(scenario: ReplayScenario): Promise<AutonomyEvalScenarioResult> {
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
