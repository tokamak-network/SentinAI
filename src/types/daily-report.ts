/**
 * Daily Report Type Definitions
 */

// ============================================================
// Metric Snapshot (5분 간격)
// ============================================================

/** 5분 간격으로 ring buffer에서 스냅샷한 메트릭 통계 */
export interface MetricSnapshot {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** 스냅샷 시점의 ring buffer 데이터 포인트 수 (0-60) */
  dataPointCount: number;
  cpu: { mean: number; min: number; max: number; stdDev: number };
  txPool: { mean: number; min: number; max: number; stdDev: number };
  gasUsedRatio: { mean: number; min: number; max: number; stdDev: number };
  blockInterval: { mean: number; min: number; max: number; stdDev: number };
  /** 스냅샷 시점의 최신 L2 블록 높이 */
  latestBlockHeight: number;
  /** 스냅샷 시점의 vCPU 설정 */
  currentVcpu: number;
}

// ============================================================
// Hourly Summary (시간별 요약)
// ============================================================

/** 시간별 집계 요약 (AI 프롬프트용) */
export interface HourlySummary {
  /** 시간 (0-23) */
  hour: number;
  /** 해당 시간의 스냅샷 수 (최대 12) */
  snapshotCount: number;
  avgCpu: number;
  maxCpu: number;
  avgTxPool: number;
  maxTxPool: number;
  avgGasRatio: number;
  avgBlockInterval: number;
  /** 해당 시간의 추정 블록 생성 수 */
  blocksProduced: number;
  /** vCPU 변경 이력 */
  vcpuChanges: Array<{ timestamp: string; from: number; to: number }>;
}

// ============================================================
// Log Analysis & Scaling Events
// ============================================================

/** 로그 분석 결과 엔트리 (analyze-logs API에서 수집) */
export interface LogAnalysisEntry {
  timestamp: string;
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  actionItem: string;
}

/** 스케일링 이벤트 (scaler API에서 수집) */
export interface ScalingEvent {
  timestamp: string;
  fromVcpu: number;
  toVcpu: number;
  trigger: 'auto' | 'manual' | 'predictive';
  reason: string;
}

// ============================================================
// Daily Accumulated Data
// ============================================================

/** 24시간 축적 데이터 (보고서 생성의 입력) */
export interface DailyAccumulatedData {
  /** 대상 날짜 (YYYY-MM-DD) */
  date: string;
  /** 데이터 수집 시작 시간 (ISO 8601) */
  startTime: string;
  /** 마지막 스냅샷 시간 (ISO 8601) */
  lastSnapshotTime: string;
  /** 5분 간격 스냅샷 (최대 288개) */
  snapshots: MetricSnapshot[];
  /** 시간별 요약 (24개) */
  hourlySummaries: HourlySummary[];
  /** 로그 분석 결과 */
  logAnalysisResults: LogAnalysisEntry[];
  /** 스케일링 이벤트 */
  scalingEvents: ScalingEvent[];
  /** 데이터 품질 메타데이터 */
  metadata: {
    /** 예상 대비 실제 수집률 (0-1) */
    dataCompleteness: number;
    /** 데이터 수집 갭 (서버 재시작 등) */
    dataGaps: Array<{ start: string; end: string; reason: string }>;
  };
}

// ============================================================
// Accumulator State (메모리 싱글톤)
// ============================================================

/** 축적기 내부 상태 */
export interface AccumulatorState {
  currentDate: string;
  data: DailyAccumulatedData;
  lastSnapshotTimestamp: number;
  startedAt: string;
}

// ============================================================
// API Types
// ============================================================

/** POST /api/reports/daily 요청 바디 */
export interface DailyReportRequest {
  /** 대상 날짜 (생략 시 오늘) */
  date?: string;
  /** 기존 보고서 덮어쓰기 */
  force?: boolean;
  /** 디버그 정보 포함 (프롬프트, 토큰 수) */
  debug?: boolean;
}

/** POST /api/reports/daily 응답 */
export interface DailyReportResponse {
  success: boolean;
  /** 생성된 보고서 파일 경로 */
  reportPath?: string;
  /** 보고서 마크다운 내용 */
  reportContent?: string;
  error?: string;
  /** 디버그 정보 */
  debug?: {
    promptTokens: number;
    completionTokens: number;
    systemPrompt: string;
    userPrompt: string;
  };
  /** Fallback 보고서 정보 (AI provider 실패 시) */
  fallback?: {
    enabled: boolean;
    reason: string;
  };
  metadata: {
    date: string;
    generatedAt: string;
    dataCompleteness: number;
    snapshotCount: number;
    processingTimeMs: number;
  };
}
