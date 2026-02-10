/**
 * NLOps (Natural Language Operations) Type Definitions
 * 자연어 기반 운영 인터페이스를 위한 타입 정의
 */

// ============================================================
// Intent Types (의도 분류)
// ============================================================

export type QueryTarget = 'status' | 'metrics' | 'history' | 'cost' | 'anomalies';

export type AnalyzeMode = 'normal' | 'attack' | 'live';

export type ConfigSetting = 'autoScaling' | 'simulationMode' | 'zeroDowntimeEnabled';

/** 유효한 vCPU 값 (기존 TargetVcpu 타입과 동일: 1 | 2 | 4) */
export type NLOpsTargetVcpu = 1 | 2 | 4;

/**
 * NLOps 의도 - Discriminated Union
 * 각 의도 타입별로 필요한 파라미터가 다름
 */
export type NLOpsIntent =
  | {
      type: 'query';
      target: QueryTarget;
      params?: Record<string, string>;
    }
  | {
      type: 'scale';
      targetVcpu: NLOpsTargetVcpu;
      force: boolean;
    }
  | {
      type: 'analyze';
      mode: AnalyzeMode;
    }
  | {
      type: 'config';
      setting: ConfigSetting;
      value: boolean;
    }
  | {
      type: 'explain';
      topic: string;
    }
  | {
      type: 'rca';
    }
  | {
      type: 'unknown';
      originalInput: string;
    };

// ============================================================
// Request/Response Types
// ============================================================

export interface NLOpsRequest {
  /** 사용자 입력 메시지 */
  message: string;
  /** 위험한 작업에 대한 확인 플래그 (true면 실행 승인) */
  confirmAction?: boolean;
}

export interface NLOpsResponse {
  /** 분류된 의도 */
  intent: NLOpsIntent;
  /** 실행 여부 (확인 대기 중이면 false) */
  executed: boolean;
  /** 자연어 응답 메시지 */
  response: string;
  /** 실행 결과 데이터 (선택적) */
  data?: Record<string, unknown>;
  /** 확인이 필요한 경우 true */
  needsConfirmation?: boolean;
  /** 확인 요청 메시지 */
  confirmationMessage?: string;
  /** 후속 질문 제안 */
  suggestedFollowUp?: string[];
}

// ============================================================
// Chat UI Types
// ============================================================

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  intent?: NLOpsIntent;
  data?: Record<string, unknown>;
  awaitingConfirmation?: boolean;
}

// ============================================================
// Internal Engine Types
// ============================================================

export interface IntentClassificationResult {
  intent: NLOpsIntent;
  requireConfirmation: boolean;
  clarification?: string;
}

export interface ActionExecutionResult {
  executed: boolean;
  result: Record<string, unknown> | null;
  error?: string;
}

export interface CurrentSystemState {
  vcpu: number;
  memoryGiB: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  cpuUsage: number;
  txPoolCount: number;
  cooldownRemaining: number;
}
