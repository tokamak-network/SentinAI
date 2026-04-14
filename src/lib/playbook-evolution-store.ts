/**
 * Playbook Evolution Store — Domain Facade
 *
 * Scoped access to playbook evolution methods from the unified state store.
 * Replaces (store as any).method() casts with a properly typed interface.
 *
 * Usage:
 *   import { getPlaybookEvolutionStore } from '@/lib/playbook-evolution-store';
 *   const store = getPlaybookEvolutionStore();
 *   await store.savePattern(pattern);
 */

import { getStore } from '@/lib/redis-store';
import type { IncidentPattern, ABTestSession, PlaybookVersion, PlaybookVersionHistory } from '@/playbooks/evolution/types';

export interface IPlaybookEvolutionStore {
  savePattern(pattern: IncidentPattern): Promise<void>;
  getPatterns(anomalyType: string): Promise<IncidentPattern[]>;
  deletePattern(anomalyType: string, action: string): Promise<void>;
  saveABTestSession(sessionId: string, session: ABTestSession): Promise<void>;
  getABTestSession(sessionId: string): Promise<ABTestSession | null>;
  getRunningABTests(): Promise<ABTestSession[]>;
  savePlaybookVersion(version: PlaybookVersion): Promise<void>;
  getPlaybookVersionHistory(): Promise<PlaybookVersionHistory>;
  cleanupOldVersions(): Promise<void>;
  getLastEvolutionTime(): Promise<number>;
  setLastEvolutionTime(time: number): Promise<void>;
}

/**
 * Returns the playbook evolution facade backed by the configured state store.
 * IStateStore now includes these methods, so no cast is needed.
 */
export function getPlaybookEvolutionStore(): IPlaybookEvolutionStore {
  return getStore();
}
