/**
 * Goal Planner API
 * GET /api/goals                - List goal plans
 * GET /api/goals?planId=<id>    - Get single plan
 * POST /api/goals               - Build or execute goal plan
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoalPlan,
  executeGoalPlan,
  getGoalPlanById,
  getGoalPlanHistory,
  saveGoalPlan,
} from '@/lib/goal-planner';

export const dynamic = 'force-dynamic';

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '20', 10);
  if (Number.isNaN(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 100);
}

function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get('planId');
    if (planId) {
      const plan = getGoalPlanById(planId);
      if (!plan) {
        return NextResponse.json({ error: 'Goal plan not found' }, { status: 404 });
      }
      return NextResponse.json({ plan });
    }

    const limit = parseLimit(searchParams.get('limit'));
    return NextResponse.json({
      plans: getGoalPlanHistory(limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      return NextResponse.json({ error: 'goal is required' }, { status: 400 });
    }

    const autoExecute = body.autoExecute === true;
    const dryRun = body.dryRun !== false;
    const allowWrites = body.allowWrites === true;

    if (autoExecute && allowWrites && isReadOnlyMode()) {
      return NextResponse.json(
        { error: 'Write execution is blocked in read-only mode' },
        { status: 403 }
      );
    }

    const plan = buildGoalPlan(goal, dryRun);

    if (!autoExecute) {
      return NextResponse.json({
        plan: saveGoalPlan(plan),
        executionLog: [],
      });
    }

    const result = await executeGoalPlan(plan, {
      dryRun,
      allowWrites,
      initiatedBy: 'api',
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

