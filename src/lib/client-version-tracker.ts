/**
 * Client version change detection for the agent loop observe phase.
 *
 * Compares the current EL client version string against the last known version
 * stored in Redis. When a change is detected, invalidates the capabilities cache
 * so the next /validate call triggers re-detection.
 */

import type { Redis } from 'ioredis';
import logger from '@/lib/logger';

export interface VersionCheckResult {
  /** Whether the version has changed since last check */
  changed: boolean;
  /** The version string from the current detect call */
  currentVersion: string | undefined;
  /** The version string stored from the previous check */
  previousVersion: string | undefined;
}

const LAST_VERSION_SUFFIX = ':lastClientVersion';
const CAPABILITIES_SUFFIX = ':capabilities';

/**
 * Check if the client version has changed, and if so:
 * - Log a warning
 * - Store the new version in Redis under `{keyPrefix}:lastClientVersion`
 * - Delete `{keyPrefix}:capabilities` to force re-detection on next validate call
 *
 * @param redis - Redis client (if null, operates in no-op / memory-only mode)
 * @param keyPrefix - Redis key prefix, e.g. "inst:abc123" or "agent:default"
 * @param currentVersion - Version string from the current detectClient call
 * @returns VersionCheckResult indicating whether a change occurred
 */
export async function checkAndTrackClientVersion(
  redis: Redis | null,
  keyPrefix: string,
  currentVersion: string | undefined
): Promise<VersionCheckResult> {
  if (!redis) {
    // In-memory mode: no persistence, can't detect changes across cycles
    return { changed: false, currentVersion, previousVersion: undefined };
  }

  const lastVersionKey = `${keyPrefix}${LAST_VERSION_SUFFIX}`;
  const capabilitiesKey = `${keyPrefix}${CAPABILITIES_SUFFIX}`;

  const previousVersion = (await redis.get(lastVersionKey)) ?? undefined;

  // If no version was stored yet, just store current
  if (previousVersion === undefined) {
    if (currentVersion) {
      await redis.set(lastVersionKey, currentVersion);
    }
    return { changed: false, currentVersion, previousVersion: undefined };
  }

  // Compare versions
  if (currentVersion === undefined || currentVersion === previousVersion) {
    return { changed: false, currentVersion, previousVersion };
  }

  // Version changed — log warning, update stored version, invalidate capabilities
  logger.warn(
    { keyPrefix, previousVersion, currentVersion },
    `Client version changed: ${previousVersion} → ${currentVersion}`
  );

  await Promise.all([
    redis.set(lastVersionKey, currentVersion),
    redis.del(capabilitiesKey),
  ]);

  return { changed: true, currentVersion, previousVersion };
}
