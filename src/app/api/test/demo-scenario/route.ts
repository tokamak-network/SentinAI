/**
 * Test API: Demo scenario for playbook evolution demonstration.
 *
 * POST /api/test/demo-scenario  (requires x-api-key header)
 *   Body (optional JSON): { scenario: "simulate" }
 *   - Adds 10 success records for the memoryPercent/z-score/scale_up pattern
 *   - Runs inline pattern mining
 *   - Returns the before/after diff for the targeted playbook
 *
 * CAUTION: Dev/test only. Protected by NODE_ENV guard + API key via middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendOperationRecord, listOperationLedger, listPlaybooks, upsertPlaybook } from '@/playbooks/learning/store';
import type { OperationRecord } from '@/playbooks/learning/types';

export const dynamic = 'force-dynamic';

const INSTANCE_ID = process.env.SENTINAI_INSTANCE_ID ?? 'default';

/** Reject in production unless SENTINAI_ALLOW_TEST_ROUTES=true is explicitly set */
function testRouteGuard(): NextResponse | null {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SENTINAI_ALLOW_TEST_ROUTES !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}

// Target pattern for the demo evolution scenario
const DEMO_PATTERN = {
  metricName: 'memoryPercent',
  anomalyType: 'z-score',
  action: 'scale_up',
  metricValue: 90,
  zScore: 3.5,
  count: 10,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = testRouteGuard();
  if (guard) return guard;

  let body: { scenario?: string } = {};
  try { body = (await request.json()) as { scenario?: string }; } catch { /* ok */ }

  const scenario = body.scenario;

  if (scenario !== 'simulate') {
    return NextResponse.json(
      { error: 'Unknown scenario. Use { "scenario": "simulate" }' },
      { status: 400 }
    );
  }

  try {
    // Step 1: Find the current playbook state (before)
    const existingPlaybooks = await listPlaybooks(INSTANCE_ID);
    const targetBefore = existingPlaybooks.find(
      p =>
        p.triggerSignature.includes(DEMO_PATTERN.metricName) &&
        p.triggerSignature.includes(DEMO_PATTERN.anomalyType) &&
        p.action === DEMO_PATTERN.action
    ) ?? null;

    // Step 2: Seed 10 success records for the target pattern
    const now = Date.now();
    for (let i = 0; i < DEMO_PATTERN.count; i++) {
      // Spread timestamps over the past 2 days (recent, within 30-day window)
      const tsMs = now - i * 4 * 60 * 60 * 1000; // 4h apart
      const record: OperationRecord = {
        operationId: `demo-${tsMs}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: INSTANCE_ID,
        timestamp: new Date(tsMs).toISOString(),
        trigger: {
          anomalyType: DEMO_PATTERN.anomalyType,
          metricName: DEMO_PATTERN.metricName,
          zScore: DEMO_PATTERN.zScore,
          metricValue: DEMO_PATTERN.metricValue,
        },
        playbookId: targetBefore?.playbookId ?? null,
        action: DEMO_PATTERN.action,
        outcome: 'success',
        resolutionMs: 1200 + Math.round(Math.random() * 600),
        verificationPassed: true,
      };
      await appendOperationRecord(INSTANCE_ID, record);
    }

    // Step 3: Run pattern mining inline
    const { analyzeIncidentPatterns } = await import('@/playbooks/learning/incident-analyzer');
    const { generatePlaybookFromPattern, mergePatternIntoPlaybook } = await import('@/playbooks/learning/playbook-generator');
    const { validatePlaybookShape } = await import('@/playbooks/learning/playbook-validation');

    const { records } = await listOperationLedger(INSTANCE_ID, { limit: 500 });
    const patterns = analyzeIncidentPatterns(records, { minOccurrences: 3, windowDays: 30 });

    const current = await listPlaybooks(INSTANCE_ID);
    let targetPlaybookId: string | null = null;

    for (const pattern of patterns) {
      const candidate = current.find(
        p => p.triggerSignature === pattern.triggerSignature && p.action === pattern.action
      );
      const next = candidate
        ? mergePatternIntoPlaybook({ playbook: candidate, pattern })
        : generatePlaybookFromPattern({ instanceId: INSTANCE_ID, pattern });
      const validation = validatePlaybookShape(next);
      if (!validation.valid) continue;
      await upsertPlaybook(INSTANCE_ID, next);

      // Track the target playbook
      if (
        pattern.triggerSignature.includes(DEMO_PATTERN.metricName) &&
        pattern.triggerSignature.includes(DEMO_PATTERN.anomalyType) &&
        pattern.action === DEMO_PATTERN.action
      ) {
        targetPlaybookId = next.playbookId;
      }
    }

    // Step 4: Fetch the after state
    const afterPlaybooks = await listPlaybooks(INSTANCE_ID);
    const targetAfter = targetPlaybookId
      ? (afterPlaybooks.find(p => p.playbookId === targetPlaybookId) ?? null)
      : null;

    return NextResponse.json({
      ok: true,
      seeded: DEMO_PATTERN.count,
      patternsFound: patterns.length,
      targetPlaybookId,
      diff: targetBefore && targetAfter
        ? {
            id: targetPlaybookId,
            versionBefore: targetBefore.evolution.version,
            versionAfter: targetAfter.evolution.version,
            confidenceBefore: Math.round(targetBefore.confidence * 100),
            confidenceAfter: Math.round(targetAfter.confidence * 100),
            statusBefore: targetBefore.reviewStatus,
            statusAfter: targetAfter.reviewStatus,
          }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
