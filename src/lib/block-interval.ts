/**
 * Block interval calculation helpers.
 */

const DEFAULT_BLOCK_INTERVAL_SECONDS = 2.0;

export interface BlockIntervalParams {
  currentBlockHeight: bigint;
  lastBlockHeight: string | null;
  lastBlockTime: string | null;
  nowMs: number;
  seedBlockInterval?: number;
}

/**
 * Resolve block interval.
 * - If seed block interval is provided, always preserve it.
 * - Otherwise, calculate from last block state when possible.
 * - Falls back to default interval when inputs are insufficient.
 */
export function resolveBlockInterval({
  currentBlockHeight,
  lastBlockHeight,
  lastBlockTime,
  nowMs,
  seedBlockInterval,
}: BlockIntervalParams): number {
  if (
    typeof seedBlockInterval === 'number' &&
    Number.isFinite(seedBlockInterval) &&
    seedBlockInterval > 0
  ) {
    return seedBlockInterval;
  }

  if (lastBlockHeight === null || lastBlockTime === null) {
    return DEFAULT_BLOCK_INTERVAL_SECONDS;
  }

  const parsedLastTime = Number(lastBlockTime);
  if (!Number.isFinite(parsedLastTime)) {
    return DEFAULT_BLOCK_INTERVAL_SECONDS;
  }

  const lastHeight = BigInt(lastBlockHeight);
  if (currentBlockHeight <= lastHeight) {
    return DEFAULT_BLOCK_INTERVAL_SECONDS;
  }

  const timeDiffSec = (nowMs - parsedLastTime) / 1000;
  const blockDiff = Number(currentBlockHeight - lastHeight);

  if (!Number.isFinite(timeDiffSec) || timeDiffSec <= 0 || blockDiff <= 0) {
    return DEFAULT_BLOCK_INTERVAL_SECONDS;
  }

  return timeDiffSec / blockDiff;
}

