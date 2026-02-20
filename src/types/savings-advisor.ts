/**
 * Savings Plans Advisor Types
 * Analyze historical usage and simulate commitment options.
 */

export interface UsagePercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  dataPointCount: number;
  periodDays: number;
}

export interface CommitmentOption {
  name: 'conservative' | 'recommended' | 'aggressive' | 'custom';
  label: string;
  committedVcpu: number;
  committedHourlyRate: number;
  committedMonthlyRate: number;
  savingsVsOnDemand: number;
  savingsPct: number;
  annualSavings: number;
  overCommitmentPct: number;
  overCommitmentMonthlyWaste: number;
  underCommitmentPct: number;
  effectiveMonthlyTotal: number;
  effectiveVcpuRate: number;
}

export interface SavingsAdvice {
  id: string;
  generatedAt: string;
  dataSource: {
    periodDays: number;
    dataPointCount: number;
    oldestDataAge: number;
  };
  percentiles: UsagePercentiles;
  options: CommitmentOption[];
  recommendation: string;
  awsPurchaseUrl: string;
  caveats: string[];
}

export interface SavingsAdvisorConfig {
  enabled: boolean;
  minDataDays: number;
  savingsRate: number;
}

export const DEFAULT_SAVINGS_ADVISOR_CONFIG: SavingsAdvisorConfig = {
  enabled: true,
  minDataDays: 30,
  savingsRate: 0.5,
};

export const FARGATE_SAVINGS_PRICING = {
  onDemandVcpuPerHour: 0.04656,
  savingsPlanVcpuPerHour: 0.02328,
  hoursPerMonth: 730,
  hoursPerYear: 8760,
};

