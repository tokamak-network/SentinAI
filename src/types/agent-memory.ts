/**
 * Agent Memory and Decision Trace Types
 */

import type { AISeverity } from '@/types/scaling';

export type AgentMemoryCategory =
  | 'incident'
  | 'scaling'
  | 'failover'
  | 'remediation'
  | 'analysis';

export interface AgentMemoryEntry {
  id: string;
  timestamp: string;
  category: AgentMemoryCategory;
  chainType: string;
  summary: string;
  decisionId?: string;
  component?: string;
  severity?: AISeverity;
  metadata?: Record<string, unknown>;
}

export interface AgentMemoryQuery {
  limit?: number;
  category?: AgentMemoryCategory;
  component?: string;
  severity?: AISeverity;
  decisionId?: string;
  fromTs?: string;
  toTs?: string;
}

export interface DecisionEvidence {
  type: 'metric' | 'log' | 'anomaly' | 'system';
  key: string;
  value: string;
  source?: string;
}

export interface AgentPhaseTraceEntry {
  phase: 'observe' | 'detect' | 'analyze' | 'plan' | 'act' | 'verify';
  startedAt: string;
  endedAt: string;
  ok: boolean;
  error?: string;
}

export interface DecisionVerification {
  expected: string;
  observed: string;
  passed: boolean;
  details?: string;
}

export interface DecisionTrace {
  decisionId: string;
  timestamp: string;
  chainType: string;
  severity?: AISeverity;
  inputs: {
    anomalyCount: number;
    metrics?: {
      l1BlockHeight: number;
      l2BlockHeight: number;
      cpuUsage: number;
      txPoolPending: number;
      gasUsedRatio: number;
    } | null;
    scalingScore?: number;
  };
  reasoningSummary: string;
  evidence: DecisionEvidence[];
  chosenAction: string;
  alternatives: string[];
  phaseTrace: AgentPhaseTraceEntry[];
  verification: DecisionVerification;
}

export interface DecisionTraceQuery {
  limit?: number;
  severity?: AISeverity;
  fromTs?: string;
  toTs?: string;
}
