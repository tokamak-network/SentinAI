/**
 * Unit Tests for Action Whitelist
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_GOAL_PLAN_ACTIONS,
  WhitelistViolationError,
  isGoalPlanActionAllowed,
  assertGoalPlanActionAllowed,
} from '@/lib/action-whitelist';

describe('ALLOWED_GOAL_PLAN_ACTIONS', () => {
  it('contains the 6 expected actions', () => {
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('collect_state');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('inspect_anomalies');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('run_rca');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('scale_execution');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('restart_execution');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toContain('set_routing_policy');
    expect(ALLOWED_GOAL_PLAN_ACTIONS).toHaveLength(6);
  });
});

describe('isGoalPlanActionAllowed', () => {
  it('returns true for whitelisted actions', () => {
    expect(isGoalPlanActionAllowed('scale_execution')).toBe(true);
    expect(isGoalPlanActionAllowed('run_rca')).toBe(true);
  });

  it('returns false for unlisted actions', () => {
    expect(isGoalPlanActionAllowed('drop_database')).toBe(false);
    expect(isGoalPlanActionAllowed('')).toBe(false);
    expect(isGoalPlanActionAllowed('restart_pod')).toBe(false);
  });
});

describe('assertGoalPlanActionAllowed', () => {
  it('does not throw for whitelisted actions', () => {
    expect(() => assertGoalPlanActionAllowed('collect_state')).not.toThrow();
  });

  it('throws WhitelistViolationError for unlisted actions', () => {
    expect(() => assertGoalPlanActionAllowed('evil_action', 'test')).toThrow(WhitelistViolationError);
  });

  it('includes action name and context in error', () => {
    try {
      assertGoalPlanActionAllowed('forbidden_op', 'mcp-tool');
    } catch (e) {
      expect(e).toBeInstanceOf(WhitelistViolationError);
      if (e instanceof WhitelistViolationError) {
        expect(e.action).toBe('forbidden_op');
        expect(e.context).toBe('mcp-tool');
        expect(e.message).toContain('forbidden_op');
      }
    }
  });
});
