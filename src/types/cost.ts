/**
 * AI Cost Optimizer Types
 * vCPU 사용 패턴 분석 및 비용 최적화 추천을 위한 타입 정의
 */

/**
 * 시간대별 사용 패턴
 * 7일 x 24시간 매트릭스의 각 셀에 대한 통계
 */
export interface UsagePattern {
  /** 시간 (0-23) */
  hourOfDay: number;
  /** 요일 (0=일요일, 1=월요일, ..., 6=토요일) */
  dayOfWeek: number;
  /** 해당 시간대의 평균 vCPU */
  avgVcpu: number;
  /** 해당 시간대의 최대 vCPU */
  peakVcpu: number;
  /** 해당 시간대의 평균 CPU 사용률 (0-100) */
  avgUtilization: number;
  /** 해당 시간대에 수집된 샘플 수 */
  sampleCount: number;
}

/**
 * 비용 최적화 추천 항목
 */
export interface CostRecommendation {
  /** 추천 유형 */
  type: 'downscale' | 'schedule' | 'reserved' | 'right-size';
  /** 추천 제목 (한글) */
  title: string;
  /** 상세 설명 (한글) */
  description: string;
  /** 현재 월간 비용 (USD) */
  currentCost: number;
  /** 적용 후 예상 월간 비용 (USD) */
  projectedCost: number;
  /** 절감률 (0-100) */
  savingsPercent: number;
  /** AI 추천 신뢰도 (0-1) */
  confidence: number;
  /** 구현 방법 설명 (한글) */
  implementation: string;
  /** 위험도 */
  risk: 'low' | 'medium' | 'high';
}

/**
 * 비용 분석 리포트
 */
export interface CostReport {
  /** 리포트 고유 ID (UUID) */
  id: string;
  /** 생성 시각 (ISO 8601) */
  generatedAt: string;
  /** 현재 예상 월간 비용 (USD) */
  currentMonthly: number;
  /** 최적화 후 예상 월간 비용 (USD) */
  optimizedMonthly: number;
  /** 총 절감률 (0-100) */
  totalSavingsPercent: number;
  /** 추천 목록 */
  recommendations: CostRecommendation[];
  /** 시간대별 사용 패턴 (7x24=168개) */
  usagePatterns: UsagePattern[];
  /** AI가 생성한 자연어 인사이트 (한글) */
  aiInsight: string;
  /** 분석 기간 (일) */
  periodDays: number;
}

/**
 * 사용량 데이터 포인트 (내부 저장용)
 */
export interface UsageDataPoint {
  /** Unix timestamp (ms) */
  timestamp: number;
  /** 할당된 vCPU */
  vcpu: number;
  /** CPU 사용률 (0-100) */
  cpuUtilization: number;
}

/**
 * 24시간 프로파일 (시간대별 요약)
 */
export interface HourlyProfile {
  /** 시간 (0-23) */
  hour: number;
  /** 평균 vCPU */
  avgVcpu: number;
  /** 평균 CPU 사용률 */
  avgUtilization: number;
}

/**
 * 비용 계산 상수
 */
export const FARGATE_PRICING = {
  /** vCPU 시간당 비용 (USD) - 서울 리전 */
  vcpuPerHour: 0.04656,
  /** 메모리 GB 시간당 비용 (USD) - 서울 리전 */
  memGbPerHour: 0.00511,
  /** 리전 */
  region: 'ap-northeast-2' as const,
} as const;

/**
 * 시간 상수
 */
export const TIME_CONSTANTS = {
  /** 월간 시간 */
  HOURS_PER_MONTH: 730,
  /** 일간 시간 */
  HOURS_PER_DAY: 24,
  /** 주간 일수 */
  DAYS_PER_WEEK: 7,
  /** 분당 밀리초 */
  MS_PER_MINUTE: 60 * 1000,
  /** 일당 밀리초 */
  MS_PER_DAY: 24 * 60 * 60 * 1000,
} as const;

/**
 * 추천 유형별 레이블 (UI 표시용)
 */
export const RECOMMENDATION_TYPE_LABELS: Record<CostRecommendation['type'], string> = {
  downscale: '리소스 축소',
  schedule: '시간 기반 스케줄링',
  reserved: '예약 인스턴스',
  'right-size': '적정 사이징',
} as const;

/**
 * 위험도별 스타일 (UI 표시용)
 */
export const RISK_STYLES: Record<CostRecommendation['risk'], { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-700', label: '낮음' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '중간' },
  high: { bg: 'bg-red-100', text: 'text-red-700', label: '높음' },
} as const;
