import { NextRequest, NextResponse } from 'next/server';
import { getIncidentSummary, verifyPaymentHeader } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/incident-summary
 * Returns incident summary data
 * Requires x-payment header (paid endpoint)
 * Returns 402 Payment Required without valid payment
 */
export async function GET(request: NextRequest) {
  try {
    const paymentHeader = request.headers.get('x-payment') ?? undefined;

    if (!verifyPaymentHeader(paymentHeader)) {
      return NextResponse.json(
        {
          error: 'Payment Required',
          message: 'This endpoint requires a valid payment header',
        },
        { status: 402 }
      );
    }

    const summary = getIncidentSummary();
    return NextResponse.json(summary, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('[Marketplace API] Incident summary error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch incident summary' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-payment',
    },
  });
}
