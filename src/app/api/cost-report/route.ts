/**
 * Cost Report API
 * GET /api/cost-report - Generate cost analysis report
 */

import { NextResponse } from 'next/server';
import { generateCostReport } from '@/lib/cost-optimizer';

// Set as dynamic route (disable caching)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');

    // Default 7 days, max 30 days
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
