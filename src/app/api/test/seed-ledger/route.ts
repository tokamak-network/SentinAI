/**
 * Test API: Seed operation ledger with synthetic records for Evolved Playbooks testing.
 *
 * GET /api/test/seed-ledger?seed=true[&count=5][&metricName=txPoolPending][&action=restart_pod]
 *   - seed=true  → inject records (no auth needed — GET bypasses middleware API key guard)
 *   - seed omitted → show current ledger record count only
 *
 * POST /api/test/seed-ledger  (requires x-api-key header)
 *   Body (optional JSON): count, metricName, action, outcome, metricValue, zScore, anomalyType
 *
 * Defaults match the actual production record format observed in the ledger:
 *   anomalyType: "monotonic", metricName: "txPoolPending", zScore: 0, metricValue: 4400,
 *   action: "restart_pod", outcome: "success"
 *
 * CAUTION: Dev/test only. Remove this endpoint before exposing to untrusted networks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendOperationRecord, listOperationLedger } from '@/core/playbook-system/store';
import type { LedgerOutcome, OperationRecord } from '@/core/playbook-system/types';

export const dynamic = 'force-dynamic';

const INSTANCE_ID = process.env.SENTINAI_INSTANCE_ID ?? 'default';

async function seedRecords(params: {
  count: number;
  metricName: string;
  action: string;
  outcome: LedgerOutcome;
  metricValue: number;
  zScore: number;
  anomalyType: string;
}): Promise<{ inserted: number; ids: string[]; ledgerTotal: number }> {
  const { count, metricName, action, outcome, metricValue, zScore, anomalyType } = params;
  const now = Date.now();
  const inserted: string[] = [];

  for (let i = 0; i < count; i++) {
    // Spread timestamps over past 7 days so windowDays=30 check passes
    const tsMs = now - i * 24 * 60 * 60 * 1000;
    const record: OperationRecord = {
      operationId: `seed-${tsMs}-${Math.random().toString(36).slice(2, 8)}`,
      instanceId: INSTANCE_ID,
      timestamp: new Date(tsMs).toISOString(),
      trigger: { anomalyType, metricName, zScore, metricValue },
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
  return { inserted: inserted.length, ids: inserted, ledgerTotal: total };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);

  // Status-only (no seed param)
  if (!url.searchParams.has('seed') || url.searchParams.get('seed') !== 'true') {
    const { total } = await listOperationLedger(INSTANCE_ID, { limit: 1 });
    return NextResponse.json({ instanceId: INSTANCE_ID, ledgerTotal: total });
  }

  // Seed via GET (bypasses middleware API key guard — useful for quick testing)
  const result = await seedRecords({
    count:       Math.min(Number(url.searchParams.get('count') ?? 5), 50),
    metricName:  url.searchParams.get('metricName')  ?? 'txPoolPending',
    action:      url.searchParams.get('action')      ?? 'restart_pod',
    outcome:     (url.searchParams.get('outcome')    ?? 'success') as LedgerOutcome,
    metricValue: Number(url.searchParams.get('metricValue') ?? 4400),
    zScore:      Number(url.searchParams.get('zScore')      ?? 0),
    anomalyType: url.searchParams.get('anomalyType') ?? 'monotonic',
  });

  return NextResponse.json({
    ok: true,
    ...result,
    hint: `Now call POST /api/playbook-evolution?action=mine (with x-api-key) to mine patterns.`,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* ok */ }

  const result = await seedRecords({
    count:       Math.min(Number(body.count ?? 5), 50),
    metricName:  String(body.metricName  ?? 'txPoolPending'),
    action:      String(body.action      ?? 'restart_pod'),
    outcome:     (body.outcome ?? 'success') as LedgerOutcome,
    metricValue: Number(body.metricValue ?? 4400),
    zScore:      Number(body.zScore      ?? 0),
    anomalyType: String(body.anomalyType ?? 'monotonic'),
  });

  return NextResponse.json({
    ok: true,
    ...result,
    hint: `Now call POST /api/playbook-evolution?action=mine (with x-api-key) to mine patterns.`,
  });
}
