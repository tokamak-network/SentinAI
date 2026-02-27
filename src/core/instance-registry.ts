/**
 * Instance Registry
 * CRUD operations for NodeInstance objects.
 * Persistent storage: Redis (if REDIS_URL set) or in-memory fallback.
 *
 * Redis key schema:
 *   inst:{instanceId}:config       → JSON string of NodeInstance
 *   inst:index:{operatorId}        → Redis Set of instanceIds for this operator
 *   inst:index:all                 → Redis Set of all instanceIds
 */

import { randomUUID } from 'crypto';
import type {
  NodeInstance,
  CreateNodeInstanceDto,
  UpdateNodeInstanceDto,
} from './types';
import { getCoreRedis } from './redis';
import logger from '@/lib/logger';

// ============================================================
// Key Helpers
// ============================================================

const KEY_CONFIG = (id: string) => `inst:${id}:config`;
const KEY_INDEX_OPERATOR = (operatorId: string) => `inst:index:${operatorId}`;
const KEY_INDEX_ALL = 'inst:index:all';

// ============================================================
// In-Memory Fallback
// ============================================================

/** Survives Next.js Turbopack hot reload */
const g = globalThis as unknown as {
  __sentinai_instance_registry?: Map<string, NodeInstance>;
};

function getMemoryStore(): Map<string, NodeInstance> {
  if (!g.__sentinai_instance_registry) {
    g.__sentinai_instance_registry = new Map();
  }
  return g.__sentinai_instance_registry;
}

// ============================================================
// CRUD Operations
// ============================================================

/**
 * Create and persist a new NodeInstance.
 * Returns the created instance with generated instanceId and timestamps.
 */
export async function createInstance(dto: CreateNodeInstanceDto): Promise<NodeInstance> {
  const now = new Date().toISOString();
  const instance: NodeInstance = {
    instanceId: randomUUID(),
    operatorId: dto.operatorId ?? 'default',
    protocolId: dto.protocolId,
    displayName: dto.displayName,
    connectionConfig: dto.connectionConfig,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    metadata: dto.metadata,
  };

  await persistInstance(instance);
  logger.info(`[InstanceRegistry] Created instance ${instance.instanceId} (${instance.protocolId})`);
  return instance;
}

/**
 * Get a NodeInstance by instanceId.
 * Returns null if not found.
 */
export async function getInstance(instanceId: string): Promise<NodeInstance | null> {
  const redis = getCoreRedis();

  if (redis) {
    const raw = await redis.get(KEY_CONFIG(instanceId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NodeInstance;
    } catch {
      logger.error(`[InstanceRegistry] Failed to parse instance ${instanceId}`);
      return null;
    }
  }

  return getMemoryStore().get(instanceId) ?? null;
}

/**
 * List all NodeInstances for an operator.
 * If operatorId is omitted, returns all instances.
 */
export async function listInstances(operatorId?: string): Promise<NodeInstance[]> {
  const redis = getCoreRedis();

  if (redis) {
    const indexKey = operatorId ? KEY_INDEX_OPERATOR(operatorId) : KEY_INDEX_ALL;
    const ids = await redis.smembers(indexKey);
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(KEY_CONFIG(id));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const instances: NodeInstance[] = [];
    for (const [err, raw] of results) {
      if (err || !raw) continue;
      try {
        instances.push(JSON.parse(raw as string) as NodeInstance);
      } catch {
        // skip corrupted entries
      }
    }
    return instances.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // In-memory fallback
  const all = Array.from(getMemoryStore().values());
  const filtered = operatorId ? all.filter(i => i.operatorId === operatorId) : all;
  return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Update fields on an existing NodeInstance.
 * Merges partial updates; updatedAt is always refreshed.
 * Returns null if instance not found.
 */
export async function updateInstance(
  instanceId: string,
  dto: UpdateNodeInstanceDto
): Promise<NodeInstance | null> {
  const existing = await getInstance(instanceId);
  if (!existing) return null;

  const updated: NodeInstance = {
    ...existing,
    ...(dto.displayName !== undefined && { displayName: dto.displayName }),
    ...(dto.status !== undefined && { status: dto.status }),
    ...(dto.metadata !== undefined && { metadata: { ...existing.metadata, ...dto.metadata } }),
    connectionConfig: dto.connectionConfig
      ? { ...existing.connectionConfig, ...dto.connectionConfig }
      : existing.connectionConfig,
    updatedAt: new Date().toISOString(),
  };

  await persistInstance(updated);
  return updated;
}

/**
 * Delete a NodeInstance and all associated Redis keys.
 * Returns true if deleted, false if not found.
 */
export async function deleteInstance(instanceId: string): Promise<boolean> {
  const existing = await getInstance(instanceId);
  if (!existing) return false;

  const redis = getCoreRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    pipeline.del(KEY_CONFIG(instanceId));
    pipeline.srem(KEY_INDEX_ALL, instanceId);
    pipeline.srem(KEY_INDEX_OPERATOR(existing.operatorId), instanceId);
    await pipeline.exec();
  } else {
    getMemoryStore().delete(instanceId);
  }

  logger.info(`[InstanceRegistry] Deleted instance ${instanceId}`);
  return true;
}

/**
 * Delete all instances and index keys for an operator.
 * Returns the count of deleted instances.
 */
export async function deleteInstancesByOperator(operatorId: string): Promise<number> {
  const instances = await listInstances(operatorId);
  let count = 0;
  for (const instance of instances) {
    const deleted = await deleteInstance(instance.instanceId);
    if (deleted) count++;
  }
  return count;
}

// ============================================================
// Internal Helpers
// ============================================================

async function persistInstance(instance: NodeInstance): Promise<void> {
  const redis = getCoreRedis();
  const json = JSON.stringify(instance);

  if (redis) {
    const pipeline = redis.pipeline();
    pipeline.set(KEY_CONFIG(instance.instanceId), json);
    pipeline.sadd(KEY_INDEX_ALL, instance.instanceId);
    pipeline.sadd(KEY_INDEX_OPERATOR(instance.operatorId), instance.instanceId);
    await pipeline.exec();
  } else {
    getMemoryStore().set(instance.instanceId, instance);
  }
}
