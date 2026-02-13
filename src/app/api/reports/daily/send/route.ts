/**
 * Manual Daily Report Delivery Endpoint
 * Allows triggering report delivery via HTTP (for testing or manual override)
 */

import { NextResponse } from 'next/server';
import { triggerDailyReportDelivery } from '@/lib/daily-report-mailer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/reports/daily/send
 * Trigger manual delivery of daily report
 *
 * Request body (optional):
 * {
 *   "date": "2026-02-12"  // YYYY-MM-DD format (defaults to yesterday)
 * }
 *
 * Response:
 * {
 *   "success": true|false,
 *   "method": "slack",
 *   "webhookUrl": "https://hooks.slack.com/services/T***",
 *   "error": "error message if failed",
 *   "date": "2026-02-12"
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dateStr = body.date as string | undefined;

    // Validate date format if provided
    if (dateStr) {
      // Check YYYY-MM-DD format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-02-12)',
          },
          { status: 400 }
        );
      }

      // Check if it's a valid date
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid date. Please provide a valid calendar date.',
          },
          { status: 400 }
        );
      }
    }

    // Trigger delivery
    const result = await triggerDailyReportDelivery(dateStr);

    // Return result with date info
    const responseData = {
      ...result,
      date: dateStr || new Date(new Date().getTime() - 86400000).toISOString().split('T')[0],
    };

    // Return 200 for both success and failure (consistent with API design)
    // Client should check result.success field
    return NextResponse.json(responseData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/reports/daily/send] Error:', message);

    return NextResponse.json(
      {
        success: false,
        error: `Internal server error: ${message}`,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/reports/daily/send
 * Display usage instructions
 */
export async function GET() {
  return NextResponse.json(
    {
      message: 'Use POST request to trigger daily report delivery',
      endpoint: 'POST /api/reports/daily/send',
      requestBody: {
        date: '2026-02-12 (optional, YYYY-MM-DD format, defaults to yesterday)',
      },
      examples: {
        'Deliver yesterday report': 'curl -X POST http://localhost:3002/api/reports/daily/send',
        'Deliver specific date': 'curl -X POST http://localhost:3002/api/reports/daily/send -H "Content-Type: application/json" -d \'{"date":"2026-02-12"}\'',
      },
    },
    { status: 200 }
  );
}
