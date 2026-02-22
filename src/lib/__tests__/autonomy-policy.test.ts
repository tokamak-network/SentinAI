import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getRuntimeAutonomyPolicy,
  resetRuntimeAutonomyPolicy,
  setRuntimeAutonomyPolicy,
} from '@/lib/autonomy-policy';

describe('autonomy-policy', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.GOAL_AUTONOMY_LEVEL;
    delete process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN;
    delete process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE;
    resetRuntimeAutonomyPolicy();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetRuntimeAutonomyPolicy();
  });

  it('should load default policy from env', () => {
    process.env.GOAL_AUTONOMY_LEVEL = 'A4';
    process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_DRY_RUN = '0.25';
    process.env.GOAL_AUTONOMY_MIN_CONFIDENCE_WRITE = '0.77';
    resetRuntimeAutonomyPolicy();

    const policy = getRuntimeAutonomyPolicy();
    expect(policy.level).toBe('A4');
    expect(policy.minConfidenceDryRun).toBe(0.25);
    expect(policy.minConfidenceWrite).toBe(0.77);
  });

  it('should update runtime policy values', () => {
    const updated = setRuntimeAutonomyPolicy({
      level: 'A5',
      minConfidenceDryRun: 0.4,
      minConfidenceWrite: 0.85,
    });

    expect(updated.level).toBe('A5');
    expect(updated.minConfidenceDryRun).toBe(0.4);
    expect(updated.minConfidenceWrite).toBe(0.85);
    expect(getRuntimeAutonomyPolicy().level).toBe('A5');
  });
});
