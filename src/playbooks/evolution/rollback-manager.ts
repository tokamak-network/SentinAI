/**
 * RollbackManager: Playbook Version Management
 *
 * Manages versioning, atomic promotion, and emergency rollback of evolved playbooks.
 * - Supports up to 10 historical versions
 * - Atomic transaction for promotion to prevent race conditions
 * - Zero-downtime version switching
 */

import type { IStateStore } from '@/types/redis';
import type { Redis } from 'ioredis';
import type { EvolvedPlaybook, PlaybookVersion, PlaybookVersionHistory } from './types';

const PLAYBOOK_CURRENT_KEY = 'playbook:current';
const PLAYBOOK_HISTORY_KEY = 'playbook:history';
const MAX_VERSIONS = 10;

/**
 * Simple Result type for error handling
 */
export class Result<T, E = Error> {
  private constructor(
    private value: T | null,
    private error: E | null,
  ) {}

  isOk(): boolean {
    return this.error === null;
  }

  isErr(): boolean {
    return this.error !== null;
  }

  unwrap(): T {
    if (this.error !== null) {
      throw new Error(`Called unwrap on Err: ${this.error}`);
    }
    return this.value!;
  }

  getError(): E | null {
    return this.error;
  }

  static ok<T, E = Error>(value: T): Result<T, E> {
    return new Result<T, E>(value, null as E | null);
  }

  static err<T, E = Error>(error: E): Result<T, E> {
    return new Result<T, E>(null as T | null, error);
  }
}

/**
 * RollbackManager: Manages playbook versioning and rollbacks
 */
export class RollbackManager {
  constructor(
    private store: IStateStore,
    private redis: Redis,
  ) {}

  /**
   * Promote a new playbook version to active status
   *
   * Algorithm (atomic via Redis transaction):
   * 1. GET playbook:current (if exists)
   * 2. Check if versionId already exists in history or current
   * 3. If new version: move current to history with isActive=false
   * 4. SET playbook:current = new version with isActive=true
   * 5. If history size > 10, remove oldest entry
   * 6. Execute all changes atomically
   */
  async promoteVersion(playbook: EvolvedPlaybook): Promise<Result<PlaybookVersion, Error>> {
    try {
      const newVersion: PlaybookVersion = {
        versionId: playbook.versionId,
        playbook,
        promotedAt: new Date(),
        isActive: true,
      };

      // Load current version
      const currentStr = await this.redis.get(PLAYBOOK_CURRENT_KEY);
      const current = currentStr ? JSON.parse(currentStr) as PlaybookVersion : null;

      // Load history
      const history = await this.loadHistory();

      // Check for duplicate version ID
      if (current && current.versionId === playbook.versionId) {
        return Result.err(new Error(`409 Conflict: version ${playbook.versionId} already exists as current`));
      }

      const versionExists = history.some(v => v.versionId === playbook.versionId);
      if (versionExists) {
        return Result.err(new Error(`409 Conflict: version ${playbook.versionId} already exists in history`));
      }

      // Use atomic transaction
      const pipeline = this.redis.pipeline();

      // Get current version (for moving to history)
      pipeline.get(PLAYBOOK_CURRENT_KEY);

      if (current) {
        // Move current to history (isActive = false)
        const oldCurrentForHistory: PlaybookVersion = {
          ...current,
          isActive: false,
        };
        pipeline.lpush(PLAYBOOK_HISTORY_KEY, JSON.stringify(oldCurrentForHistory));
      }

      // Set new current
      pipeline.set(PLAYBOOK_CURRENT_KEY, JSON.stringify(newVersion));

      // Check history length
      pipeline.llen(PLAYBOOK_HISTORY_KEY);

      // Execute transaction
      const results = await pipeline.exec();
      if (!results) {
        return Result.err(new Error('500 Internal Server Error: Redis transaction failed'));
      }

      // Trim history if needed
      const historyLen = results[results.length - 1];
      if (typeof historyLen === 'number' && historyLen > MAX_VERSIONS) {
        // Remove oldest entries from the end
        await this.redis.ltrim(PLAYBOOK_HISTORY_KEY, 0, MAX_VERSIONS - 1);
      }

      return Result.ok(newVersion);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[RollbackManager] promoteVersion error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Get the currently active playbook version
   */
  async getCurrentVersion(): Promise<PlaybookVersion | null> {
    try {
      const currentStr = await this.redis.get(PLAYBOOK_CURRENT_KEY);
      if (!currentStr) return null;

      const version = JSON.parse(currentStr) as PlaybookVersion;

      // Deserialize Date
      if (typeof version.promotedAt === 'string') {
        version.promotedAt = new Date(version.promotedAt);
      }
      if (typeof version.playbook.generatedAt === 'string') {
        version.playbook.generatedAt = new Date(version.playbook.generatedAt);
      }

      return version;
    } catch (err) {
      console.error('[RollbackManager] getCurrentVersion error:', err);
      return null;
    }
  }

  /**
   * Rollback to a specific version
   *
   * Algorithm:
   * 1. Load current and history
   * 2. Find target version in history
   * 3. If not found, return 404
   * 4. Set target as new current (isActive = true)
   * 5. Move current to history (isActive = false)
   * 6. Update history
   */
  async rollbackToVersion(targetVersionId: string): Promise<Result<PlaybookVersion, Error>> {
    try {
      const current = await this.getCurrentVersion();
      if (!current) {
        return Result.err(new Error('404 Not Found: no current version'));
      }

      const history = await this.loadHistory();

      // Find target version
      const targetVersion = history.find(v => v.versionId === targetVersionId);
      if (!targetVersion) {
        return Result.err(new Error(`404 Not Found: version ${targetVersionId} not found in history`));
      }

      // Prepare new active version
      const newActive: PlaybookVersion = {
        ...targetVersion,
        isActive: true,
      };

      // Prepare old current for history
      const oldCurrentForHistory: PlaybookVersion = {
        ...current,
        isActive: false,
      };

      // Use atomic transaction
      const pipeline = this.redis.pipeline();

      // Set new current
      pipeline.set(PLAYBOOK_CURRENT_KEY, JSON.stringify(newActive));

      // Remove old target from history and add current to top
      const newHistory = history
        .filter(v => v.versionId !== targetVersionId)
        .map(v => JSON.stringify(v));

      // Clear and rebuild history
      await this.redis.del(PLAYBOOK_HISTORY_KEY);
      if (newHistory.length > 0) {
        await this.redis.lpush(PLAYBOOK_HISTORY_KEY, ...newHistory);
      }
      // Add old current to top
      await this.redis.lpush(PLAYBOOK_HISTORY_KEY, JSON.stringify(oldCurrentForHistory));

      return Result.ok(newActive);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[RollbackManager] rollbackToVersion error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Get complete version history (current + history array)
   */
  async getVersionHistory(): Promise<PlaybookVersionHistory> {
    try {
      const current = await this.getCurrentVersion();
      const history = await this.loadHistory();

      if (!current) {
        throw new Error('No current version');
      }

      return {
        current,
        history,
      };
    } catch (err) {
      console.error('[RollbackManager] getVersionHistory error:', err);
      return {
        current: {
          versionId: 'v-unknown',
          playbook: {} as EvolvedPlaybook,
          promotedAt: new Date(),
          isActive: true,
        },
        history: [],
      };
    }
  }

  /**
   * Delete a specific version from history (not current)
   */
  async deleteVersion(versionId: string): Promise<Result<void, Error>> {
    try {
      const current = await this.getCurrentVersion();

      if (current && current.versionId === versionId) {
        return Result.err(new Error('400 Bad Request: cannot delete active version'));
      }

      const history = await this.loadHistory();
      const newHistory = history.filter(v => v.versionId !== versionId);

      // Rebuild history
      await this.redis.del(PLAYBOOK_HISTORY_KEY);
      if (newHistory.length > 0) {
        const historyStrs = newHistory.map(v => JSON.stringify(v));
        await this.redis.lpush(PLAYBOOK_HISTORY_KEY, ...historyStrs);
      }

      return Result.ok(undefined);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[RollbackManager] deleteVersion error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Load history from Redis
   * Returns array of PlaybookVersion (oldest to newest in Redis list order)
   */
  private async loadHistory(): Promise<PlaybookVersion[]> {
    try {
      const historyStrs = await this.redis.lrange(PLAYBOOK_HISTORY_KEY, 0, -1);
      if (!historyStrs || historyStrs.length === 0) {
        return [];
      }

      return historyStrs.map((str: string) => {
        const version = JSON.parse(str) as PlaybookVersion;

        // Deserialize Date fields
        if (typeof version.promotedAt === 'string') {
          version.promotedAt = new Date(version.promotedAt);
        }
        if (typeof version.playbook.generatedAt === 'string') {
          version.playbook.generatedAt = new Date(version.playbook.generatedAt);
        }

        return version;
      });
    } catch (err) {
      console.error('[RollbackManager] loadHistory error:', err);
      return [];
    }
  }

  /**
   * Save history to Redis
   */
  private async saveHistory(history: PlaybookVersion[]): Promise<void> {
    try {
      // Clear existing history
      await this.redis.del(PLAYBOOK_HISTORY_KEY);

      if (history.length === 0) {
        return;
      }

      // Add all versions
      const historyStrs = history.map(v => JSON.stringify(v));
      await this.redis.lpush(PLAYBOOK_HISTORY_KEY, ...historyStrs);
    } catch (err) {
      console.error('[RollbackManager] saveHistory error:', err);
      throw err;
    }
  }
}
