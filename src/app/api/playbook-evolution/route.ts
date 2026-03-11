import { NextRequest, NextResponse } from 'next/server';
import {
  listOperationLedger,
  listPlaybooks,
  getPlaybook,
  upsertPlaybook,
} from '@/core/playbook-system/store';

export const dynamic = 'force-dynamic';

const INSTANCE_ID = process.env.SENTINAI_INSTANCE_ID ?? 'default';

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;
  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return headerKey === apiKey;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'status';

  try {
    if (action === 'playbooks') {
      const playbooks = await listPlaybooks(INSTANCE_ID);
      return NextResponse.json({ playbooks });
    }

    if (action === 'ledger') {
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '10', 10));
      const { records, total } = await listOperationLedger(INSTANCE_ID, { limit });
      return NextResponse.json({ records, total });
    }

    // default: status
    const { records, total } = await listOperationLedger(INSTANCE_ID, { limit: 1 });
    const lastRecord = records[0] ?? null;
    const playbooks = await listPlaybooks(INSTANCE_ID);
    const needsReview = playbooks.filter(p => p.reviewStatus === 'draft' || p.reviewStatus === 'pending').length;

    return NextResponse.json({
      instanceId: INSTANCE_ID,
      ledger: { total, lastTimestamp: lastRecord?.timestamp ?? null },
      playbooks: { total: playbooks.length, needsReview },
      scheduler: { nextCron: '00:05 UTC (daily)' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const playbookId = url.searchParams.get('id');

  try {
    if (action === 'mine') {
      const { listOperationLedger: listLedger, upsertPlaybook: upsert, listPlaybooks: list } =
        await import('@/core/playbook-system/store');
      const { analyzeIncidentPatterns } = await import('@/core/playbook-system/incident-analyzer');
      const { generatePlaybookFromPattern, mergePatternIntoPlaybook } =
        await import('@/core/playbook-system/playbook-generator');
      const { validatePlaybookShape } = await import('@/core/playbook-system/playbook-validation');

      const { records } = await listLedger(INSTANCE_ID, { limit: 200 });
      const patterns = analyzeIncidentPatterns(records, { minOccurrences: 3, windowDays: 30 });
      const existing = await list(INSTANCE_ID);
      const saved: string[] = [];
      const skipped: string[] = [];

      for (const pattern of patterns) {
        const candidate = existing.find(
          p => p.triggerSignature === pattern.triggerSignature && p.action === pattern.action
        );
        const next = candidate
          ? mergePatternIntoPlaybook({ playbook: candidate, pattern })
          : generatePlaybookFromPattern({ instanceId: INSTANCE_ID, pattern });
        const validation = validatePlaybookShape(next);
        if (!validation.valid) { skipped.push(next.playbookId); continue; }
        await upsert(INSTANCE_ID, next);
        saved.push(next.playbookId);
      }

      return NextResponse.json({ patterns: patterns.length, saved, skipped });
    }

    if ((action === 'approve' || action === 'promote' || action === 'suspend') && playbookId) {
      const playbook = await getPlaybook(INSTANCE_ID, playbookId);
      if (!playbook) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const nextStatus =
        action === 'approve' ? 'approved' as const :
        action === 'promote' ? 'trusted' as const :
        'suspended' as const;

      const updated = {
        ...playbook,
        reviewStatus: nextStatus,
        evolution: {
          version: playbook.evolution.version + 1,
          changelog: [
            ...playbook.evolution.changelog,
            {
              version: playbook.evolution.version + 1,
              timestamp: new Date().toISOString(),
              reason: `${action === 'approve' ? 'Approved' : action === 'promote' ? 'Promoted to trusted' : 'Suspended'} by operator`,
              confidenceDelta: 0,
              changedBy: 'operator' as const,
            },
          ],
        },
      };
      await upsertPlaybook(INSTANCE_ID, updated);
      return NextResponse.json({ playbook: updated });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
