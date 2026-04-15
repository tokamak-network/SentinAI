import type { PlaybookVersion } from './playbook-evolution-types';

const HISTORY_LIMIT = 10;

const DEFAULT_VERSION: PlaybookVersion = {
  versionId: 'v-0',
  generatedBy: 'system',
  generatedAt: new Date(0).toISOString(),
  source: 'hardcoded',
  confidence: 1,
  successRate: 0,
  totalApplications: 0,
  playbook: {},
};

/**
 * In-memory rollback manager for playbook versions.
 */
export class RollbackManager {
  private current: PlaybookVersion = { ...DEFAULT_VERSION };
  private history: PlaybookVersion[] = [];

  getCurrentVersion(): PlaybookVersion {
    return this.current;
  }

  promoteVersion(version: PlaybookVersion): void {
    this.history.push(this.current);
    if (this.history.length > HISTORY_LIMIT) {
      this.history = this.history.slice(this.history.length - HISTORY_LIMIT);
    }
    this.current = version;
  }

  rollbackTo(versionId: string): boolean {
    const idx = this.history.findIndex((v) => v.versionId === versionId);
    if (idx === -1) return false;

    const target = this.history[idx]!;
    this.history.push(this.current);
    if (this.history.length > HISTORY_LIMIT) {
      this.history = this.history.slice(this.history.length - HISTORY_LIMIT);
    }
    this.history.splice(idx, 1);
    this.current = target;
    return true;
  }

  getHistory(): PlaybookVersion[] {
    return [...this.history];
  }
}
