import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RollbackManager } from './rollback-manager';
import type { IStateStore } from '../../types/redis';
import type { Redis } from 'ioredis';
import type { EvolvedPlaybook, PlaybookVersion } from '../types/playbook-evolution';

describe('RollbackManager', () => {
  let mockStore: any;
  let mockRedis: any;
  let manager: RollbackManager;

  const createPlaybook = (versionId: string): EvolvedPlaybook => ({
    id: 'pb-001',
    name: `Playbook ${versionId}`,
    description: `Auto-generated ${versionId}`,
    actions: [
      { type: 'scale', target: 'sequencer', params: { replicas: 5 }, timeout: 30000 },
    ],
    fallbacks: [
      { type: 'drain', target: 'sequencer', params: {}, timeout: 15000 },
    ],
    timeout: 60000,
    versionId,
    parentVersionId: versionId === 'v-0' ? 'v-root' : `v-${parseInt(versionId.split('-')[1], 10) - 1}`,
    generatedAt: new Date(),
    generatedBy: 'claude-sonnet-4-5-20250929',
    confidenceSource: 'llm_generation' as const,
    generationPromptUsage: {
      inputTokens: 4200,
      outputTokens: 1850,
      totalCost: 0.042,
    },
    patternContext: {
      patterns: [],
      successRateBaseline: 78,
    },
  });

  beforeEach(() => {
    mockStore = {
      setPlaybookVersion: vi.fn().mockResolvedValue(undefined),
      getPlaybookVersion: vi.fn().mockResolvedValue(null),
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      lrange: vi.fn().mockResolvedValue([]),
      lpush: vi.fn().mockResolvedValue(1),
      llen: vi.fn().mockResolvedValue(0),
      lindex: vi.fn().mockResolvedValue(null),
      lpop: vi.fn().mockResolvedValue(null),
      lrem: vi.fn().mockResolvedValue(0),
      ltrim: vi.fn().mockResolvedValue('OK'),
      pipeline: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnThis(),
        lpush: vi.fn().mockReturnThis(),
        llen: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([null, 1, null, 0, 'OK']),
      }),
    };

    manager = new RollbackManager(mockStore as IStateStore, mockRedis as Redis);
  });

  /**
   * Test 1: promoteVersion - 새로운 playbook 승격 → current 설정
   */
  it('should promote a new playbook version to current', async () => {
    const playbook = createPlaybook('v-1');

    mockRedis.get.mockResolvedValueOnce(null); // playbook:current doesn't exist
    mockRedis.set.mockResolvedValueOnce('OK'); // set playbook:current

    const result = await manager.promoteVersion(playbook);

    expect(result.isOk()).toBe(true);
    const promoted = result.unwrap();
    expect(promoted.versionId).toBe('v-1');
    expect(promoted.isActive).toBe(true);
    expect(promoted.playbook).toEqual(playbook);
    expect(promoted.promotedAt).toBeInstanceOf(Date);
  });

  /**
   * Test 2: promoteVersion - 기존 버전은 history로 이동
   */
  it('should move previous current version to history', async () => {
    const v0 = createPlaybook('v-0');
    const v1 = createPlaybook('v-1');

    const oldCurrent: PlaybookVersion = {
      versionId: 'v-0',
      playbook: v0,
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(oldCurrent)); // playbook:current exists
    mockRedis.lrange.mockResolvedValueOnce([]); // empty history
    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      llen: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        JSON.stringify(oldCurrent), // old current
        1, // lpush result
        'OK', // set result
        1, // llen result
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const result = await manager.promoteVersion(v1);

    expect(result.isOk()).toBe(true);
    const promoted = result.unwrap();
    expect(promoted.versionId).toBe('v-1');
    expect(promoted.isActive).toBe(true);
  });

  /**
   * Test 3: promoteVersion - 중복 버전 ID 거부 (409 Conflict)
   */
  it('should reject duplicate version ID with 409 Conflict', async () => {
    const v1 = createPlaybook('v-1');

    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({
        versionId: 'v-1',
        playbook: v1,
        promotedAt: new Date('2026-03-10'),
        isActive: true,
      })
    );
    mockRedis.lrange.mockResolvedValueOnce([
      JSON.stringify({
        versionId: 'v-1',
        playbook: v1,
        promotedAt: new Date('2026-03-09'),
        isActive: false,
      }),
    ]);

    const result = await manager.promoteVersion(v1);

    expect(result.isErr()).toBe(true);
    const error = result.getError();
    expect(error?.message).toContain('409');
    expect(error?.message).toContain('already exists');
  });

  /**
   * Test 4: promoteVersion - history 크기 제한 (max 10)
   */
  it('should maintain max 10 versions in history', async () => {
    const v11 = createPlaybook('v-11');

    // Create 10 existing versions
    const existingHistory = Array.from({ length: 10 }, (_, i) => ({
      versionId: `v-${i}`,
      playbook: createPlaybook(`v-${i}`),
      promotedAt: new Date('2026-03-01'),
      isActive: false,
    }));

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      versionId: 'v-10',
      playbook: createPlaybook('v-10'),
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    }));
    mockRedis.lrange.mockResolvedValueOnce(existingHistory.map(v => JSON.stringify(v)));

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      llen: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        JSON.stringify({
          versionId: 'v-10',
          playbook: createPlaybook('v-10'),
          promotedAt: new Date('2026-03-10'),
          isActive: true,
        }),
        11, // lpush result
        'OK', // set result
        11, // llen result
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    // ltrim is called after exec
    mockRedis.ltrim.mockResolvedValueOnce(0);

    const result = await manager.promoteVersion(v11);

    expect(result.isOk()).toBe(true);
    const promoted = result.unwrap();
    expect(promoted.versionId).toBe('v-11');
    // Verify that ltrim was called to maintain max 10
    expect(mockRedis.ltrim).toHaveBeenCalledWith('playbook:history', 0, 9);
  });

  /**
   * Test 5: getCurrentVersion - 현재 활성 버전 반환
   */
  it('should return current active version', async () => {
    const v1: PlaybookVersion = {
      versionId: 'v-1',
      playbook: createPlaybook('v-1'),
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(v1));

    const result = await manager.getCurrentVersion();

    expect(result).not.toBeNull();
    expect(result?.versionId).toBe('v-1');
    expect(result?.isActive).toBe(true);
  });

  /**
   * Test 6: rollbackToVersion - 이전 버전으로 복구
   */
  it('should rollback to specified version', async () => {
    const v0 = createPlaybook('v-0');
    const v1 = createPlaybook('v-1');

    const current: PlaybookVersion = {
      versionId: 'v-1',
      playbook: v1,
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    };

    const history: PlaybookVersion[] = [
      {
        versionId: 'v-0',
        playbook: v0,
        promotedAt: new Date('2026-03-09'),
        isActive: false,
      },
    ];

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(current));
    mockRedis.lrange.mockResolvedValueOnce(history.map(v => JSON.stringify(v)));

    const mockPipeline = {
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce(['OK', 'OK']),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const result = await manager.rollbackToVersion('v-0');

    expect(result.isOk()).toBe(true);
    const rolledBack = result.unwrap();
    expect(rolledBack.versionId).toBe('v-0');
    expect(rolledBack.isActive).toBe(true);
  });

  /**
   * Test 7: rollbackToVersion - 존재하지 않는 버전 에러
   */
  it('should return error for non-existent version', async () => {
    const current: PlaybookVersion = {
      versionId: 'v-1',
      playbook: createPlaybook('v-1'),
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(current));
    mockRedis.lrange.mockResolvedValueOnce([]); // empty history

    const result = await manager.rollbackToVersion('v-99');

    expect(result.isErr()).toBe(true);
    const error = result.getError();
    expect(error?.message).toContain('404');
    expect(error?.message).toContain('not found');
  });

  /**
   * Test 8: getVersionHistory - history array 포함 current 반환
   */
  it('should return complete version history with current and history array', async () => {
    const v0 = createPlaybook('v-0');
    const v1 = createPlaybook('v-1');

    const current: PlaybookVersion = {
      versionId: 'v-1',
      playbook: v1,
      promotedAt: new Date('2026-03-10'),
      isActive: true,
    };

    const history: PlaybookVersion[] = [
      {
        versionId: 'v-0',
        playbook: v0,
        promotedAt: new Date('2026-03-09'),
        isActive: false,
      },
    ];

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(current));
    mockRedis.lrange.mockResolvedValueOnce(history.map(v => JSON.stringify(v)));

    const result = await manager.getVersionHistory();

    expect(result.current.versionId).toBe('v-1');
    expect(result.current.isActive).toBe(true);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].versionId).toBe('v-0');
  });
});
