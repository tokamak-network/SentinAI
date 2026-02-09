/**
 * Cost Report API
 * GET /api/cost-report - 비용 분석 리포트 생성
 */

import { NextResponse } from 'next/server';
import { generateCostReport } from '@/lib/cost-optimizer';

// 동적 라우트로 설정 (캐싱 비활성화)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');

    // 기본값 7일, 최대 30일
    let days = 7;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        days = Math.min(parsed, 30);
      }
    }

    console.log(`[Cost Report API] Generating report for ${days} days`);
    const startTime = Date.now();

    const report = await generateCostReport(days);

    console.log(`[Cost Report API] Report generated in ${Date.now() - startTime}ms`);

    return NextResponse.json(report, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cost Report API] Error:', errorMessage);

    return NextResponse.json(
      {
        error: 'Failed to generate cost report',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
