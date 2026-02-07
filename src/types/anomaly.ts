/**
 * Anomaly Detection Pipeline Types
 * 다층 이상 탐지 시스템을 위한 타입 정의
 */

import { AISeverity } from './scaling';

// ============================================================================
// Layer 1: Statistical Anomaly Detection
// ============================================================================

/**
 * 이상 방향
 * - spike: 급격한 상승
 * - drop: 급격한 하락
 * - plateau: 장시간 변화 없음 (정체)
 */
export type AnomalyDirection = 'spike' | 'drop' | 'plateau';

/**
 * 탐지 대상 메트릭
 */
export type AnomalyMetric =
  | 'cpuUsage'
  | 'txPoolPending'
  | 'gasUsedRatio'
  | 'l2BlockHeight'
  | 'l2BlockInterval';

/**
 * Layer 1 통계 기반 이상 탐지 결과
 */
export interface AnomalyResult {
  /** 이상 여부 */
  isAnomaly: boolean;
  /** 이상이 감지된 메트릭 */
  metric: AnomalyMetric;
  /** 현재 값 */
  value: number;
  /** Z-Score (평균으로부터 표준편차 단위 거리) */
  zScore: number;
  /** 이상 방향 */
  direction: AnomalyDirection;
  /** 사람이 읽을 수 있는 설명 */
  description: string;
  /** 탐지 규칙 (어떤 규칙에 의해 탐지되었는지) */
  rule: 'z-score' | 'zero-drop' | 'plateau' | 'monotonic-increase';
}

// ============================================================================
// Layer 2: AI Semantic Analysis
// ============================================================================

/**
 * 이상 유형 분류
 */
export type AnomalyType = 'performance' | 'security' | 'consensus' | 'liveness';

/**
 * Layer 2 AI 심층 분석 결과
 */
export interface DeepAnalysisResult {
  /** AI가 판단한 심각도 */
  severity: AISeverity;
  /** 이상 유형 */
  anomalyType: AnomalyType;
  /** 연관된 메트릭/로그 패턴 */
  correlations: string[];
  /** 예상 영향도 */
  predictedImpact: string;
  /** 권장 조치 목록 */
  suggestedActions: string[];
  /** 영향받는 컴포넌트 */
  relatedComponents: string[];
  /** 분석 타임스탬프 */
  timestamp: string;
  /** AI 모델 응답의 원본 (디버깅용) */
  rawResponse?: string;
}

// ============================================================================
// Layer 3: Alert Dispatch
// ============================================================================

/**
 * 알림 채널 유형
 */
export type AlertChannel = 'slack' | 'webhook' | 'dashboard';

/**
 * 알림 설정
 */
export interface AlertConfig {
  /** Slack/Discord 웹훅 URL (선택) */
  webhookUrl?: string;
  /** 알림 임계값 설정 */
  thresholds: {
    /** 이 심각도 이상에서 알림 발송 */
    notifyOn: AISeverity[];
    /** 동일 유형 이상에 대한 알림 간격 (분) */
    cooldownMinutes: number;
  };
  /** 알림 활성화 여부 */
  enabled: boolean;
}

/**
 * 발송된 알림 기록
 */
export interface AlertRecord {
  /** 고유 ID */
  id: string;
  /** 원인이 된 이상 탐지 결과 */
  anomaly: AnomalyResult;
  /** AI 심층 분석 결과 (있는 경우) */
  analysis?: DeepAnalysisResult;
  /** 발송 시간 */
  sentAt: string;
  /** 발송 채널 */
  channel: AlertChannel;
  /** 발송 성공 여부 */
  success: boolean;
  /** 실패 시 에러 메시지 */
  error?: string;
}

// ============================================================================
// Anomaly Event (통합)
// ============================================================================

/**
 * 이상 이벤트 상태
 */
export type AnomalyEventStatus = 'active' | 'resolved' | 'acknowledged';

/**
 * 이상 이벤트 (Layer 1~3 결과 통합)
 */
export interface AnomalyEvent {
  /** 고유 ID (UUID v4) */
  id: string;
  /** 최초 탐지 시간 (Unix timestamp ms) */
  timestamp: number;
  /** Layer 1에서 탐지된 이상 목록 */
  anomalies: AnomalyResult[];
  /** Layer 2 AI 심층 분석 결과 (수행된 경우) */
  deepAnalysis?: DeepAnalysisResult;
  /** 이벤트 상태 */
  status: AnomalyEventStatus;
  /** 해결 시간 (있는 경우) */
  resolvedAt?: number;
  /** 발송된 알림 기록 */
  alerts: AlertRecord[];
}

// ============================================================================
// API Types
// ============================================================================

/**
 * GET /api/anomalies 응답
 */
export interface AnomaliesResponse {
  /** 이상 이벤트 목록 (최신순) */
  events: AnomalyEvent[];
  /** 전체 이벤트 수 */
  total: number;
  /** 현재 활성 이상 수 */
  activeCount: number;
}

/**
 * GET /api/anomalies/config 응답
 */
export interface AlertConfigResponse {
  config: AlertConfig;
  /** 최근 24시간 알림 발송 수 */
  alertsSent24h: number;
  /** 다음 알림 가능 시간 (쿨다운 중인 경우) */
  nextAlertAvailableAt?: string;
}

/**
 * POST /api/anomalies/config 요청 바디
 */
export interface AlertConfigUpdateRequest {
  webhookUrl?: string;
  thresholds?: {
    notifyOn?: AISeverity[];
    cooldownMinutes?: number;
  };
  enabled?: boolean;
}

/**
 * Metrics API 확장 - anomalies 필드
 */
export interface MetricsAnomalyExtension {
  /** Layer 1 이상 탐지 결과 (실시간) */
  anomalies: AnomalyResult[];
  /** 현재 활성 이상 이벤트 ID (있는 경우) */
  activeEventId?: string;
}
