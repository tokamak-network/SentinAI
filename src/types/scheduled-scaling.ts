/**
 * Scheduled Scaling Types
 * Time-based scaling profile and execution result.
 */

import type { TargetVcpu } from './scaling';

export interface ScheduleSlot {
  dayOfWeek: number;
  hourOfDay: number;
  targetVcpu: TargetVcpu;
  avgUtilization: number;
  sampleCount: number;
}

export interface ScheduleProfile {
  id: string;
  generatedAt: string;
  slots: ScheduleSlot[];
  metadata: {
    dataPointCount: number;
    coveragePct: number;
    avgDailyVcpu: number;
    estimatedMonthlySavings: number;
  };
}

export interface ScheduleExecutionResult {
  timestamp: string;
  slot: ScheduleSlot | null;
  previousVcpu: number;
  targetVcpu: TargetVcpu;
  executed: boolean;
  skippedReason?: 'disabled' | 'insufficient-data' | 'auto-scaling-disabled' | 'reactive-override' | 'cooldown' | 'already-at-target' | 'scale-failed';
  message: string;
}

export interface ScheduledScalingConfig {
  enabled: boolean;
  minDataDays: number;
  minSamplePerSlot: number;
  reactiveOverrideCpuPct: number;
}

export const DEFAULT_SCHEDULED_SCALING_CONFIG: ScheduledScalingConfig = {
  enabled: process.env.SCHEDULED_SCALING_ENABLED === 'true',
  minDataDays: parseInt(process.env.SCHEDULED_SCALING_MIN_DAYS || '7', 10),
  minSamplePerSlot: parseInt(process.env.SCHEDULED_SCALING_MIN_SAMPLES || '3', 10),
  reactiveOverrideCpuPct: parseInt(process.env.SCHEDULED_SCALING_REACTIVE_OVERRIDE_CPU || '80', 10),
};

