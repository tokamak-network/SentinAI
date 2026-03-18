# Playbook Evolution Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "PLAYBOOKS" tab to the Operations right panel showing the Proposal 32 learning loop: ledger status, evolved playbook review cards, and recent execution history — all in Bloomberg Terminal style.

**Architecture:** New `PlaybooksTab` component fetches data via a dedicated `/api/playbook-evolution` route that reads directly from the playbook-system store (bypassing the v2 instance registry which requires explicit instance creation). `OperationsPanel` gains a 2-tab bar (OPS | PLAYBOOKS ●). Badge count from ticker shows review-needed count.

**Tech Stack:** React (inline style, IBM Plex Mono), Next.js API route, `@/core/playbook-system/store`, `@/core/playbook-system/incident-analyzer`

---

## Chunk 1: API Route

### Task 1: `/api/playbook-evolution` route

**Files:**
- Create: `src/app/api/playbook-evolution/route.ts`

This route bypasses the instance registry and reads directly from the store.
Exposes 4 operations via query param `action`:
- `GET ?action=status` → ledger count + last record timestamp + scheduler next-run info
- `GET ?action=playbooks` → evolved playbook list
- `GET ?action=ledger&limit=10` → recent operation records
- `POST ?action=mine` → trigger PatternMiner manually
- `POST ?action=approve&id=<playbookId>` → approve playbook
- `POST ?action=promote&id=<playbookId>` → promote to trusted
- `POST ?action=suspend&id=<playbookId>` → suspend playbook

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/playbook-evolution/route.ts
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
```

- [ ] **Step 2: Verify route compiles**

```bash
npx tsc --noEmit 2>&1 | grep playbook-evolution
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/playbook-evolution/route.ts
git commit -m "feat(playbook-evolution): add /api/playbook-evolution route"
```

---

## Chunk 2: PlaybooksTab Component

### Task 2: PlaybooksTab component

**Files:**
- Create: `src/components/playbooks-tab.tsx`

Key design decisions:
- Self-contained: fetches its own data (no props drilling through page.tsx)
- Polls every 60s when tab is visible
- Human-readable labels: parse `triggerSignature` + `action` strings
- 3 sections: loop status bar → playbook cards → ledger table

#### `triggerSignature` parsing

Format: `"threshold|tx_pool_pending|z:3.5|v:1000"`

```typescript
// Human-readable label helpers
function metricLabel(metricName: string): string {
  const MAP: Record<string, string> = {
    tx_pool_pending: 'TxPool pending',
    tx_pool_count: 'TxPool count',
    l1_sync_lag: 'L1 sync lag',
    gas_price: 'Gas price',
    cpu_usage: 'CPU usage',
    block_height: 'Block height',
    memory_usage: 'Memory usage',
    peer_count: 'Peer count',
  };
  return MAP[metricName] ?? metricName.replace(/_/g, ' ');
}

function anomalyLabel(type: string): string {
  const MAP: Record<string, string> = {
    threshold: '>', 'z-score': '↑', monotonic: '↑↑', plateau: '—', 'zero-drop': '→0',
  };
  return MAP[type] ?? '>';
}

function parseTriggerSignature(sig: string): { when: string; detail: string } {
  const parts = sig.split('|');
  const [anomalyType, metricName, , vPart] = parts;
  const value = vPart?.replace('v:', '') ?? '';
  const metric = metricLabel(metricName ?? '');
  const op = anomalyLabel(anomalyType ?? '');
  const when = value && value !== '0' ? `${metric} ${op} ${value}` : metric;
  return { when, detail: anomalyType ?? '' };
}

function actionLabel(action: string): string {
  const MAP: Record<string, string> = {
    'restart-batcher': 'Restart batcher',
    'restart-proposer': 'Restart proposer',
    'restart-component': 'Restart component',
    'switch-l1-rpc': 'Switch L1 RPC',
    'scale-up': 'Scale up resources',
    'refill-eoa': 'Refill EOA wallet',
    unknown: 'Unknown action',
  };
  return MAP[action] ?? action.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
```

- [ ] **Step 1: Create `src/components/playbooks-tab.tsx`**

Full component (see below — inline style matching Bloomberg Terminal theme):

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import type { EvolvedPlaybook, OperationRecord } from '@/core/playbook-system/types';

// ─── Label helpers ────────────────────────────────────────────────────────────

const METRIC_LABEL: Record<string, string> = {
  tx_pool_pending: 'TxPool pending', tx_pool_count: 'TxPool count',
  l1_sync_lag: 'L1 sync lag', gas_price: 'Gas price',
  cpu_usage: 'CPU usage', block_height: 'Block height',
  memory_usage: 'Memory usage', peer_count: 'Peer count',
};
const ANOMALY_OP: Record<string, string> = {
  threshold: '>', 'z-score': '↑', monotonic: '↑↑', plateau: '—', 'zero-drop': '→0',
};
const ACTION_LABEL: Record<string, string> = {
  'restart-batcher': 'Restart batcher',
  'restart-proposer': 'Restart proposer',
  'restart-component': 'Restart component',
  'switch-l1-rpc': 'Switch L1 RPC',
  'scale-up': 'Scale up resources',
  'refill-eoa': 'Refill EOA wallet',
  unknown: '—',
};

function parseSignature(sig: string): { when: string; anomalyType: string } {
  const [anomalyType = '', metricName = '', , vPart = ''] = sig.split('|');
  const metric = METRIC_LABEL[metricName] ?? metricName.replace(/_/g, ' ');
  const op = ANOMALY_OP[anomalyType] ?? '>';
  const value = vPart.replace('v:', '');
  const when = value && value !== '0' ? `${metric} ${op} ${value}` : metric;
  return { when, anomalyType };
}

function humanAction(action: string): string {
  return ACTION_LABEL[action] ?? action.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#007A00';
  if (c >= 0.6) return '#CC6600';
  return '#D40000';
}

const statusBadgeStyle = (status: EvolvedPlaybook['reviewStatus']): React.CSSProperties => {
  const base: React.CSSProperties = { fontSize: 9, fontWeight: 700, padding: '1px 5px', letterSpacing: '0.05em', border: '1px solid' };
  const MAP: Record<string, React.CSSProperties> = {
    draft:     { ...base, background: '#FFF8E0', color: '#886600', borderColor: '#DDC000' },
    pending:   { ...base, background: '#FFF8E0', color: '#886600', borderColor: '#DDC000' },
    approved:  { ...base, background: '#E8F0FF', color: '#0055AA', borderColor: '#0055AA' },
    trusted:   { ...base, background: '#E8FFF5', color: '#007A00', borderColor: '#00A060' },
    suspended: { ...base, background: '#F5F5F5', color: '#888',    borderColor: '#CCC' },
    archived:  { ...base, background: '#F5F5F5', color: '#888',    borderColor: '#CCC' },
  };
  return MAP[status] ?? base;
};

const FONT = "'IBM Plex Mono', monospace";
const F = FONT;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusData {
  instanceId: string;
  ledger: { total: number; lastTimestamp: string | null };
  playbooks: { total: number; needsReview: number };
  scheduler: { nextCron: string };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <div style={{
      background: '#ECECEC', borderBottom: '1px solid #D8D8D8', borderTop: '1px solid #D8D8D8',
      padding: '3px 10px', fontFamily: F, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      color: '#444', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <span>{children}</span>
      {right && <span style={{ fontWeight: 400, color: '#888' }}>{right}</span>}
    </div>
  );
}

function PlaybookCard({
  pb,
  onApprove,
  onPromote,
  onSuspend,
  loading,
}: {
  pb: EvolvedPlaybook;
  onApprove: (id: string) => void;
  onPromote: (id: string) => void;
  onSuspend: (id: string) => void;
  loading: boolean;
}) {
  const { when } = parseSignature(pb.triggerSignature);
  const action = humanAction(pb.action);
  const pct = Math.round(pb.confidence * 100);
  const confColor = confidenceColor(pb.confidence);
  const leftBorder = pb.reviewStatus === 'draft' || pb.reviewStatus === 'pending'
    ? '3px solid #D40000'
    : pb.reviewStatus === 'approved' ? '3px solid #0055AA'
    : pb.reviewStatus === 'trusted' ? '3px solid #007A00'
    : '3px solid #CCC';

  return (
    <div style={{ borderBottom: '2px solid #E0E0E0', background: '#FFF', borderLeft: leftBorder, flexShrink: 0 }}>
      {/* Title row */}
      <div style={{ padding: '7px 10px 5px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F, fontSize: 11, fontWeight: 700, lineHeight: 1.3 }}>
            {action} when {when.toLowerCase()}
          </div>
          <div style={{ fontFamily: F, fontSize: 9, color: '#888', marginTop: 2 }}>
            {pb.performance.totalApplications} incidents · v{pb.evolution.version}
            {pb.performance.lastApplied ? ` · last ${relativeTime(pb.performance.lastApplied)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: confColor }}>
            {pct}%
          </span>
          <span style={statusBadgeStyle(pb.reviewStatus)}>
            {pb.reviewStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Trigger → Action */}
      <div style={{ padding: '0 10px 7px', display: 'flex', alignItems: 'stretch', gap: 5 }}>
        <div style={{ flex: 1, background: '#F4F4F4', border: '1px solid #E0E0E0', padding: '5px 8px' }}>
          <div style={{ fontFamily: F, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: '#888', marginBottom: 2 }}>WHEN THIS HAPPENS</div>
          <div style={{ fontFamily: F, fontSize: 10, fontWeight: 600 }}>{when}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: '#888', fontSize: 14, flexShrink: 0 }}>→</div>
        <div style={{ flex: 1, background: '#F0F4FF', border: '1px solid #B0C4E8', padding: '5px 8px' }}>
          <div style={{ fontFamily: F, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: '#0055AA', marginBottom: 2 }}>DO THIS</div>
          <div style={{ fontFamily: F, fontSize: 10, fontWeight: 600, color: '#0055AA' }}>{action}</div>
        </div>
      </div>

      {/* Evidence bar */}
      <div style={{ padding: '0 10px 7px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: '#0055AA', lineHeight: 1 }}>
            {pb.performance.totalApplications}
          </span>
          <span style={{ fontFamily: F, fontSize: 8, color: '#888', letterSpacing: '0.05em' }}>INCIDENTS</span>
        </div>
        <div style={{ width: 1, height: 28, background: '#E0E0E0', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: '#007A00', lineHeight: 1 }}>
            {Math.round(pb.performance.successRate * 100)}%
          </span>
          <span style={{ fontFamily: F, fontSize: 8, color: '#888', letterSpacing: '0.05em' }}>RESOLVED</span>
        </div>
        <div style={{ width: 1, height: 28, background: '#E0E0E0', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F, fontSize: 8, color: '#888', marginBottom: 3 }}>SUCCESS RATE</div>
          <div style={{ height: 6, background: '#E8E8E8', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${Math.round(pb.performance.successRate * 100)}%`,
              background: confColor,
            }} />
          </div>
          <div style={{ fontFamily: F, fontSize: 8, color: '#555', marginTop: 2 }}>
            {Math.round(pb.performance.successRate * 100)}% ({Math.round(pb.performance.totalApplications * pb.performance.successRate)} of {pb.performance.totalApplications})
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ padding: '0 10px 8px', display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid #F0F0F0', paddingTop: 6 }}>
        {(pb.reviewStatus === 'draft' || pb.reviewStatus === 'pending') && (
          <>
            <button
              disabled={loading}
              onClick={() => onApprove(pb.playbookId)}
              style={{ fontFamily: F, fontSize: 10, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: '#D40000', color: 'white' }}
            >
              ✓ APPROVE
            </button>
            <button
              disabled={loading}
              onClick={() => onSuspend(pb.playbookId)}
              style={{ fontFamily: F, fontSize: 10, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: '#E8E8E8', color: '#555' }}
            >
              ✗ SKIP
            </button>
            <span style={{ fontFamily: F, fontSize: 9, color: '#888', marginLeft: 'auto' }}>
              Will auto-run on match
            </span>
          </>
        )}
        {pb.reviewStatus === 'approved' && (
          <>
            <button
              disabled={loading}
              onClick={() => onPromote(pb.playbookId)}
              style={{ fontFamily: F, fontSize: 10, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: '#0055AA', color: 'white' }}
            >
              ↑ MARK TRUSTED
            </button>
            <button
              disabled={loading}
              onClick={() => onSuspend(pb.playbookId)}
              style={{ fontFamily: F, fontSize: 10, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: '#E8E8E8', color: '#555' }}
            >
              SUSPEND
            </button>
          </>
        )}
        {pb.reviewStatus === 'trusted' && (
          <>
            <span style={{ fontFamily: F, fontSize: 9, color: '#007A00', fontWeight: 600 }}>
              ✓ Runs automatically
            </span>
            <button
              disabled={loading}
              onClick={() => onSuspend(pb.playbookId)}
              style={{ fontFamily: F, fontSize: 10, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: '#E8E8E8', color: '#555', marginLeft: 'auto' }}
            >
              SUSPEND
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PlaybooksTab() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [playbooks, setPlaybooks] = useState<EvolvedPlaybook[]>([]);
  const [ledger, setLedger] = useState<OperationRecord[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [mineLoading, setMineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const BASE = '/api/playbook-evolution';

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, pbRes, ledgerRes] = await Promise.all([
        fetch(`${BASE}?action=status`),
        fetch(`${BASE}?action=playbooks`),
        fetch(`${BASE}?action=ledger&limit=10`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (pbRes.ok) { const d = await pbRes.json(); setPlaybooks(d.playbooks ?? []); }
      if (ledgerRes.ok) { const d = await ledgerRes.json(); setLedger(d.records ?? []); }
      setError(null);
    } catch {
      setError('Failed to fetch playbook data');
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const runMine = useCallback(async () => {
    setMineLoading(true);
    try {
      await fetch(`${BASE}?action=mine`, { method: 'POST' });
      await fetchAll();
    } finally {
      setMineLoading(false);
    }
  }, [fetchAll]);

  const handleAction = useCallback(async (id: string, action: 'approve' | 'promote' | 'suspend') => {
    setActionLoading(true);
    try {
      await fetch(`${BASE}?action=${action}&id=${id}`, { method: 'POST' });
      await fetchAll();
    } finally {
      setActionLoading(false);
    }
  }, [fetchAll]);

  const needsReview = playbooks.filter(p => p.reviewStatus === 'draft' || p.reviewStatus === 'pending');
  const active = playbooks.filter(p => p.reviewStatus === 'approved' || p.reviewStatus === 'trusted');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Loop status bar */}
      <div style={{
        background: '#F5F5F5', borderBottom: '1px solid #E0E0E0',
        padding: '5px 10px', display: 'flex', alignItems: 'center',
        gap: 12, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontFamily: F, fontSize: 9, color: '#888' }}>RECORDS</span>
          <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700 }}>{status?.ledger.total ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontFamily: F, fontSize: 9, color: '#888' }}>LAST LEARNED</span>
          <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700 }}>{relativeTime(status?.ledger.lastTimestamp ?? null)}</span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontFamily: F, fontSize: 9, color: '#888' }}>NEXT AUTO-RUN</span>
          <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700 }}>00:05 UTC</span>
          <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700, padding: '1px 5px', background: '#E8F0FF', color: '#0055AA', border: '1px solid #0055AA' }}>DAILY</span>
        </div>
        <button
          onClick={runMine}
          disabled={mineLoading}
          style={{
            marginLeft: 'auto', background: mineLoading ? '#999' : '#0055AA', color: 'white',
            border: 'none', padding: '3px 8px', fontFamily: F, fontSize: 9, fontWeight: 700, cursor: mineLoading ? 'default' : 'pointer',
          }}
        >
          {mineLoading ? '...' : '▶ RUN NOW'}
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div style={{ padding: '8px 10px', fontFamily: F, fontSize: 10, color: '#D40000', background: '#FFF0F0', borderBottom: '1px solid #F0C0C0' }}>
            {error}
          </div>
        )}

        {/* Needs review */}
        {needsReview.length > 0 && (
          <>
            <SectionLabel right={`${needsReview.length} AUTO-LEARNED`}>NEEDS REVIEW</SectionLabel>
            {needsReview.map(pb => (
              <PlaybookCard
                key={pb.playbookId} pb={pb} loading={actionLoading}
                onApprove={id => handleAction(id, 'approve')}
                onPromote={id => handleAction(id, 'promote')}
                onSuspend={id => handleAction(id, 'suspend')}
              />
            ))}
          </>
        )}

        {/* Active playbooks */}
        {active.length > 0 && (
          <>
            <SectionLabel right={`${active.length} ACTIVE`}>ACTIVE PLAYBOOKS</SectionLabel>
            {active.map(pb => (
              <PlaybookCard
                key={pb.playbookId} pb={pb} loading={actionLoading}
                onApprove={id => handleAction(id, 'approve')}
                onPromote={id => handleAction(id, 'promote')}
                onSuspend={id => handleAction(id, 'suspend')}
              />
            ))}
          </>
        )}

        {/* Empty state */}
        {playbooks.length === 0 && !error && (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontFamily: F, fontSize: 10, color: '#999', lineHeight: 1.8 }}>
            <div>No evolved playbooks yet.</div>
            <div>Ledger needs ≥3 recurring incidents</div>
            <div>before patterns are detected.</div>
            <div style={{ marginTop: 8, color: '#CCC' }}>{status?.ledger.total ?? 0} records so far</div>
          </div>
        )}

        {/* Recent executions */}
        {ledger.length > 0 && (
          <>
            <SectionLabel right={`${status?.ledger.total ?? 0} TOTAL`}>RECENT EXECUTIONS</SectionLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F, fontSize: 9, flexShrink: 0 }}>
              <thead>
                <tr>
                  {['TIME', 'TRIGGER', 'ACTION', 'RESULT'].map(h => (
                    <th key={h} style={{
                      background: '#F0F0F0', padding: '3px 8px', textAlign: 'left',
                      fontWeight: 700, letterSpacing: '0.05em', color: '#555',
                      borderBottom: '1px solid #D0D0D0', position: 'sticky', top: 0,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map(r => {
                  const { when } = parseSignature(r.trigger.anomalyType + '|' + r.trigger.metricName + '|z:na|v:0');
                  const resultColor = r.outcome === 'success' ? '#007A00' : r.outcome === 'failure' ? '#D40000' : '#888';
                  const resultLabel = r.outcome === 'success' ? '✓ RESOLVED' : r.outcome === 'failure' ? '✗ FAILED' : r.outcome.toUpperCase();
                  const timeStr = new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                  return (
                    <tr key={r.operationId}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #F4F4F4', color: '#888' }}>{timeStr}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #F4F4F4' }}>{when}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #F4F4F4', color: '#555' }}>{humanAction(r.action)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #F4F4F4', fontWeight: 700, color: resultColor }}>{resultLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep playbooks-tab
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/playbooks-tab.tsx
git commit -m "feat(playbook-evolution): add PlaybooksTab component"
```

---

## Chunk 3: Wire into OperationsPanel + Ticker

### Task 3: Add PLAYBOOKS tab to OperationsPanel

**Files:**
- Modify: `src/components/operations-panel.tsx`

Add 2-tab bar at the top: "OPS" | "PLAYBOOKS ●" (● = needsReview badge).
When PLAYBOOKS active, render `<PlaybooksTab />` instead of current content.
`needsReview` count shown as red badge on tab.

- [ ] **Step 1: Add tab state + import to `operations-panel.tsx`**

At the top of the file, add import:
```typescript
import { PlaybooksTab } from '@/components/playbooks-tab';
import { useState } from 'react';
```

- [ ] **Step 2: Add tab bar + conditional render**

Replace the existing header section (lines 127–138) with:

```typescript
// Inside OperationsPanel, before the scrollable div:
const [activeTab, setActiveTab] = useState<'ops' | 'playbooks'>('ops');
```

Replace entire `return (...)` with:

```typescript
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
    {/* Header */}
    <div style={{
      background: '#F7F7F7', borderBottom: '1px solid #A0A0A0',
      padding: '0 10px', height: 24, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', flexShrink: 0,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A0A0A' }}>
        Operations
      </span>
      <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>live · 30s</span>
    </div>

    {/* Tab bar */}
    <div style={{ display: 'flex', borderBottom: '1px solid #D0D0D0', background: '#F0F0F0', flexShrink: 0 }}>
      {(['ops', 'playbooks'] as const).map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          style={{
            fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
            padding: '4px 12px', border: 'none', borderRight: '1px solid #D0D0D0',
            cursor: 'pointer', textTransform: 'uppercase',
            background: activeTab === tab ? '#FAFAFA' : '#F0F0F0',
            color: activeTab === tab ? '#0A0A0A' : '#888',
            borderBottom: activeTab === tab ? '2px solid #D40000' : '2px solid transparent',
          }}
        >
          {tab === 'ops' ? 'OPS' : 'PLAYBOOKS'}
        </button>
      ))}
    </div>

    {/* Tab content */}
    {activeTab === 'ops' ? (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ... existing OPS content unchanged ... */}
      </div>
    ) : (
      <PlaybooksTab />
    )}
  </div>
);
```

**Important:** The `useState` hook must be declared at the top of the function body, before any early returns or conditionals.

- [ ] **Step 3: Verify the component renders and types check**

```bash
npx tsc --noEmit 2>&1 | grep operations-panel
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/operations-panel.tsx
git commit -m "feat(playbook-evolution): add PLAYBOOKS tab to OperationsPanel"
```

### Task 4: Add review count to ticker in page.tsx

**Files:**
- Modify: `src/app/page.tsx`

Add `needsReview` to ticker items so operators see at a glance.

- [ ] **Step 1: Add ticker item**

In `page.tsx`, find the `tickerItems` array and add:
```typescript
{ label: 'AUTO-LEARNED', value: `${needsReviewCount} REVIEW`, warn: needsReviewCount > 0 },
```

To get `needsReviewCount`, add a state variable and fetch:
```typescript
const [needsReviewCount, setNeedsReviewCount] = useState(0);

// In useEffect or polling, add:
fetch('/api/playbook-evolution?action=status')
  .then(r => r.json())
  .then(d => setNeedsReviewCount(d.playbooks?.needsReview ?? 0))
  .catch(() => {});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(playbook-evolution): show review count in ticker"
```

---

## Chunk 4: Verification

### Task 5: Build check + test

- [ ] **Step 1: TypeScript full check**

```bash
npx tsc --noEmit 2>&1
```
Expected: 0 new errors (pre-existing failures are acceptable)

- [ ] **Step 2: Lint check**

```bash
npm run lint 2>&1 | tail -20
```
Expected: no new errors

- [ ] **Step 3: Run relevant tests**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```
Expected: same or better than before (19 pass)

- [ ] **Step 4: Manual verify (dev server)**

```bash
npm run dev
```
- Open http://localhost:3002
- Click "PLAYBOOKS" tab in right panel
- Verify: loop status bar shows, empty state displays when no data
- Verify: "RUN NOW" button triggers POST /api/playbook-evolution?action=mine
- Verify: no console errors

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(playbook-evolution): complete dashboard integration"
```
