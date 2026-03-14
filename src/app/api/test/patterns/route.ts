/**
 * Test API: Get extracted patterns
 * GET: Retrieve patterns extracted from operation records
 */

import { NextResponse } from 'next/server';
import { PatternMiner } from '@/lib/pattern-miner';
import type { OperationRecord } from '@/lib/playbook-evolution-types';

export const dynamic = 'force-dynamic';

// Mock storage for operation records (shared with /test/records)
const operationRecords: OperationRecord[] = [];

export async function GET(request: Request) {
  try {
    const miner = new PatternMiner();
    const patterns = await miner.analyzeAndMine(operationRecords);

    return NextResponse.json({
      patterns,
      totalRecordsAnalyzed: operationRecords.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to extract patterns', details: message },
      { status: 500 }
    );
  }
}
