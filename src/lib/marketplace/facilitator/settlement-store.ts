import { getCoreRedis } from '@/core/redis';
import type { SettlementRecord, SettlementStatusUpdate } from '@/lib/marketplace/facilitator/types';

function getRedisClient() {
  const redis = getCoreRedis();
  if (!redis) {
    throw new Error('Redis is required for facilitator settlement storage');
  }
  return redis;
}

function getSettlementKey(redisPrefix: string, chainId: number, settlementId: string): string {
  return `${redisPrefix}:facilitator:settlement:${chainId}:${settlementId}`;
}

function getPendingKey(redisPrefix: string, chainId: number): string {
  return `${redisPrefix}:facilitator:pending:${chainId}`;
}

export async function createSettlement(redisPrefix: string, record: SettlementRecord): Promise<void> {
  const redis = getRedisClient();
  await redis.set(getSettlementKey(redisPrefix, record.chainId, record.settlementId), JSON.stringify(record));
  if (record.status === 'submitted') {
    await redis.sadd(getPendingKey(redisPrefix, record.chainId), record.settlementId);
  }
}

export async function getSettlement(
  redisPrefix: string,
  chainId: number,
  settlementId: string
): Promise<SettlementRecord | null> {
  const redis = getRedisClient();
  const raw = await redis.get(getSettlementKey(redisPrefix, chainId, settlementId));
  return raw ? (JSON.parse(raw) as SettlementRecord) : null;
}

export async function listPendingSettlements(redisPrefix: string, chainId: number): Promise<SettlementRecord[]> {
  const redis = getRedisClient();
  const ids = await redis.smembers(getPendingKey(redisPrefix, chainId));
  const records = await Promise.all(ids.map((id) => getSettlement(redisPrefix, chainId, id)));
  return records.filter((record): record is SettlementRecord => record !== null);
}

export async function markSettlementStatus(
  redisPrefix: string,
  chainId: number,
  settlementId: string,
  update: SettlementStatusUpdate
): Promise<SettlementRecord> {
  const redis = getRedisClient();
  const existing = await getSettlement(redisPrefix, chainId, settlementId);
  if (!existing) {
    throw new Error(`Settlement not found: ${settlementId}`);
  }

  const updated: SettlementRecord = {
    ...existing,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  await redis.set(getSettlementKey(redisPrefix, chainId, settlementId), JSON.stringify(updated));
  if (update.status !== 'submitted') {
    await redis.srem(getPendingKey(redisPrefix, chainId), settlementId);
  }

  return updated;
}
