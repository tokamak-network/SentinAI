/**
 * Root Cause Analysis Types
 * Optimism Rollup 장애 분석을 위한 타입 정의
 */

import type { AISeverity } from './scaling';

/**
 * Optimism Rollup 컴포넌트 식별자
 * - op-geth: Execution Client (L2 블록 실행)
 * - op-node: Consensus Client / Derivation Driver (L1에서 L2 상태 파생)
 * - op-batcher: Transaction Batch Submitter (L2 트랜잭션을 L1에 제출)
 * - op-proposer: State Root Proposer (L2 상태 루트를 L1에 제출)
 * - l1: L1 Ethereum (외부 의존성)
 * - system: 시스템 레벨 이벤트 (K8s, 네트워크 등)
 */
export type RCAComponent =
  | 'op-geth'
  | 'op-node'
  | 'op-batcher'
  | 'op-proposer'
  | 'l1'
  | 'system';

/**
 * RCA 이벤트 유형
 * - error: 에러 로그 또는 치명적 실패
 * - warning: 경고 로그 또는 주의 필요 상태
 * - metric_anomaly: 메트릭 이상치 (Z-Score 기반)
 * - state_change: 상태 변화 (스케일링, 재시작 등)
 */
export type RCAEventType = 'error' | 'warning' | 'metric_anomaly' | 'state_change';

/**
 * RCA 이벤트
 * 타임라인을 구성하는 개별 이벤트
 */
export interface RCAEvent {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

  /** 이벤트 발생 컴포넌트 */
  component: RCAComponent;

  /** 이벤트 유형 */
  type: RCAEventType;

  /** 이벤트 설명 (사람이 읽을 수 있는 형태) */
  description: string;

  /** 원본 로그 라인 (있는 경우) */
  rawLog?: string;

  /** 이벤트 심각도 (있는 경우) */
  severity?: AISeverity;
}

/**
 * 컴포넌트 의존관계
 * Optimism Rollup 아키텍처 기반 정의
 */
export interface ComponentDependency {
  /** 이 컴포넌트가 의존하는 컴포넌트 목록 (upstream) */
  dependsOn: RCAComponent[];

  /** 이 컴포넌트에 의존하는 컴포넌트 목록 (downstream) */
  feeds: RCAComponent[];
}

/**
 * 근본 원인 정보
 */
export interface RootCauseInfo {
  /** 근본 원인 컴포넌트 */
  component: RCAComponent;

  /** 근본 원인 설명 */
  description: string;

  /** 분석 신뢰도 (0-1) */
  confidence: number;
}

/**
 * 조치 권고
 */
export interface RemediationAdvice {
  /** 즉시 조치 사항 */
  immediate: string[];

  /** 재발 방지 대책 */
  preventive: string[];
}

/**
 * RCA 분석 결과
 */
export interface RCAResult {
  /** 고유 식별자 (UUID) */
  id: string;

  /** 근본 원인 정보 */
  rootCause: RootCauseInfo;

  /** 인과 체인 (근본 원인 → 최종 증상 순서) */
  causalChain: RCAEvent[];

  /** 영향 받은 컴포넌트 목록 */
  affectedComponents: RCAComponent[];

  /** 전체 이벤트 타임라인 (시간순) */
  timeline: RCAEvent[];

  /** 조치 권고 */
  remediation: RemediationAdvice;

  /** 분석 완료 시각 (ISO 8601) */
  generatedAt: string;
}

/**
 * RCA 히스토리 엔트리
 */
export interface RCAHistoryEntry {
  /** RCAResult의 id와 동일 */
  id: string;

  /** RCA 분석 결과 */
  result: RCAResult;

  /** 트리거 방식 */
  triggeredBy: 'manual' | 'auto';

  /** 트리거 시각 (ISO 8601) */
  triggeredAt: string;
}

/**
 * RCA API 요청 본문
 */
export interface RCARequest {
  /** 자동 트리거 여부 (Proposal 2 연동 시 사용) */
  autoTriggered?: boolean;
}

/**
 * RCA API 응답
 */
export interface RCAResponse {
  /** 성공 여부 */
  success: boolean;

  /** RCA 결과 (성공 시) */
  result?: RCAResult;

  /** 에러 메시지 (실패 시) */
  error?: string;

  /** 상세 에러 (디버깅용) */
  message?: string;
}

/**
 * RCA 히스토리 API 응답
 */
export interface RCAHistoryResponse {
  /** RCA 히스토리 목록 */
  history: RCAHistoryEntry[];

  /** 전체 히스토리 수 */
  total: number;
}
