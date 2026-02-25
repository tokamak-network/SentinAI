import type { NextRequest } from 'next/server';
import type { OpsAuthContext, OpsRole } from '@/lib/ops-adapter/types';

function roleRank(role: OpsRole): number {
  switch (role) {
    case 'viewer':
      return 1;
    case 'operator':
      return 2;
    case 'admin':
      return 3;
    default:
      return 0;
  }
}

function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getTokenRole(token: string): OpsAuthContext | null {
  const admin = process.env.SENTINAI_ADAPTER_ADMIN_TOKEN?.trim();
  const operator = process.env.SENTINAI_ADAPTER_OPERATOR_TOKEN?.trim();
  const viewer = process.env.SENTINAI_ADAPTER_VIEWER_TOKEN?.trim();

  if (admin && token === admin) return { role: 'admin', tokenId: 'admin' };
  if (operator && token === operator) return { role: 'operator', tokenId: 'operator' };
  if (viewer && token === viewer) return { role: 'viewer', tokenId: 'viewer' };

  const json = process.env.SENTINAI_ADAPTER_TOKENS_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, OpsRole>;
      const role = parsed[token];
      if (role === 'viewer' || role === 'operator' || role === 'admin') {
        return { role, tokenId: 'json' };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function requireAuth(request: NextRequest): OpsAuthContext {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const ctx = getTokenRole(token);
  if (!ctx) {
    throw new Error('Invalid bearer token');
  }

  return ctx;
}

export function requireRole(ctx: OpsAuthContext, minRole: OpsRole): void {
  if (roleRank(ctx.role) < roleRank(minRole)) {
    throw new Error(`Forbidden: requires role ${minRole}`);
  }
}
