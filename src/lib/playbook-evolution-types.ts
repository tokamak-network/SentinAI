/**
 * Playbook Evolution Types (Phase 6)
 *
 * Defines types for:
 * - PlaybookEvolver: generates improved playbooks from patterns
 * - PatternMiner: extracts operational patterns from experience records
 * - ABTestController: manages A/B testing sessions
 * - RollbackManager: manages playbook versions and rollbacks
 */

export interface PlaybookVersion {
  versionId: string;
  generatedBy: string;
  generatedAt: string;
  source: 'hardcoded' | 'pattern' | 'ai-assisted';
  confidence: number;
  successRate: number;
  totalApplications: number;
  playbook: Record<string, unknown>;
}

export interface OperationRecord {
  id: string;
  timestamp: string;
  anomalyType: string;
  action: string;
  success: boolean;
  resolutionMs: number;
  metadata?: Record<string, unknown>;
}

export interface OperationalPattern {
  id: string;
  anomalyType: string;
  effectiveAction: string;
  successRate: number;
  occurrences: number;
  confidence: number;
  avgResolutionMs: number;
  lastSeen: string;
}

export interface ABTestSession {
  id: string;
  status: 'pending' | 'running' | 'completed';
  controlVersionId: string;
  testVersionId: string;
  stats: {
    controlExecutions: number;
    testExecutions: number;
    controlSuccesses: number;
    testSuccesses: number;
  };
  startedAt: string;
  completedAt?: string;
  decision?: 'promote' | 'control' | 'inconclusive';
}

export interface PlaybookEvolutionState {
  current: PlaybookVersion;
  history: PlaybookVersion[];
  abTestSession?: ABTestSession;
  lastEvolution?: string;
}
