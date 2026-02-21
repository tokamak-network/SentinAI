/**
 * Savings Advisor API
 * GET /api/savings-advisor - Generate Savings Plans commitment advice
 */

import { NextResponse } from 'next/server';
import { generateSavingsAdvice } from '@/lib/savings-advisor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');
    const customCommitParam = url.searchParams.get('customCommitVcpu');

    let days = 30;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        days = Math.min(parsed, 90);
      }
    }

    const advice = await generateSavingsAdvice(days);
    if (!advice) {
      return NextResponse.json({
        success: false,
        message: 'Insufficient usage data to generate savings advice. Please collect at least 30 days of data.',
      }, { status: 200 });
    }

    const customCommitVcpu = customCommitParam ? parseFloat(customCommitParam) : null;
    if (customCommitVcpu && customCommitVcpu > 0) {
      // Custom option support can be extended later.
      return NextResponse.json({
        ...advice,
        note: `customCommitVcpu=${customCommitVcpu} will be supported as an extended simulation option in a future step.`,
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    return NextResponse.json(advice, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate savings advice', message },
      { status: 500 }
    );
  }
}
