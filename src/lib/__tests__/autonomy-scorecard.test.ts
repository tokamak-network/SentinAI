import { describe, expect, it } from 'vitest';
import {
  computeAutonomyScorecard,
  formatAutonomyScorecardMarkdown,
} from '@/lib/autonomy-scorecard';

describe('autonomy-scorecard', () => {
  it('should compute pass result with healthy metrics', () => {
    const scorecard = computeAutonomyScorecard([
      {
        scenarioId: 's1',
        goal: 'stabilize',
        completed: true,
        falseActionCount: 0,
        policyViolationCount: 0,
        rollbackTriggered: 1,
        rollbackSucceeded: 1,
        timeToStabilitySec: 80,
      },
      {
        scenarioId: 's2',
        goal: 'investigate',
        completed: true,
        falseActionCount: 0,
        policyViolationCount: 0,
        rollbackTriggered: 0,
        rollbackSucceeded: 0,
        timeToStabilitySec: 50,
      },
    ]);

    expect(scorecard.passed).toBe(true);
    expect(scorecard.metrics.goalCompletionRate).toBe(1);
  });

  it('should mark fail when policy violations exist', () => {
    const scorecard = computeAutonomyScorecard([
      {
        scenarioId: 's1',
        goal: 'write action',
        completed: true,
        falseActionCount: 0,
        policyViolationCount: 1,
        rollbackTriggered: 0,
        rollbackSucceeded: 0,
        timeToStabilitySec: 10,
      },
    ]);

    expect(scorecard.passed).toBe(false);
    expect(scorecard.failedChecks.some((item) => item.includes('policyViolationCount'))).toBe(true);
  });

  it('should render markdown summary', () => {
    const scorecard = computeAutonomyScorecard([]);
    const markdown = formatAutonomyScorecardMarkdown(scorecard);
    expect(markdown).toContain('Autonomy Eval Report');
  });
});
