/**
 * Autonomy Scorecard
 * Computes release-gate metrics from deterministic scenario replay results.
 */

export interface AutonomyEvalScenarioResult {
  scenarioId: string;
  goal: string;
  completed: boolean;
  falseActionCount: number;
  policyViolationCount: number;
  rollbackTriggered: number;
  rollbackSucceeded: number;
  timeToStabilitySec: number;
  errors?: string[];
}

export interface AutonomyThresholds {
  minGoalCompletionRate: number;
  maxFalseActionRate: number;
  maxPolicyViolationCount: number;
  minRollbackSuccessRate: number;
  maxMedianTimeToStabilitySec: number;
}

export interface AutonomyScorecard {
  generatedAt: string;
  scenarioCount: number;
  metrics: {
    goalCompletionRate: number;
    falseActionRate: number;
    policyViolationCount: number;
    rollbackSuccessRate: number;
    medianTimeToStabilitySec: number;
  };
  thresholds: AutonomyThresholds;
  passed: boolean;
  failedChecks: string[];
  scenarios: AutonomyEvalScenarioResult[];
}

const DEFAULT_THRESHOLDS: AutonomyThresholds = {
  minGoalCompletionRate: 0.85,
  maxFalseActionRate: 0.1,
  maxPolicyViolationCount: 0,
  minRollbackSuccessRate: 0.95,
  maxMedianTimeToStabilitySec: 180,
};

function round(value: number, digits: number = 4): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computeAutonomyScorecard(
  scenarios: AutonomyEvalScenarioResult[],
  thresholds: Partial<AutonomyThresholds> = {}
): AutonomyScorecard {
  const mergedThresholds: AutonomyThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const scenarioCount = scenarios.length;
  const completedCount = scenarios.filter((scenario) => scenario.completed).length;
  const falseActionCount = scenarios.reduce((sum, scenario) => sum + scenario.falseActionCount, 0);
  const policyViolationCount = scenarios.reduce((sum, scenario) => sum + scenario.policyViolationCount, 0);
  const rollbackTriggered = scenarios.reduce((sum, scenario) => sum + scenario.rollbackTriggered, 0);
  const rollbackSucceeded = scenarios.reduce((sum, scenario) => sum + scenario.rollbackSucceeded, 0);
  const timeValues = scenarios.map((scenario) => scenario.timeToStabilitySec);

  const goalCompletionRate = scenarioCount === 0 ? 0 : completedCount / scenarioCount;
  const falseActionRate = scenarioCount === 0 ? 0 : falseActionCount / scenarioCount;
  const rollbackSuccessRate = rollbackTriggered === 0 ? 1 : rollbackSucceeded / rollbackTriggered;
  const medianTimeToStabilitySec = calculateMedian(timeValues);

  const failedChecks: string[] = [];
  if (goalCompletionRate < mergedThresholds.minGoalCompletionRate) {
    failedChecks.push(`goalCompletionRate(${round(goalCompletionRate)}) < ${mergedThresholds.minGoalCompletionRate}`);
  }
  if (falseActionRate > mergedThresholds.maxFalseActionRate) {
    failedChecks.push(`falseActionRate(${round(falseActionRate)}) > ${mergedThresholds.maxFalseActionRate}`);
  }
  if (policyViolationCount > mergedThresholds.maxPolicyViolationCount) {
    failedChecks.push(`policyViolationCount(${policyViolationCount}) > ${mergedThresholds.maxPolicyViolationCount}`);
  }
  if (rollbackSuccessRate < mergedThresholds.minRollbackSuccessRate) {
    failedChecks.push(`rollbackSuccessRate(${round(rollbackSuccessRate)}) < ${mergedThresholds.minRollbackSuccessRate}`);
  }
  if (medianTimeToStabilitySec > mergedThresholds.maxMedianTimeToStabilitySec) {
    failedChecks.push(
      `medianTimeToStabilitySec(${round(medianTimeToStabilitySec)}) > ${mergedThresholds.maxMedianTimeToStabilitySec}`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount,
    metrics: {
      goalCompletionRate: round(goalCompletionRate),
      falseActionRate: round(falseActionRate),
      policyViolationCount,
      rollbackSuccessRate: round(rollbackSuccessRate),
      medianTimeToStabilitySec: round(medianTimeToStabilitySec, 2),
    },
    thresholds: mergedThresholds,
    passed: failedChecks.length === 0,
    failedChecks,
    scenarios,
  };
}

export function formatAutonomyScorecardMarkdown(scorecard: AutonomyScorecard): string {
  const lines: string[] = [];
  lines.push('# Proposal 25 Autonomy Eval Report');
  lines.push('');
  lines.push(`- Generated At: ${scorecard.generatedAt}`);
  lines.push(`- Scenarios: ${scorecard.scenarioCount}`);
  lines.push(`- Result: ${scorecard.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value | Threshold |');
  lines.push('|---|---:|---:|');
  lines.push(`| Goal completion rate | ${scorecard.metrics.goalCompletionRate} | >= ${scorecard.thresholds.minGoalCompletionRate} |`);
  lines.push(`| False action rate | ${scorecard.metrics.falseActionRate} | <= ${scorecard.thresholds.maxFalseActionRate} |`);
  lines.push(`| Policy violation count | ${scorecard.metrics.policyViolationCount} | <= ${scorecard.thresholds.maxPolicyViolationCount} |`);
  lines.push(`| Rollback success rate | ${scorecard.metrics.rollbackSuccessRate} | >= ${scorecard.thresholds.minRollbackSuccessRate} |`);
  lines.push(`| Median time-to-stability (sec) | ${scorecard.metrics.medianTimeToStabilitySec} | <= ${scorecard.thresholds.maxMedianTimeToStabilitySec} |`);
  lines.push('');

  if (scorecard.failedChecks.length > 0) {
    lines.push('## Failed Checks');
    lines.push('');
    for (const failed of scorecard.failedChecks) {
      lines.push(`- ${failed}`);
    }
    lines.push('');
  }

  lines.push('## Scenario Results');
  lines.push('');
  lines.push('| Scenario | Completed | False Actions | Policy Violations | Rollback (ok/total) | TTS (sec) |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const scenario of scorecard.scenarios) {
    lines.push(
      `| ${scenario.scenarioId} | ${scenario.completed ? 'yes' : 'no'} | ${scenario.falseActionCount} | ${scenario.policyViolationCount} | ${scenario.rollbackSucceeded}/${scenario.rollbackTriggered} | ${scenario.timeToStabilitySec} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}
