import { NextRequest, NextResponse } from 'next/server';
import { getBatchSubmissionStatus, verifyPaymentHeader } from '@/lib/agent-marketplace';

/**
 * GET /api/agent-marketplace/batch-submission-status
 * Returns batch submission status data
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

    const status = getBatchSubmissionStatus();
    return NextResponse.json(status, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // 1 minute cache
      },
    });
  } catch (error) {
    console.error('[Marketplace API] Batch submission status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch submission status' },
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
