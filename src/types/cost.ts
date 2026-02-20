/**
 * AI Cost Optimizer Types
 * Type definitions for vCPU usage pattern analysis and cost optimization recommendations
 */

/**
 * Time-based usage pattern
 * Statistics for each cell in the 7-day x 24-hour matrix
 */
export interface UsagePattern {
  hourOfDay: number;
  dayOfWeek: number;
  avgVcpu: number;
  peakVcpu: number;
  avgUtilization: number;
  sampleCount: number;
}

/**
 * Cost optimization recommendation
 */
export interface CostRecommendation {
  type: 'downscale' | 'schedule' | 'reserved' | 'right-size';
  title: string;
  description: string;
  currentCost: number;
  projectedCost: number;
  savingsPercent: number;
  confidence: number;
  implementation: string;
  risk: 'low' | 'medium' | 'high';
}

/**
 * Cost analysis report
 */
export interface CostReport {
  id: string;
  generatedAt: string;
  currentMonthly: number;
  optimizedMonthly: number;
  totalSavingsPercent: number;
  recommendations: CostRecommendation[];
  usagePatterns: UsagePattern[];
  aiInsight: string;
  periodDays: number;
  savingsAdvice?: {
    id: string;
    generatedAt: string;
    recommendation: string;
    options: Array<{
      name: string;
      label: string;
      committedVcpu: number;
      savingsVsOnDemand: number;
      savingsPct: number;
      overCommitmentPct: number;
      underCommitmentPct: number;
    }>;
  } | null;
}

/**
 * Usage data point (internal storage)
 */
export interface UsageDataPoint {
  timestamp: number;
  vcpu: number;
  cpuUtilization: number;
}

/**
 * 24-hour profile (hourly summary)
 */
export interface HourlyProfile {
  hour: number;
  avgVcpu: number;
  avgUtilization: number;
}

/**
 * Fargate pricing constants (Seoul region)
 */
export const FARGATE_PRICING = {
  vcpuPerHour: 0.04656,
  memGbPerHour: 0.00511,
  region: 'ap-northeast-2' as const,
} as const;

/**
 * Time constants
 */
export const TIME_CONSTANTS = {
  HOURS_PER_MONTH: 730,
  HOURS_PER_DAY: 24,
  DAYS_PER_WEEK: 7,
  MS_PER_MINUTE: 60 * 1000,
  MS_PER_DAY: 24 * 60 * 60 * 1000,
} as const;

/**
 * Recommendation type labels (for UI display)
 */
export const RECOMMENDATION_TYPE_LABELS: Record<CostRecommendation['type'], string> = {
  downscale: 'Resource Downscale',
  schedule: 'Time-Based Scheduling',
  reserved: 'Reserved Instance',
  'right-size': 'Right-Sizing',
} as const;

/**
 * Risk level styles (for UI display)
 */
export const RISK_STYLES: Record<CostRecommendation['risk'], { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-700', label: 'Low' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Medium' },
  high: { bg: 'bg-red-100', text: 'text-red-700', label: 'High' },
} as const;
