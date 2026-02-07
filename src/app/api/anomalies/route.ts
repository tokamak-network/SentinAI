/**
 * Anomalies API
 * GET: 이상 이벤트 목록 조회
 */

import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/anomaly-event-store';
import type { AnomaliesResponse } from '@/types/anomaly';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<AnomaliesResponse>> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // 유효성 검증
  const validLimit = Math.min(Math.max(1, limit), 100);
  const validOffset = Math.max(0, offset);

  const result = getEvents(validLimit, validOffset);

  return NextResponse.json({
    events: result.events,
    total: result.total,
    activeCount: result.activeCount,
  });
}
