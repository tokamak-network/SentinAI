import type { AgentMarketplaceServiceKey } from '@/types/agent-marketplace';

interface AgentMarketplaceRateLimitEntry {
  agentId: string;
  serviceKey: AgentMarketplaceServiceKey;
  timestampMs: number;
}

const rateLimitEntries: AgentMarketplaceRateLimitEntry[] = [];

function getRateLimitWindowMs(): number {
  return Number.parseInt(process.env.MARKETPLACE_RATE_LIMIT_WINDOW_MS ?? '60000', 10);
}

function getRateLimitMaxRequests(): number {
  return Number.parseInt(process.env.MARKETPLACE_RATE_LIMIT_MAX_REQUESTS ?? '60', 10);
}

function prune(nowMs: number): void {
  const cutoff = nowMs - getRateLimitWindowMs();
  for (let index = rateLimitEntries.length - 1; index >= 0; index -= 1) {
    if (rateLimitEntries[index].timestampMs < cutoff) {
      rateLimitEntries.splice(index, 1);
    }
  }
}

export function checkAgentMarketplaceRateLimit(input: {
  agentId: string;
  serviceKey: AgentMarketplaceServiceKey;
  nowMs?: number;
}): { ok: true } | { ok: false; retryAfterMs: number } {
  const nowMs = input.nowMs ?? Date.now();
  prune(nowMs);

  const matchingEntries = rateLimitEntries.filter((entry) => (
    entry.agentId === input.agentId
      && entry.serviceKey === input.serviceKey
  ));

  if (matchingEntries.length >= getRateLimitMaxRequests()) {
    const oldestMatching = matchingEntries[0];
    const retryAfterMs = Math.max(0, (oldestMatching.timestampMs + getRateLimitWindowMs()) - nowMs);
    return { ok: false, retryAfterMs };
  }

  rateLimitEntries.push({
    agentId: input.agentId,
    serviceKey: input.serviceKey,
    timestampMs: nowMs,
  });

  return { ok: true };
}

export function clearAgentMarketplaceRateLimitState(): void {
  rateLimitEntries.length = 0;
}
