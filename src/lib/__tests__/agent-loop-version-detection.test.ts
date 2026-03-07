import { describe, expect, it, vi, beforeEach } from 'vitest';
import { checkAndTrackClientVersion } from '@/lib/client-version-tracker';

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import logger from '@/lib/logger';

function makeRedisMock(storedVersion: string | null) {
  return {
    get: vi.fn().mockResolvedValue(storedVersion),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('checkAndTrackClientVersion', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('returns changed=false and stores version on first call (no previous version)', async () => {
    const redis = makeRedisMock(null);
    const result = await checkAndTrackClientVersion(
      redis as never,
      'inst:abc',
      'Geth/v1.14.0-stable'
    );

    expect(result.changed).toBe(false);
    expect(result.currentVersion).toBe('Geth/v1.14.0-stable');
    expect(result.previousVersion).toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith('inst:abc:lastClientVersion', 'Geth/v1.14.0-stable');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('returns changed=false when version is unchanged', async () => {
    const redis = makeRedisMock('Geth/v1.14.0-stable');
    const result = await checkAndTrackClientVersion(
      redis as never,
      'inst:abc',
      'Geth/v1.14.0-stable'
    );

    expect(result.changed).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('when clientVersion changes: invalidates capabilities and stores new version', async () => {
    const redis = makeRedisMock('Geth/v1.13.0-stable');
    const result = await checkAndTrackClientVersion(
      redis as never,
      'inst:abc',
      'Geth/v1.14.0-stable'
    );

    expect(result.changed).toBe(true);
    expect(result.previousVersion).toBe('Geth/v1.13.0-stable');
    expect(result.currentVersion).toBe('Geth/v1.14.0-stable');

    // Must update stored version
    expect(redis.set).toHaveBeenCalledWith('inst:abc:lastClientVersion', 'Geth/v1.14.0-stable');
    // Must invalidate capabilities cache
    expect(redis.del).toHaveBeenCalledWith('inst:abc:capabilities');
    // Must log a warning
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs warning with old and new version strings', async () => {
    const redis = makeRedisMock('Nethermind/v1.25.0');
    await checkAndTrackClientVersion(
      redis as never,
      'inst:xyz',
      'Nethermind/v1.26.0'
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        previousVersion: 'Nethermind/v1.25.0',
        currentVersion: 'Nethermind/v1.26.0',
      }),
      expect.stringContaining('Nethermind/v1.25.0')
    );
  });

  it('returns changed=false and no Redis writes in no-Redis mode', async () => {
    const result = await checkAndTrackClientVersion(null, 'inst:abc', 'Geth/v1.14.0');
    expect(result.changed).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('no change when currentVersion is undefined (client version unavailable)', async () => {
    const redis = makeRedisMock('Geth/v1.14.0-stable');
    const result = await checkAndTrackClientVersion(redis as never, 'inst:abc', undefined);
    expect(result.changed).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
  });
});
