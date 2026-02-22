/**
 * Runtime Autonomy Policy API
 * GET /api/policy/autonomy-level
 * POST /api/policy/autonomy-level
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeAutonomyPolicy,
  setRuntimeAutonomyPolicy,
} from '@/lib/autonomy-policy';
import type { AutonomyLevel } from '@/types/policy';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const configured = process.env.SENTINAI_API_KEY?.trim();
  if (!configured) return false;
  const provided = request.headers.get('x-api-key')?.trim();
  return !!provided && provided === configured;
}

function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 'A0' || value === 'A1' || value === 'A2' || value === 'A3' || value === 'A4' || value === 'A5';
}

export async function GET() {
  return NextResponse.json({
    policy: getRuntimeAutonomyPolicy(),
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: policy update requires admin x-api-key' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const updates: Parameters<typeof setRuntimeAutonomyPolicy>[0] = {};

    if (isAutonomyLevel(body?.level)) {
      updates.level = body.level;
    }
    if (typeof body?.minConfidenceDryRun === 'number') {
      updates.minConfidenceDryRun = body.minConfidenceDryRun;
    }
    if (typeof body?.minConfidenceWrite === 'number') {
      updates.minConfidenceWrite = body.minConfidenceWrite;
    }

    const policy = setRuntimeAutonomyPolicy(updates);
    return NextResponse.json({ success: true, policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
