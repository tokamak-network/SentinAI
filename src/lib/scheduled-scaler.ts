/**
 * Scheduled Scaler
 * Execute hourly scaling based on learned usage pattern.
 */

import { analyzePatterns, getUsageSummary } from '@/lib/usage-tracker';
import { getRecentMetrics } from '@/lib/metrics-store';
import {
  addScalingHistory,
  checkCooldown,
  getCurrentVcpu,
  isAutoScalingEnabled,
  scaleOpGeth,
} from '@/lib/k8s-scaler';
import type { TargetVcpu } from '@/types/scaling';
import type {
  ScheduleExecutionResult,
  ScheduleProfile,
  ScheduleSlot,
  ScheduledScalingConfig,
} from '@/types/scheduled-scaling';
import { DEFAULT_SCHEDULED_SCALING_CONFIG } from '@/types/scheduled-scaling';

const globalForScheduledScaling = globalThis as unknown as {
  __sentinai_schedule_profile?: ScheduleProfile;
};

function mapAvgVcpuToTarget(avgVcpu: number): TargetVcpu {
  if (avgVcpu >= 3.5) return 4;
  if (avgVcpu >= 1.5) return 2;
  return 1;
}

function getKstParts(now: Date): { dayOfWeek: number; hourOfDay: number } {
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return { dayOfWeek: kst.getDay(), hourOfDay: kst.getHours() };
}

function estimateMonthlyCost(vcpu: number): number {
  const vcpuPerHour = 0.04656;
  const memPerHour = 0.00511;
  const memGiB = vcpu * 2;
  return (vcpu * vcpuPerHour + memGiB * memPerHour) * 730;
}

export async function buildScheduleProfile(
  days: number = 7,
  configOverrides?: Partial<ScheduledScalingConfig>
): Promise<ScheduleProfile | null> {
  const config: ScheduledScalingConfig = { ...DEFAULT_SCHEDULED_SCALING_CONFIG, ...configOverrides };
  const effectiveDays = Math.max(1, Math.min(days, 30));

  const [patterns, summary] = await Promise.all([
    analyzePatterns(effectiveDays),
    getUsageSummary(effectiveDays),
  ]);

  if (effectiveDays < config.minDataDays || summary.dataPointCount === 0) {
    return null;
  }

  const slots: ScheduleSlot[] = [];
  const patternMap = new Map<string, (typeof patterns)[number]>();
  for (const pattern of patterns) {
    patternMap.set(`${pattern.dayOfWeek}-${pattern.hourOfDay}`, pattern);
  }

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const pattern = patternMap.get(key);
      if (!pattern || pattern.sampleCount < config.minSamplePerSlot) {
        slots.push({
          dayOfWeek: day,
          hourOfDay: hour,
          targetVcpu: 1,
          avgUtilization: 0,
          sampleCount: pattern?.sampleCount || 0,
        });
        continue;
      }

      slots.push({
        dayOfWeek: day,
        hourOfDay: hour,
        targetVcpu: mapAvgVcpuToTarget(pattern.avgVcpu),
        avgUtilization: pattern.avgUtilization,
        sampleCount: pattern.sampleCount,
      });
    }
  }

  const avgDailyVcpu = slots.reduce((sum, slot) => sum + slot.targetVcpu, 0) / slots.length;
  const fixed2Cost = estimateMonthlyCost(2);
  const scheduledCost = estimateMonthlyCost(avgDailyVcpu);

  const profile: ScheduleProfile = {
    id: `sched-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    slots,
    metadata: {
      dataPointCount: summary.dataPointCount,
      coveragePct: Math.round((patterns.length / 168) * 100),
      avgDailyVcpu: Math.round(avgDailyVcpu * 100) / 100,
      estimatedMonthlySavings: Math.round((fixed2Cost - scheduledCost) * 100) / 100,
    },
  };

  globalForScheduledScaling.__sentinai_schedule_profile = profile;
  return profile;
}

export function getCurrentScheduledSlot(profile: ScheduleProfile, now: Date = new Date()): ScheduleSlot | null {
  const { dayOfWeek, hourOfDay } = getKstParts(now);
  return profile.slots.find(slot => slot.dayOfWeek === dayOfWeek && slot.hourOfDay === hourOfDay) || null;
}

export function getCachedScheduleProfile(): ScheduleProfile | null {
  return globalForScheduledScaling.__sentinai_schedule_profile || null;
}

export async function applyScheduledScaling(
  configOverrides?: Partial<ScheduledScalingConfig>
): Promise<ScheduleExecutionResult> {
  const config: ScheduledScalingConfig = { ...DEFAULT_SCHEDULED_SCALING_CONFIG, ...configOverrides };
  const timestamp = new Date().toISOString();
  const currentVcpu = await getCurrentVcpu();

  if (!config.enabled) {
    return {
      timestamp,
      slot: null,
      previousVcpu: currentVcpu,
      targetVcpu: currentVcpu as TargetVcpu,
      executed: false,
      skippedReason: 'disabled',
      message: 'Scheduled scaling is disabled.',
    };
  }

  if (!(await isAutoScalingEnabled())) {
    return {
      timestamp,
      slot: null,
      previousVcpu: currentVcpu,
      targetVcpu: currentVcpu as TargetVcpu,
      executed: false,
      skippedReason: 'auto-scaling-disabled',
      message: 'Auto-scaling is disabled, skipping scheduled scaling.',
    };
  }

  const profile = getCachedScheduleProfile() || await buildScheduleProfile(config.minDataDays, config);
  if (!profile) {
    return {
      timestamp,
      slot: null,
      previousVcpu: currentVcpu,
      targetVcpu: currentVcpu as TargetVcpu,
      executed: false,
      skippedReason: 'insufficient-data',
      message: 'Insufficient usage data for scheduled scaling.',
    };
  }

  const slot = getCurrentScheduledSlot(profile);
  if (!slot) {
    return {
      timestamp,
      slot: null,
      previousVcpu: currentVcpu,
      targetVcpu: currentVcpu as TargetVcpu,
      executed: false,
      skippedReason: 'insufficient-data',
      message: 'Could not find a schedule slot for the current time.',
    };
  }

  if (slot.targetVcpu === currentVcpu) {
    return {
      timestamp,
      slot,
      previousVcpu: currentVcpu,
      targetVcpu: slot.targetVcpu,
      executed: false,
      skippedReason: 'already-at-target',
      message: 'Already at the scheduled target vCPU.',
    };
  }

  const cooldown = await checkCooldown();
  if (cooldown.inCooldown) {
    return {
      timestamp,
      slot,
      previousVcpu: currentVcpu,
      targetVcpu: slot.targetVcpu,
      executed: false,
      skippedReason: 'cooldown',
      message: `In cooldown. Retry after ${cooldown.remainingSeconds}s.`,
    };
  }

  const recentMetrics = await getRecentMetrics(1);
  const latestCpu = recentMetrics[0]?.cpuUsage;
  if (typeof latestCpu === 'number' && latestCpu >= config.reactiveOverrideCpuPct && slot.targetVcpu < currentVcpu) {
    return {
      timestamp,
      slot,
      previousVcpu: currentVcpu,
      targetVcpu: slot.targetVcpu,
      executed: false,
      skippedReason: 'reactive-override',
      message: `Live CPU is high at ${latestCpu.toFixed(1)}%, deferring scheduled scale-down.`,
    };
  }

  const result = await scaleOpGeth(slot.targetVcpu, (slot.targetVcpu * 2) as 2 | 4 | 8 | 16);
  if (!result.success) {
    return {
      timestamp,
      slot,
      previousVcpu: currentVcpu,
      targetVcpu: slot.targetVcpu,
      executed: false,
      skippedReason: 'scale-failed',
      message: `Scheduled scaling failed: ${result.message}`,
    };
  }

  await addScalingHistory({
    timestamp,
    fromVcpu: currentVcpu,
    toVcpu: slot.targetVcpu,
    reason: `scheduled-scaling (day=${slot.dayOfWeek}, hour=${slot.hourOfDay})`,
    triggeredBy: 'cron',
  });

  return {
    timestamp,
    slot,
    previousVcpu: currentVcpu,
    targetVcpu: slot.targetVcpu,
    executed: true,
    message: `Scheduled scaling applied: ${currentVcpu} → ${slot.targetVcpu} vCPU`,
  };
}
