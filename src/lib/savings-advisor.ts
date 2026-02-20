/**
 * Savings Plans Advisor
 * Pure analysis module based on local usage history.
 */

import { getUsageData, getUsageSummary } from '@/lib/usage-tracker';
import type {
  CommitmentOption,
  SavingsAdvice,
  SavingsAdvisorConfig,
  UsagePercentiles,
} from '@/types/savings-advisor';
import {
  DEFAULT_SAVINGS_ADVISOR_CONFIG,
  FARGATE_SAVINGS_PRICING,
} from '@/types/savings-advisor';
import type { UsageDataPoint } from '@/types/cost';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function calculateUsagePercentiles(
  data: UsageDataPoint[],
  periodDays: number
): UsagePercentiles {
  const values = data.map(d => d.vcpu).sort((a, b) => a - b);
  const count = values.length;
  const avg = count > 0 ? values.reduce((sum, v) => sum + v, 0) / count : 0;

  return {
    p10: round2(percentile(values, 10)),
    p25: round2(percentile(values, 25)),
    p50: round2(percentile(values, 50)),
    p75: round2(percentile(values, 75)),
    p90: round2(percentile(values, 90)),
    p99: round2(percentile(values, 99)),
    min: round2(count > 0 ? values[0] : 0),
    max: round2(count > 0 ? values[count - 1] : 0),
    avg: round2(avg),
    dataPointCount: count,
    periodDays,
  };
}

function simulateCommitment(
  name: CommitmentOption['name'],
  label: string,
  committedVcpu: number,
  data: UsageDataPoint[]
): CommitmentOption {
  const onDemand = FARGATE_SAVINGS_PRICING.onDemandVcpuPerHour;
  const savingsPlan = FARGATE_SAVINGS_PRICING.savingsPlanVcpuPerHour;
  const monthlyHours = FARGATE_SAVINGS_PRICING.hoursPerMonth;

  const committedHourlyRate = committedVcpu * savingsPlan;
  const committedMonthlyRate = committedHourlyRate * monthlyHours;

  let onDemandMonthlyBaseline = 0;
  let effectiveMonthlyTotal = 0;
  let overCommitmentHours = 0;
  let underCommitmentHours = 0;
  let overCommitmentMonthlyWaste = 0;

  for (const point of data) {
    const actual = point.vcpu;
    const baselineHour = actual * onDemand;
    onDemandMonthlyBaseline += baselineHour;

    const covered = Math.min(actual, committedVcpu);
    const excess = Math.max(0, actual - committedVcpu);
    const effectiveHour = covered * savingsPlan + excess * onDemand;
    effectiveMonthlyTotal += effectiveHour;

    if (committedVcpu > actual) {
      overCommitmentHours += 1;
      overCommitmentMonthlyWaste += (committedVcpu - actual) * savingsPlan;
    } else if (actual > committedVcpu) {
      underCommitmentHours += 1;
    }
  }

  const count = Math.max(1, data.length);
  const scaleToMonth = monthlyHours / count;
  onDemandMonthlyBaseline *= scaleToMonth;
  effectiveMonthlyTotal *= scaleToMonth;
  overCommitmentMonthlyWaste *= scaleToMonth;

  const savingsVsOnDemand = onDemandMonthlyBaseline - effectiveMonthlyTotal;
  const savingsPct = onDemandMonthlyBaseline > 0
    ? (savingsVsOnDemand / onDemandMonthlyBaseline) * 100
    : 0;

  const avgVcpuObserved = data.reduce((sum, p) => sum + p.vcpu, 0) / count;
  const effectiveVcpuRate = avgVcpuObserved > 0
    ? effectiveMonthlyTotal / (avgVcpuObserved * monthlyHours)
    : 0;

  return {
    name,
    label,
    committedVcpu: round2(committedVcpu),
    committedHourlyRate: round2(committedHourlyRate),
    committedMonthlyRate: round2(committedMonthlyRate),
    savingsVsOnDemand: round2(savingsVsOnDemand),
    savingsPct: round2(Math.max(0, savingsPct)),
    annualSavings: round2(Math.max(0, savingsVsOnDemand) * 12),
    overCommitmentPct: round2((overCommitmentHours / count) * 100),
    overCommitmentMonthlyWaste: round2(Math.max(0, overCommitmentMonthlyWaste)),
    underCommitmentPct: round2((underCommitmentHours / count) * 100),
    effectiveMonthlyTotal: round2(effectiveMonthlyTotal),
    effectiveVcpuRate: round2(effectiveVcpuRate),
  };
}

function buildRecommendation(options: CommitmentOption[]): string {
  const recommended = options.find(o => o.name === 'recommended') || options[0];
  if (!recommended) {
    return 'Usage data is insufficient to provide a Savings Plans recommendation.';
  }

  return `추천 커밋은 ${recommended.label} (${recommended.committedVcpu} vCPU)입니다. 예상 절감은 월 $${recommended.savingsVsOnDemand.toFixed(2)} (${recommended.savingsPct.toFixed(1)}%) 수준입니다.`;
}

export async function generateSavingsAdvice(
  days: number = 30,
  configOverrides?: Partial<SavingsAdvisorConfig>
): Promise<SavingsAdvice | null> {
  const config: SavingsAdvisorConfig = { ...DEFAULT_SAVINGS_ADVISOR_CONFIG, ...configOverrides };
  if (!config.enabled) return null;

  const effectiveDays = Math.max(1, Math.min(days, 90));
  const [data, summary] = await Promise.all([
    getUsageData(effectiveDays),
    getUsageSummary(effectiveDays),
  ]);

  if (
    data.length === 0 ||
    effectiveDays < config.minDataDays ||
    summary.oldestDataAge < config.minDataDays * 24
  ) {
    return null;
  }

  const percentiles = calculateUsagePercentiles(data, effectiveDays);

  const conservativeVcpu = Math.max(0.25, percentiles.p10);
  const recommendedVcpu = Math.max(0.25, percentiles.avg);
  const aggressiveVcpu = Math.max(0.25, percentiles.p50);

  const options: CommitmentOption[] = [
    simulateCommitment('conservative', '보수적 (p10)', conservativeVcpu, data),
    simulateCommitment('recommended', '권장 (평균)', recommendedVcpu, data),
    simulateCommitment('aggressive', '공격적 (p50)', aggressiveVcpu, data),
  ];

  return {
    id: `savings-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    dataSource: {
      periodDays: effectiveDays,
      dataPointCount: summary.dataPointCount,
      oldestDataAge: summary.oldestDataAge,
    },
    percentiles,
    options,
    recommendation: buildRecommendation(options),
    awsPurchaseUrl: 'https://console.aws.amazon.com/cost-management/home#/savingsPlans/recommendations',
    caveats: [
      '이 분석은 로컬 usage data 기준 추정치입니다.',
      '실제 청구는 메모리/리전/워크로드 변동에 따라 달라질 수 있습니다.',
      '과도한 커밋은 사용량 하락 시 낭비 비용을 유발할 수 있습니다.',
    ],
  };
}
