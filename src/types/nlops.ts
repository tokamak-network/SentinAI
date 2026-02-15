/**
 * NLOps (Natural Language Operations) Type Definitions
 * Type definitions for natural language-based operations interface
 */

// ============================================================
// Intent Types (Intent Classification)
// ============================================================

export type QueryTarget = 'status' | 'metrics' | 'history' | 'cost' | 'anomalies';

export type AnalyzeMode = 'normal' | 'attack' | 'live';

export type ConfigSetting = 'autoScaling' | 'simulationMode' | 'zeroDowntimeEnabled';

/** Valid vCPU values (same as existing TargetVcpu type: 1 | 2 | 4) */
export type NLOpsTargetVcpu = 1 | 2 | 4;

/**
 * NLOps Intent - Discriminated Union
 * Each intent type requires different parameters
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
  /** User input message */
  message: string;
  /** Confirmation flag for dangerous actions (true means execution approved) */
  confirmAction?: boolean;
}

export interface NLOpsResponse {
  /** Classified intent */
  intent: NLOpsIntent;
  /** Whether executed (false if awaiting confirmation) */
  executed: boolean;
  /** Natural language response message */
  response: string;
  /** Execution result data (optional) */
  data?: Record<string, unknown>;
  /** True if confirmation is required */
  needsConfirmation?: boolean;
  /** Confirmation request message */
  confirmationMessage?: string;
  /** Suggested follow-up questions */
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
