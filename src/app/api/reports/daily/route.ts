/**
 * Daily Report API Endpoint
 * GET: Query accumulator status, list reports, or read a specific report
 * POST: Generate a daily report
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAccumulatedData, getAccumulatorStatus, initializeAccumulator, takeSnapshot } from '@/lib/daily-accumulator';
import { generateDailyReport, readExistingReport, listReports } from '@/lib/daily-report-generator';
import type { DailyReportRequest } from '@/types/daily-report';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * GET /api/reports/daily
 * Query params:
 *   status=true  → accumulator status
 *   list=true    → report file list
 *   date=YYYY-MM-DD → read specific report
 *   (none)       → accumulator status + recent 7 reports
 */
export async function GET(request: NextRequest) {
  try {
    // Ensure accumulator is initialized in this module scope
    initializeAccumulator();

    const { searchParams } = new URL(request.url);

    // Status mode
    if (searchParams.get('status') === 'true') {
      return NextResponse.json({
        success: true,
        data: getAccumulatorStatus(),
      });
    }

    // List mode
    if (searchParams.get('list') === 'true') {
      const reports = await listReports();
      return NextResponse.json({
        success: true,
        data: { reports },
      });
    }

    // Read specific report
    const date = searchParams.get('date');
    if (date) {
      if (!DATE_REGEX.test(date)) {
        return NextResponse.json(
          { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' },
          { status: 400 }
        );
      }

      const content = await readExistingReport(date);
      if (!content) {
        return NextResponse.json(
          { success: false, error: `No report found for ${date}` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: { date, content },
      });
    }

    // Default: status + recent reports
    const reports = await listReports();
    return NextResponse.json({
      success: true,
      data: {
        accumulator: getAccumulatorStatus(),
        recentReports: reports.slice(0, 7),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/reports/daily error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reports/daily
 * Body: { date?, force?, debug? }
 */
export async function POST(request: NextRequest) {
  try {
    // Ensure accumulator is initialized and take a fresh snapshot
    initializeAccumulator();
    await takeSnapshot();

    const body: DailyReportRequest = await request.json().catch(() => ({}));
    const targetDate = body.date || getTodayKST();

    // Validate date format
    if (!DATE_REGEX.test(targetDate)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    // Get accumulated data
    const data = getAccumulatedData(targetDate);
    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: `No accumulated data for ${targetDate}. Data is only available for today (in-memory).`,
        },
        { status: 400 }
      );
    }

    // Generate report
    const result = await generateDailyReport(data, {
      force: body.force,
      debug: body.debug,
    });

    const statusCode = result.success ? 200 : 500;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('POST /api/reports/daily error:', message);
    return NextResponse.json(
      {
        success: false,
        error: message,
        metadata: {
          date: '',
          generatedAt: new Date().toISOString(),
          dataCompleteness: 0,
          snapshotCount: 0,
          processingTimeMs: 0,
        },
      },
      { status: 500 }
    );
  }
}
