/**
 * Test API: Seed operation ledger with synthetic records for Evolved Playbooks testing.
 *
 * POST /api/test/seed-ledger
 *   Body (optional JSON):
 *     count        - number of records to inject (default: 5)
 *     metricName   - metric name (default: 'txPoolPending')
 *     action       - remediation action (default: 'restart_pod')
 *     outcome      - 'success' | 'failure' | 'partial' (default: 'success')
 *     metricValue  - numeric metric reading (default: 4400)
 *     zScore       - z-score value (default: 3.5)
 *
 * GET /api/test/seed-ledger   → shows current ledger record count
 *
 * CAUTION: Dev/test only. Not guarded in prod — do not expose publicly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendOperationRecord, listOperationLedger } from '@/core/playbook-system/store';
import type { LedgerOutcome, OperationRecord } from '@/core/playbook-system/types';

export const dynamic = 'force-dynamic';

const INSTANCE_ID = process.env.SENTINAI_INSTANCE_ID ?? 'default';

export async function GET(): Promise<NextResponse> {
  const { total } = await listOperationLedger(INSTANCE_ID, { limit: 1 });
  return NextResponse.json({ instanceId: INSTANCE_ID, total });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch { /* empty body is fine */ }

  const count     = Math.min(Number(body.count ?? 5), 50);
  const metricName  = String(body.metricName  ?? 'txPoolPending');
  const action      = String(body.action      ?? 'restart_pod');
  const outcome     = (body.outcome ?? 'success') as LedgerOutcome;
  const metricValue = Number(body.metricValue ?? 4400);
  const zScore      = Number(body.zScore      ?? 3.5);

  const now = Date.now();
  const inserted: string[] = [];

  for (let i = 0; i < count; i++) {
    // Spread timestamps over the past 7 days so windowDays=30 check passes
    const tsMs = now - i * 24 * 60 * 60 * 1000;
    const record: OperationRecord = {
      operationId: `seed-${tsMs}-${Math.random().toString(36).slice(2, 8)}`,
      instanceId: INSTANCE_ID,
      timestamp: new Date(tsMs).toISOString(),
      trigger: {
        anomalyType: 'z-score',
        metricName,
        zScore,
        metricValue,
      },
      playbookId: null,
      action,
      outcome,
      resolutionMs: 800 + Math.round(Math.random() * 400),
      verificationPassed: outcome === 'success',
    };
    await appendOperationRecord(INSTANCE_ID, record);
    inserted.push(record.operationId);
  }

  const { total } = await listOperationLedger(INSTANCE_ID, { limit: 1 });

  return NextResponse.json({
    ok: true,
    inserted: inserted.length,
    ids: inserted,
    ledgerTotal: total,
    hint: `Run POST /api/playbook-evolution?action=mine to mine patterns now.`,
  });
}
