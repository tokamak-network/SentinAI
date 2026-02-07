/**
 * Anomaly Event Store
 * 탐지된 이상 이벤트 메모리 저장소
 */

import { AnomalyEvent, AnomalyResult, DeepAnalysisResult, AlertRecord, AnomalyEventStatus } from '@/types/anomaly';

// ============================================================================
// Configuration
// ============================================================================

/** 최대 이벤트 저장 수 */
const MAX_EVENTS = 100;

/** 이벤트 자동 해결 시간 (밀리초) - 30분간 새로운 이상 없으면 해결 처리 */
const AUTO_RESOLVE_MS = 30 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** 이벤트 저장소 (최신순) */
let events: AnomalyEvent[] = [];

/** 현재 활성 이벤트 ID */
let activeEventId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * UUID v4 생성
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 오래된 이벤트 정리
 */
function cleanup(): void {
  // 최대 개수 초과 시 오래된 것부터 제거
  if (events.length > MAX_EVENTS) {
    events = events.slice(0, MAX_EVENTS);
  }

  // 자동 해결 처리
  const now = Date.now();
  for (const event of events) {
    if (event.status === 'active' && now - event.timestamp > AUTO_RESOLVE_MS) {
      event.status = 'resolved';
      event.resolvedAt = now;
    }
  }

  // 활성 이벤트 ID 업데이트
  const activeEvent = events.find(e => e.status === 'active');
  activeEventId = activeEvent?.id || null;
}

// ============================================================================
// Main Exports
// ============================================================================

/**
 * 새 이상 이벤트 생성 또는 기존 활성 이벤트에 추가
 *
 * @param anomalies Layer 1에서 탐지된 이상 목록
 * @returns 생성/업데이트된 이벤트
 */
export function createOrUpdateEvent(anomalies: AnomalyResult[]): AnomalyEvent {
  cleanup();
  const now = Date.now();

  // 활성 이벤트가 있으면 이상 목록 업데이트
  if (activeEventId) {
    const activeEvent = events.find(e => e.id === activeEventId);
    if (activeEvent) {
      // 기존 이상에 없는 새로운 메트릭의 이상만 추가
      const existingMetrics = new Set(activeEvent.anomalies.map(a => a.metric));
      const newAnomalies = anomalies.filter(a => !existingMetrics.has(a.metric));

      if (newAnomalies.length > 0) {
        activeEvent.anomalies.push(...newAnomalies);
      }

      // 기존 이상 업데이트 (같은 메트릭이면 최신 값으로)
      for (const anomaly of anomalies) {
        const existingIndex = activeEvent.anomalies.findIndex(a => a.metric === anomaly.metric);
        if (existingIndex >= 0) {
          activeEvent.anomalies[existingIndex] = anomaly;
        }
      }

      return activeEvent;
    }
  }

  // 새 이벤트 생성
  const newEvent: AnomalyEvent = {
    id: generateUUID(),
    timestamp: now,
    anomalies,
    status: 'active',
    alerts: [],
  };

  events.unshift(newEvent);
  activeEventId = newEvent.id;

  return newEvent;
}

/**
 * 이벤트에 AI 분석 결과 추가
 */
export function addDeepAnalysis(eventId: string, analysis: DeepAnalysisResult): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.deepAnalysis = analysis;
  }
}

/**
 * 이벤트에 알림 기록 추가
 */
export function addAlertRecord(eventId: string, alert: AlertRecord): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.alerts.push(alert);
  }
}

/**
 * 이벤트 상태 업데이트
 */
export function updateEventStatus(eventId: string, status: AnomalyEventStatus): void {
  const event = events.find(e => e.id === eventId);
  if (event) {
    event.status = status;
    if (status === 'resolved') {
      event.resolvedAt = Date.now();
    }
    if (status !== 'active' && activeEventId === eventId) {
      activeEventId = null;
    }
  }
}

/**
 * 활성 이벤트 해결 처리 (이상이 더 이상 탐지되지 않을 때 호출)
 */
export function resolveActiveEventIfExists(): void {
  if (activeEventId) {
    updateEventStatus(activeEventId, 'resolved');
  }
}

/**
 * 이벤트 목록 조회 (페이지네이션)
 */
export function getEvents(limit: number = 20, offset: number = 0): { events: AnomalyEvent[]; total: number; activeCount: number } {
  cleanup();

  const activeCount = events.filter(e => e.status === 'active').length;
  const paginatedEvents = events.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: events.length,
    activeCount,
  };
}

/**
 * 특정 이벤트 조회
 */
export function getEventById(eventId: string): AnomalyEvent | null {
  return events.find(e => e.id === eventId) || null;
}

/**
 * 현재 활성 이벤트 ID 조회
 */
export function getActiveEventId(): string | null {
  cleanup();
  return activeEventId;
}

/**
 * 저장소 초기화 (테스트용)
 */
export function clearEvents(): void {
  events = [];
  activeEventId = null;
}
