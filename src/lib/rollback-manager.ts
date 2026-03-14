/**
 * Rollback Manager
 * Manages playbook versions and rollbacks
 */

import type { PlaybookVersion, PlaybookEvolutionState } from './playbook-evolution-types';

export class RollbackManager {
  private state: PlaybookEvolutionState = {
    current: {
      versionId: 'v-0',
      generatedBy: 'hardcoded',
      generatedAt: new Date().toISOString(),
      source: 'hardcoded',
      confidence: 0.9,
      successRate: 0.8,
      totalApplications: 100,
      playbook: { id: 'default', name: 'Default Playbook' },
    },
    history: [],
  };

  getCurrentVersion(): PlaybookVersion {
    return this.state.current;
  }

  getHistory(): PlaybookVersion[] {
    return this.state.history;
  }

  promoteVersion(version: PlaybookVersion): void {
    // Move current to history
    this.state.history.push(this.state.current);

    // Set new current
    this.state.current = version;
    this.state.lastEvolution = new Date().toISOString();

    // Keep history limited to 10 versions
    if (this.state.history.length > 10) {
      this.state.history.shift();
    }
  }

  rollbackTo(versionId: string): boolean {
    const idx = this.state.history.findIndex((v) => v.versionId === versionId);
    if (idx === -1) return false;

    const version = this.state.history[idx];
    this.state.history.splice(idx, 1);
    this.state.history.push(this.state.current);

    this.state.current = version;
    return true;
  }

  getState(): PlaybookEvolutionState {
    return { ...this.state };
  }

  setState(newState: PlaybookEvolutionState): void {
    this.state = { ...newState };
  }
}
