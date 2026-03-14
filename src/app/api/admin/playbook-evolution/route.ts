/**
 * Admin Playbook Evolution API
 * GET: Return current playbook and history
 * POST: Trigger evolution or rollback
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ABTestController } from '@/lib/ab-test-controller';
import { PatternMiner } from '@/lib/pattern-miner';
import { PlaybookEvolver } from '@/lib/playbook-evolver';
import { RollbackManager } from '@/lib/rollback-manager';
import type { OperationRecord } from '@/lib/playbook-evolution-types';

export const dynamic = 'force-dynamic';

// Singleton instances
const rollbackManager = new RollbackManager();
const patternMiner = new PatternMiner();
const playbookEvolver = new PlaybookEvolver();
const abTestController = new ABTestController();

// Mock data storage
const operationRecords: OperationRecord[] = [];
const abSessions = new Map<string, ReturnType<typeof abTestController.getSession>>();

function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer') return false;

  const expectedKey = process.env.SENTINAI_API_KEY || 'test-key';
  return token === expectedKey;
}

export async function GET(request: NextRequest) {
  try {
    const state = rollbackManager.getState();
    return NextResponse.json({
      current: state.current,
      history: state.history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to retrieve playbook state', details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Authenticate
  if (!validateApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    if (action === 'trigger_evolution') {
      // Analyze patterns from operation records
      const patterns = await patternMiner.analyzeAndMine(operationRecords);

      // Generate evolved playbook
      const evolved = await playbookEvolver.generateFromPatterns(patterns);

      return NextResponse.json({
        action: 'evolution_triggered',
        patterns,
        evolved,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'trigger_ab_test') {
      const current = rollbackManager.getCurrentVersion();
      const evolved = body.evolved as Record<string, unknown>;
      const sessionId = body.sessionId as string || `session-${Date.now()}`;

      const session = abTestController.createSession(
        sessionId,
        current.versionId,
        (evolved?.versionId as string) || `v-${Date.now()}`
      );

      abSessions.set(sessionId, session);

      return NextResponse.json({
        action: 'ab_test_started',
        session,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'complete_ab_test') {
      const sessionId = body.sessionId as string;
      const session = abTestController.getSession(sessionId);

      if (!session) {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 400 }
        );
      }

      // Analyze results
      const analysis = abTestController.analyzeSession(sessionId);

      // Determine winner based on success rates
      const controlSuccessRate = session.stats.controlExecutions > 0
        ? session.stats.controlSuccesses / session.stats.controlExecutions
        : 0;

      const testSuccessRate = session.stats.testExecutions > 0
        ? session.stats.testSuccesses / session.stats.testExecutions
        : 0;

      const winner = testSuccessRate > controlSuccessRate ? 'test' : 'control';
      const isSignificant = analysis.significant && testSuccessRate > 0.85;

      abTestController.completeSession(sessionId, winner as 'control' | 'test');

      if (isSignificant && winner === 'test') {
        // Promote test version
        const testVersion = {
          versionId: session.testVersionId,
          generatedBy: 'ab-test-promotion',
          generatedAt: new Date().toISOString(),
          source: 'ai-assisted' as const,
          confidence: Math.min(0.99, testSuccessRate),
          successRate: testSuccessRate,
          totalApplications: session.stats.testExecutions,
          playbook: { id: session.testVersionId, name: 'Promoted Test Version' },
        };
        rollbackManager.promoteVersion(testVersion);
      }

      return NextResponse.json({
        action: 'ab_test_completed',
        session,
        decision: isSignificant ? 'promote' : 'control',
        winner,
        analysis,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'rollback') {
      const versionId = body.versionId as string;
      const success = rollbackManager.rollbackTo(versionId);

      if (!success) {
        return NextResponse.json(
          { error: 'Version not found' },
          { status: 400 }
        );
      }

      const current = rollbackManager.getCurrentVersion();
      return NextResponse.json({
        action: 'rollback_completed',
        current,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process request', details: message },
      { status: 500 }
    );
  }
}

// Test routes for E2E testing
export async function PUT(request: NextRequest) {
  // For test data recording
  if (!validateApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;

    if (body.recordOperation) {
      const record = body.recordOperation as OperationRecord;
      operationRecords.push(record);

      return NextResponse.json({
        success: true,
        totalRecords: operationRecords.length,
      });
    }

    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process request', details: message },
      { status: 500 }
    );
  }
}
