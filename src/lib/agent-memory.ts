/**
 * Agent Memory and Decision Trace Store Helpers
 */

import { getStore } from '@/lib/redis-store';
import type {
  AgentMemoryEntry,
  AgentMemoryQuery,
  DecisionTrace,
  DecisionTraceQuery,
} from '@/types/agent-memory';

const DEFAULT_RETENTION_DAYS = 30;

function getRetentionDays(): number {
  const parsed = Number.parseInt(process.env.AGENT_MEMORY_RETENTION_DAYS || `${DEFAULT_RETENTION_DAYS}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

export function isAgentMemoryEnabled(): boolean {
  return process.env.AGENT_MEMORY_ENABLED !== 'false';
}

function shouldMaskSecrets(): boolean {
  return process.env.AGENT_TRACE_MASK_SECRETS !== 'false';
}

export function maskSensitiveText(text: string): string {
  if (!shouldMaskSecrets()) return text;

  return text
    // private key like 0x + 64 hex
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, '0x<redacted-private-key>')
    // sk- tokens
    .replace(/\bsk-[A-Za-z0-9_\-]{16,}\b/g, 'sk-<redacted>')
    // URL credentials
    .replace(/(https?:\/\/)([^@\s/]+)@/g, '$1<redacted>@');
}

function sanitizeMemoryEntry(entry: AgentMemoryEntry): AgentMemoryEntry {
  return {
    ...entry,
    summary: maskSensitiveText(entry.summary),
    metadata: entry.metadata
      ? JSON.parse(maskSensitiveText(JSON.stringify(entry.metadata))) as Record<string, unknown>
      : undefined,
  };
}

function sanitizeDecisionTrace(trace: DecisionTrace): DecisionTrace {
  return {
    ...trace,
    reasoningSummary: maskSensitiveText(trace.reasoningSummary),
    chosenAction: maskSensitiveText(trace.chosenAction),
    alternatives: trace.alternatives.map((item) => maskSensitiveText(item)),
    evidence: trace.evidence.map((item) => ({
      ...item,
      value: maskSensitiveText(item.value),
      source: item.source ? maskSensitiveText(item.source) : undefined,
    })),
  };
}

export async function addAgentMemoryEntry(entry: AgentMemoryEntry): Promise<void> {
  if (!isAgentMemoryEnabled()) return;
  await getStore().addAgentMemory(sanitizeMemoryEntry(entry));
}

export async function queryAgentMemory(query?: AgentMemoryQuery): Promise<AgentMemoryEntry[]> {
  if (!isAgentMemoryEnabled()) return [];
  return getStore().queryAgentMemory(query);
}

export async function addDecisionTraceEntry(trace: DecisionTrace): Promise<void> {
  if (!isAgentMemoryEnabled()) return;
  await getStore().addDecisionTrace(sanitizeDecisionTrace(trace));
}

export async function getDecisionTraceEntry(decisionId: string): Promise<DecisionTrace | null> {
  if (!isAgentMemoryEnabled()) return null;
  return getStore().getDecisionTrace(decisionId);
}

export async function listDecisionTraceEntries(query?: DecisionTraceQuery): Promise<DecisionTrace[]> {
  if (!isAgentMemoryEnabled()) return [];
  return getStore().listDecisionTraces(query);
}

export async function cleanupExpiredAgentMemory(now: number = Date.now()): Promise<number> {
  if (!isAgentMemoryEnabled()) return 0;
  const retentionMs = getRetentionDays() * 24 * 60 * 60 * 1000;
  const cutoff = now - retentionMs;
  return getStore().cleanupAgentMemory(cutoff);
}
