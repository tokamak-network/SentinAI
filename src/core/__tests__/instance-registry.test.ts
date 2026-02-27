/**
 * Unit Tests for Instance Registry
 * Tests CRUD operations in in-memory fallback mode (getCoreRedis returns null).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createInstance,
  getInstance,
  listInstances,
  updateInstance,
  deleteInstance,
  deleteInstancesByOperator,
} from '@/core/instance-registry';
import type { CreateNodeInstanceDto } from '@/core/types';

// ============================================================
// Mocks
// ============================================================

vi.mock('@/core/redis', () => ({ getCoreRedis: () => null }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ============================================================
// Test Helpers
// ============================================================

function makeDto(overrides?: Partial<CreateNodeInstanceDto>): CreateNodeInstanceDto {
  return {
    protocolId: 'opstack-l2',
    displayName: 'Test Node',
    connectionConfig: { rpcUrl: 'http://localhost:8545' },
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('InstanceRegistry (in-memory mode)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__sentinai_instance_registry;
  });

  it('createInstance - returns NodeInstance with generated instanceId and status=pending', async () => {
    const instance = await createInstance(makeDto());

    expect(instance.instanceId).toBeTruthy();
    expect(instance.status).toBe('pending');
    expect(instance.protocolId).toBe('opstack-l2');
  });

  it('createInstance - defaults operatorId to "default" when omitted', async () => {
    const instance = await createInstance(makeDto());
    expect(instance.operatorId).toBe('default');
  });

  it('createInstance - uses provided operatorId', async () => {
    const instance = await createInstance(makeDto({ operatorId: 'team-a' }));
    expect(instance.operatorId).toBe('team-a');
  });

  it('getInstance - returns the created instance by id', async () => {
    const created = await createInstance(makeDto({ displayName: 'Alpha Node' }));
    const fetched = await getInstance(created.instanceId);

    expect(fetched).not.toBeNull();
    expect(fetched?.instanceId).toBe(created.instanceId);
    expect(fetched?.displayName).toBe('Alpha Node');
  });

  it('getInstance - returns null for unknown instanceId', async () => {
    const result = await getInstance('nonexistent-id');
    expect(result).toBeNull();
  });

  it('listInstances - returns all instances for a specific operator', async () => {
    await createInstance(makeDto({ operatorId: 'op-1', displayName: 'Node A' }));
    await createInstance(makeDto({ operatorId: 'op-1', displayName: 'Node B' }));
    await createInstance(makeDto({ operatorId: 'op-2', displayName: 'Node C' }));

    const result = await listInstances('op-1');
    expect(result).toHaveLength(2);
    expect(result.every(i => i.operatorId === 'op-1')).toBe(true);
  });

  it('listInstances - returns all instances when operatorId is omitted', async () => {
    await createInstance(makeDto({ operatorId: 'op-1' }));
    await createInstance(makeDto({ operatorId: 'op-2' }));
    await createInstance(makeDto({ operatorId: 'op-3' }));

    const result = await listInstances();
    expect(result).toHaveLength(3);
  });

  it('updateInstance - modifies specified fields and refreshes updatedAt', async () => {
    const created = await createInstance(makeDto());
    const originalUpdatedAt = created.updatedAt;

    // Wait 1ms to ensure updatedAt changes
    await new Promise(r => setTimeout(r, 1));

    const updated = await updateInstance(created.instanceId, {
      displayName: 'Updated Name',
      status: 'active',
    });

    expect(updated).not.toBeNull();
    expect(updated?.displayName).toBe('Updated Name');
    expect(updated?.status).toBe('active');
    expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('updateInstance - returns null for unknown instanceId', async () => {
    const result = await updateInstance('nonexistent-id', { displayName: 'X' });
    expect(result).toBeNull();
  });

  it('deleteInstance - returns true and makes getInstance return null', async () => {
    const created = await createInstance(makeDto());
    const deleted = await deleteInstance(created.instanceId);

    expect(deleted).toBe(true);
    expect(await getInstance(created.instanceId)).toBeNull();
  });

  it('deleteInstance - returns false for unknown instanceId', async () => {
    const result = await deleteInstance('nonexistent-id');
    expect(result).toBe(false);
  });

  it('two instances from different operators are isolated in listInstances', async () => {
    await createInstance(makeDto({ operatorId: 'team-x', displayName: 'X-Node' }));
    await createInstance(makeDto({ operatorId: 'team-y', displayName: 'Y-Node' }));

    const teamX = await listInstances('team-x');
    const teamY = await listInstances('team-y');

    expect(teamX).toHaveLength(1);
    expect(teamX[0].displayName).toBe('X-Node');
    expect(teamY).toHaveLength(1);
    expect(teamY[0].displayName).toBe('Y-Node');
  });

  it('deleteInstancesByOperator - removes all instances for an operator and returns count', async () => {
    await createInstance(makeDto({ operatorId: 'rm-op' }));
    await createInstance(makeDto({ operatorId: 'rm-op' }));
    await createInstance(makeDto({ operatorId: 'keep-op' }));

    const count = await deleteInstancesByOperator('rm-op');
    expect(count).toBe(2);
    expect(await listInstances('rm-op')).toHaveLength(0);
    expect(await listInstances('keep-op')).toHaveLength(1);
  });
});
