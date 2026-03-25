import { getCoreRedis } from '@/core/redis';
import type { EvolvedPlaybook, OperationRecord } from './types';

const KEY_PLAYBOOKS = (instanceId: string) => `inst:${instanceId}:playbooks:v2`;
const KEY_LEDGER = (instanceId: string) => `inst:${instanceId}:operation-ledger:v2`;
const LEDGER_MAX = Number(process.env.OPERATION_LEDGER_MAX) || 1000;

const g = globalThis as unknown as {
  __sentinai_playbook_store?: Map<string, EvolvedPlaybook[]>;
  __sentinai_ledger_store?: Map<string, OperationRecord[]>;
};

function memoryPlaybooks(): Map<string, EvolvedPlaybook[]> {
  if (!g.__sentinai_playbook_store) g.__sentinai_playbook_store = new Map();
  return g.__sentinai_playbook_store;
}

function memoryLedger(): Map<string, OperationRecord[]> {
  if (!g.__sentinai_ledger_store) g.__sentinai_ledger_store = new Map();
  return g.__sentinai_ledger_store;
}

export async function listPlaybooks(instanceId: string): Promise<EvolvedPlaybook[]> {
  const redis = getCoreRedis();
  if (redis) {
    const raw = await redis.get(KEY_PLAYBOOKS(instanceId));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as EvolvedPlaybook[];
    } catch {
      return [];
    }
  }

  return [...(memoryPlaybooks().get(instanceId) ?? [])];
}

export async function getPlaybook(instanceId: string, playbookId: string): Promise<EvolvedPlaybook | null> {
  const all = await listPlaybooks(instanceId);
  return all.find((p) => p.playbookId === playbookId) || null;
}

export async function upsertPlaybook(instanceId: string, playbook: EvolvedPlaybook): Promise<void> {
  const all = await listPlaybooks(instanceId);
  const next = all.filter((p) => p.playbookId !== playbook.playbookId);
  next.push(playbook);

  const redis = getCoreRedis();
  if (redis) {
    await redis.set(KEY_PLAYBOOKS(instanceId), JSON.stringify(next));
    return;
  }

  memoryPlaybooks().set(instanceId, next);
}

export async function listOperationLedger(
  instanceId: string,
  input: { limit?: number; offset?: number } = {}
): Promise<{ records: OperationRecord[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  const redis = getCoreRedis();
  let all: OperationRecord[] = [];

  if (redis) {
    const raw = await redis.lrange(KEY_LEDGER(instanceId), 0, -1);
    all = raw
      .map((item) => {
        try {
          return JSON.parse(item) as OperationRecord;
        } catch {
          return null;
        }
      })
      .filter((item): item is OperationRecord => item !== null);
  } else {
    all = [...(memoryLedger().get(instanceId) ?? [])];
  }

  return {
    records: all.slice(offset, offset + limit),
    total: all.length,
  };
}

export async function appendOperationRecord(instanceId: string, record: OperationRecord): Promise<void> {
  const redis = getCoreRedis();
  if (redis) {
    await redis.lpush(KEY_LEDGER(instanceId), JSON.stringify(record));
    await redis.ltrim(KEY_LEDGER(instanceId), 0, LEDGER_MAX - 1);
    return;
  }

  const all = memoryLedger().get(instanceId) ?? [];
  all.unshift(record);
  if (all.length > LEDGER_MAX) all.splice(LEDGER_MAX);
  memoryLedger().set(instanceId, all);
}
