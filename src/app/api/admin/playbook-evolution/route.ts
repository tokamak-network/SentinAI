/**
 * Playbook Evolution API Endpoint
 *
 * GET:  /api/admin/playbook-evolution - Fetch current version and history
 * POST: /api/admin/playbook-evolution - Trigger evolution or rollback
 *
 * Authentication: Bearer token (SENTINAI_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server';
import { RollbackManager } from '@/lib/playbook-evolution/rollback-manager';
import { PatternMiner } from '@/lib/playbook-evolution/pattern-miner';
import { getRedisInstance } from '@/lib/redis-store';
import { getStateStore } from '@/lib/state-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Authenticate request with Bearer token
 * Returns error response if authentication fails, null if successful
 */
function authenticate(request: NextRequest): NextResponse | null {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    const expectedKey = process.env.SENTINAI_API_KEY;

    if (!expectedKey || !token || token !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return null; // Authentication successful
  } catch (error) {
    logger.error('[API] authenticate error:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

/**
 * GET /api/admin/playbook-evolution
 * Returns current version and complete version history
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const authError = authenticate(request);
  if (authError) return authError;

  try {
    const redis = getRedisInstance();
    const store = getStateStore();
    const manager = new RollbackManager(store, redis);

    const versionHistory = await manager.getVersionHistory();

    return NextResponse.json({
      current: versionHistory.current,
      history: versionHistory.history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[API] GET /playbook-evolution error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch playbook evolution status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/playbook-evolution
 * Trigger evolution or rollback
 *
 * Request body:
 * { "action": "trigger_evolution" } - Analyze patterns and generate new playbook
 * { "action": "rollback", "versionId": "v-1" } - Rollback to a specific version
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const authError = authenticate(request);
  if (authError) return authError;

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string | undefined;

    if (!action) {
      return NextResponse.json(
        { error: 'Missing action field' },
        { status: 400 }
      );
    }

    const redis = getRedisInstance();
    const store = getStateStore();

    if (action === 'trigger_evolution') {
      return await handleTriggerEvolution(store, redis);
    } else if (action === 'rollback') {
      const versionId = body.versionId as string | undefined;
      if (!versionId) {
        return NextResponse.json(
          { error: 'Missing versionId for rollback action' },
          { status: 400 }
        );
      }
      return await handleRollback(store, redis, versionId);
    } else {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('[API] POST /playbook-evolution error:', error);
    return NextResponse.json(
      { error: 'Failed to process playbook evolution request' },
      { status: 500 }
    );
  }
}

/**
 * Handle trigger_evolution action
 * Analyzes patterns and generates new playbook if evolution is triggered
 */
async function handleTriggerEvolution(
  store: any,
  redis: any
): Promise<NextResponse> {
  try {
    const miner = new PatternMiner(store, redis);
    const patterns = await miner.analyzeAndEvolve();

    return NextResponse.json({
      action: 'evolution_triggered',
      patterns: patterns ?? [],
      evolved: patterns ? { note: 'New playbook generated' } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[API] handleTriggerEvolution error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger evolution' },
      { status: 500 }
    );
  }
}

/**
 * Handle rollback action
 * Rollback to a specific version
 */
async function handleRollback(
  store: any,
  redis: any,
  versionId: string
): Promise<NextResponse> {
  try {
    const manager = new RollbackManager(store, redis);
    const result = await manager.rollbackToVersion(versionId);

    if (result.isErr()) {
      const error = result.getError();
      const errorMsg = error?.message ?? 'Unknown error';

      // Check for 404 Not Found error
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        return NextResponse.json(
          { error: `Version not found: ${versionId}` },
          { status: 400 }
        );
      }

      logger.error('[API] handleRollback error:', errorMsg);
      return NextResponse.json(
        { error: errorMsg },
        { status: 400 }
      );
    }

    const playbook = result.unwrap();
    return NextResponse.json({
      action: 'rollback_completed',
      playbook,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[API] handleRollback error:', error);
    return NextResponse.json(
      { error: 'Failed to rollback playbook' },
      { status: 500 }
    );
  }
}
