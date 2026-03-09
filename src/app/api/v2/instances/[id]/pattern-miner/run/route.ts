import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { analyzeIncidentPatterns } from '@/core/playbook-system/incident-analyzer';
import { generatePlaybookFromPattern, mergePatternIntoPlaybook } from '@/core/playbook-system/playbook-generator';
import { selectTemplateForPattern } from '@/core/playbook-system/template-system';
import { validatePlaybookShape } from '@/core/playbook-system/playbook-validation';
import { listOperationLedger, listPlaybooks, upsertPlaybook } from '@/core/playbook-system/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;
  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return headerKey === apiKey;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json({ error: 'Authentication failed.', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  const instance = await getInstance(id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const { records } = await listOperationLedger(id, { limit: 200, offset: 0 });
  const patterns = analyzeIncidentPatterns(records, { minOccurrences: 3, windowDays: 30 });
  const existing = await listPlaybooks(id);

  const saved: string[] = [];
  const skipped: string[] = [];

  for (const pattern of patterns) {
    const candidate = existing.find(
      (p) => p.triggerSignature === pattern.triggerSignature && p.action === pattern.action
    );

    const nextPlaybook = candidate
      ? mergePatternIntoPlaybook({ playbook: candidate, pattern })
      : generatePlaybookFromPattern({ instanceId: id, pattern });

    // template selection currently used for metadata scoring/observability hook
    selectTemplateForPattern(pattern);

    const validation = validatePlaybookShape(nextPlaybook);
    if (!validation.valid) {
      skipped.push(`${nextPlaybook.playbookId}: invalid shape`);
      continue;
    }

    await upsertPlaybook(id, nextPlaybook);
    saved.push(nextPlaybook.playbookId);
  }

  return NextResponse.json({
    data: {
      instanceId: id,
      patterns: patterns.length,
      saved,
      skipped,
    },
    meta: meta(),
  });
}
