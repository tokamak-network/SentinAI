'use client';

import { useEffect, useState } from 'react';
import type { OperatorSnapshot } from '@/lib/operator-aggregator';
import { useIsMobile } from '@/lib/useMediaQuery';
import type { GuardianScore } from '@/types/review';
import { GuardianTemperature } from '@/components/GuardianTemperature';
import TradeStatsBanner from '@/components/TradeStatsBanner';
import InstancePanel from '@/components/InstancePanel';
import SandboxPanel from '@/components/SandboxPanel';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionBar({ children }: { children: string }) {
  return (
    <div style={{
      background: '#0A0A0A', color: 'white',
      padding: '3px 14px', fontFamily: FONT, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.15em', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{
      flex: 1, padding: '14px 18px',
      borderRight: '1px solid #E0E0E0', minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 20, fontWeight: 700,
        color: accent ?? '#D40000', letterSpacing: '-0.01em',
        marginBottom: 4, whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
        letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: OperatorSnapshot['status'] }) {
  const color = status === 'online' ? '#007A00' : status === 'degraded' ? '#E8A000' : '#D40000';
  return (
    <span style={{
      fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', background: color, color: 'white',
      padding: '2px 8px', borderRadius: 2,
    }}>
      {status}
    </span>
  );
}

// ─── Operator Card ────────────────────────────────────────────────────────────

function OperatorCard({ op, guardianScore }: { op: OperatorSnapshot; guardianScore?: GuardianScore }) {
  const cpuDisplay = op.cpuMean !== undefined
    ? `${(op.cpuMean > 1 ? op.cpuMean : op.cpuMean * 100).toFixed(1)}%`
    : '---';

  return (
    <a
      href={`/marketplace/operators/${op.address}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div style={{
        border: '1px solid #D0D0D0', background: '#FFFFFF',
        padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
        cursor: 'pointer', transition: 'border-color 150ms',
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = '#D40000')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = '#D0D0D0')}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: '#0A0A0A', letterSpacing: '0.08em' }}>
              {op.name?.toUpperCase() ?? 'UNKNOWN OPERATOR'}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 8, color: '#A0A0A0', marginTop: 2, wordBreak: 'break-all' }}>
              {op.address}
            </div>
          </div>
          <StatusBadge status={op.status} />
        </div>

        {/* Metrics */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8, background: '#F7F7F7', padding: '10px 12px',
          border: '1px solid #E8E8E8',
        }}>
          {[
            { label: 'CPU', value: cpuDisplay },
            { label: 'MEMORY', value: op.memoryGiB !== undefined ? `${op.memoryGiB} GiB` : '---' },
            { label: 'ANOMALIES', value: op.activeAnomalies ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: '#D40000' }}>
                {value}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 7, color: '#A0A0A0', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Guardian Temperature */}
        {guardianScore && (
          <GuardianTemperature score={guardianScore} variant="compact" />
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: FONT, fontSize: 8, color: '#A0A0A0' }}>
            {op.serviceCount !== undefined ? `${op.serviceCount} services` : '---'}
            {op.chain && ` · ${op.chain}`}
          </div>
          <span style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            padding: '4px 14px', background: '#007A00', color: 'white',
          }}>
            VIEW DETAILS →
          </span>
        </div>
      </div>
    </a>
  );
}

// ─── Tool Card ────────────────────────────────────────────────────────────────

function ToolCard({ icon, title, description, onClick, active, children }: {
  icon: string; title: string; description: string;
  onClick: () => void; active: boolean; children?: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <button
        onClick={onClick}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          background: active ? '#F7F7F7' : '#FFFFFF',
          border: `1px solid ${active ? '#D40000' : '#D0D0D0'}`,
          padding: 16, fontFamily: FONT,
          borderBottom: active ? 'none' : '1px solid #D0D0D0',
        }}
      >
        <div style={{ fontSize: 12, marginBottom: 4 }}>
          <span style={{ marginRight: 8 }}>{icon}</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0A0A0A' }}>
            {title}
          </span>
        </div>
        <div style={{ fontSize: 9, color: '#707070' }}>{description}</div>
      </button>
      {active && (
        <div style={{ border: '1px solid #D40000', borderTop: 'none', padding: 16 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const OPERATOR_ADDRESSES = [
  '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
];

const OPERATOR_NAMES = [
  'sentinai-operator', 'validator-node', 'rpc-provider',
  'data-oracle', 'monitoring-service',
];

export default function MarketplacePage() {
  const [operators, setOperators] = useState<OperatorSnapshot[]>([]);
  const [guardianScores, setGuardianScores] = useState<Record<string, GuardianScore>>({});
  const [loading, setLoading] = useState(true);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [activeTool, setActiveTool] = useState<'instance' | 'sandbox' | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    // Load operators
    const ops = OPERATOR_ADDRESSES.map((addr, idx) => ({
      address: addr,
      name: OPERATOR_NAMES[idx],
      agentUri: `https://sentinai.tokamak.network/operators/${addr}`,
      status: idx === 3 ? 'degraded' : 'online',
      serviceCount: [7, 3, 3, 2, 2][idx],
      cpuMean: 45 + Math.random() * 30,
      memoryGiB: [8, 16, 32, 4, 8][idx],
      activeAnomalies: idx === 3 ? 3 : 0,
      fetchedAt: new Date().toISOString(),
    })) as OperatorSnapshot[];
    setOperators(ops);
    setLoading(false);

    // Fetch guardian scores
    Promise.all(
      OPERATOR_ADDRESSES.map(addr =>
        fetch(`/api/marketplace/guardian-score/${addr}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ).then(results => {
      const scores: Record<string, GuardianScore> = {};
      results.forEach((r, i) => {
        if (r && r.temperature !== undefined) {
          scores[OPERATOR_ADDRESSES[i].toLowerCase()] = r;
        }
      });
      setGuardianScores(scores);
    });
  }, []);

  const filtered = onlineOnly ? operators.filter(op => op.status === 'online') : operators;
  const onlineCount = operators.filter(op => op.status === 'online').length;

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', fontFamily: FONT }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {/* Header */}
        <SectionBar>Agent Marketplace</SectionBar>

        <div style={{ padding: '24px 0 16px' }}>
          <h1 style={{
            fontFamily: FONT, fontSize: 24, fontWeight: 700,
            color: '#0A0A0A', letterSpacing: '0.02em', marginBottom: 8,
          }}>
            Agent Marketplace
          </h1>
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#707070', lineHeight: 1.6, maxWidth: 600 }}>
            Buy real-time L1/L2 operational data from verified node operators.
            x402 protocol · TON payments · on-chain settlement on Sepolia.
          </p>
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'flex', flexWrap: 'wrap',
          borderTop: '1px solid #D0D0D0', borderBottom: '1px solid #D0D0D0',
          marginBottom: 20,
        }}>
          <StatCard label="Total Operators" value={operators.length} />
          <StatCard label="Online" value={onlineCount} accent="#007A00" />
          <StatCard label="Degraded" value={operators.filter(o => o.status === 'degraded').length} accent="#E8A000" />
          <StatCard label="Offline" value={operators.filter(o => o.status === 'offline').length} accent="#707070" />
        </div>

        {/* TradeStats */}
        <div style={{ marginBottom: 20 }}>
          <TradeStatsBanner />
        </div>

        {/* Filter */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 20, padding: '8px 0',
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: FONT, fontSize: 9, color: '#3A3A3A',
            cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={e => setOnlineOnly(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            ONLINE ONLY
          </label>
          <span style={{ fontFamily: FONT, fontSize: 9, color: '#A0A0A0' }}>
            {loading ? 'Loading...' : `${filtered.length} operator${filtered.length !== 1 ? 's' : ''} shown`}
          </span>
        </div>

        {/* Operator grid */}
        {loading ? (
          <div style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', padding: 24, textAlign: 'center' }}>
            Loading operators...
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16, marginBottom: 40,
          }}>
            {filtered.map(op => (
              <OperatorCard
                key={op.address}
                op={op}
                guardianScore={guardianScores[op.address.toLowerCase()]}
              />
            ))}
          </div>
        )}

        {/* Tools section */}
        <SectionBar>Tools</SectionBar>
        <div style={{
          display: 'flex', gap: 16, marginTop: 0,
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          <ToolCard
            icon="🔧"
            title="INSTANCE"
            description="Manage your connected SentinAI node instance"
            onClick={() => setActiveTool(activeTool === 'instance' ? null : 'instance')}
            active={activeTool === 'instance'}
          >
            <InstancePanel />
          </ToolCard>
          <ToolCard
            icon="🧪"
            title="SANDBOX"
            description="Test marketplace API calls in sandbox mode"
            onClick={() => setActiveTool(activeTool === 'sandbox' ? null : 'sandbox')}
            active={activeTool === 'sandbox'}
          >
            <SandboxPanel />
          </ToolCard>
        </div>
      </main>
    </div>
  );
}
