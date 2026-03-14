/**
 * Test API: Get operation records
 * GET: Retrieve recorded operation records
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Mock storage for operation records
const operationRecords: Record<string, unknown>[] = [];

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const anomalyType = url.searchParams.get('anomalyType');

    let records = operationRecords;
    if (anomalyType) {
      records = records.filter(
        (r: Record<string, unknown>) => r.anomalyType === anomalyType
      );
    }

    return NextResponse.json({
      count: records.length,
      records,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to retrieve records', details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const record = {
      id: `record-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      ...body,
    };

    operationRecords.push(record);

    return NextResponse.json({
      success: true,
      record,
      totalRecords: operationRecords.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to record operation', details: message },
      { status: 500 }
    );
  }
}
