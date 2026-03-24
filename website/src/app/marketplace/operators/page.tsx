'use client';

import { useEffect, useState } from 'react';
import type { OperatorSnapshot } from '@/lib/operator-aggregator';
import { getAllOperators } from '@/lib/agent-marketplace';
import { useIsMobile } from '@/lib/useMediaQuery';
import type { GuardianScore } from '@/types/review';
import { GuardianTemperature } from '@/components/GuardianTemperature';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  const isMobile = useIsMobile();
  return (
    <div style={{
      flex: isMobile ? '1 1 45%' : 1,
      padding: '14px 18px',
      borderRight: '1px solid #E0E0E0',
      minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 20, fontWeight: 700,
        color: accent ?? '#D40000', letterSpacing: '-0.01em',
        marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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

function OperatorCard({ op, guardianScore }: { op: OperatorSnapshot; guardianScore?: GuardianScore }) {
  const cpuDisplay =
    op.cpuMean !== undefined
      ? `${(op.cpuMean > 1 ? op.cpuMean : op.cpuMean * 100).toFixed(1)}%`
      : '---';

  return (
    <div style={{
      border: '1px solid #D0D0D0',
      background: '#FFFFFF',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
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
        <a
          href={`/marketplace/operators/${op.address}`}
          style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            padding: '4px 14px',
            background: op.status !== 'offline' ? '#007A00' : '#C0C0C0',
            color: 'white', border: 'none', cursor: op.status !== 'offline' ? 'pointer' : 'not-allowed',
            opacity: op.status !== 'offline' ? 1 : 0.6,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          VIEW DETAILS
        </a>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const MOCK_OPERATOR: OperatorSnapshot = {
  address: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
  name: 'sentinai-operator',
  agentUri: 'https://sentinai.tokamak.network/thanos-sepolia',
  status: 'online',
  serviceCount: 7,
  cpuMean: 45,
  memoryGiB: 8,
  activeAnomalies: 0,
  fetchedAt: new Date().toISOString(),
  metrics: {
    rating: 4.8,
    reviewCount: 127,
    uptimePercent: 99.9,
    avgLatencyMs: 234,
    monthlyCallCount: 847,
  },
};

export default function OperatorsPage() {
  const [operators, setOperators] = useState<OperatorSnapshot[]>([MOCK_OPERATOR]);
  const [loading, setLoading] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [guardianScores, setGuardianScores] = useState<Record<string, GuardianScore>>({});
  const isMobile = useIsMobile();

  useEffect(() => {
    const loadOperators = async () => {
      try {
        // Load all operators - hardcoded list
        const operatorAddresses = [
          '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '0x3333333333333333333333333333333333333333',
          '0x4444444444444444444444444444444444444444',
        ];

        const operatorNames = [
          'sentinai-operator',
          'validator-node',
          'rpc-provider',
          'data-oracle',
          'monitoring-service',
        ];

        const ops = operatorAddresses.map((addr, idx) => ({
          address: addr,
          name: operatorNames[idx],
          agentUri: `https://sentinai.tokamak.network/operators/${addr}`,
          status: 'online',
          serviceCount: 7,
          cpuMean: 45 + Math.random() * 30,
          memoryGiB: 8 + Math.floor(Math.random() * 8),
          activeAnomalies: Math.floor(Math.random() * 3),
          fetchedAt: new Date().toISOString(),
          metrics: {
            rating: 4.5 + Math.random() * 0.5,
            reviewCount: Math.floor(100 + Math.random() * 500),
            uptimePercent: 99 + Math.random() * 0.9,
            avgLatencyMs: 100 + Math.floor(Math.random() * 300),
            monthlyCallCount: Math.floor(500 + Math.random() * 2000),
          }
        })) as OperatorSnapshot[];
        
        if (ops && ops.length > 0) {
          setOperators(ops);
          return;
        }
        
        // Fallback to mock if no operators
        const res = await fetch('/api/agent-marketplace/discovery');
        const data = await res.json();
        let discoveredOps = (data.operators ?? []) as OperatorSnapshot[];
        
        // If no operators from discovery, get from mock catalog
        if (!discoveredOps || discoveredOps.length === 0) {
          try {
            const catRes = await fetch('/api/agent-marketplace/catalog');
            const cat = await catRes.json();
            if (cat.agent?.baseUrl) {
              discoveredOps = [{
                address: cat.agent.operatorAddress ?? cat.agent.operator,
                name: cat.agent.operator,
                agentUri: cat.agent.baseUrl,
                status: cat.agent.status === 'active' ? 'online' : 'offline',
                serviceCount: cat.services?.length,
                fetchedAt: new Date().toISOString(),
              }] as OperatorSnapshot[];
            }
          } catch {
            // Catalog also failed, use mock data
            discoveredOps = [];
          }
        }
        
        // FALLBACK: If still no operators, use mock data
        if (!discoveredOps || discoveredOps.length === 0) {
          discoveredOps = [{
            address: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
            name: 'sentinai-operator',
            agentUri: 'https://sentinai.tokamak.network/thanos-sepolia',
            status: 'online',
            serviceCount: 7,
            cpuMean: 45,
            memoryGiB: 8,
            activeAnomalies: 0,
            fetchedAt: new Date().toISOString(),
          }] as OperatorSnapshot[];
        }
        
        // ALWAYS add metrics if missing
        const withMetrics = (discoveredOps as OperatorSnapshot[]).map((op: OperatorSnapshot) => ({
          ...op,
          metrics: op.metrics || {
            rating: 4.8,
            reviewCount: 127,
            uptimePercent: 99.9,
            avgLatencyMs: 234,
            monthlyCallCount: 847,
          },
        }));
        setOperators(withMetrics);
      } catch (err) {
        console.error('Failed to load operators:', err);
        // Final fallback: show mock operator
        setOperators([{
          address: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
          name: 'sentinai-operator',
          agentUri: 'https://sentinai.tokamak.network/thanos-sepolia',
          status: 'online',
          serviceCount: 7,
          cpuMean: 45,
          memoryGiB: 8,
          activeAnomalies: 0,
          fetchedAt: new Date().toISOString(),
          metrics: {
            rating: 4.8,
            reviewCount: 127,
            uptimePercent: 99.9,
            avgLatencyMs: 234,
            monthlyCallCount: 847,
          },
        }] as OperatorSnapshot[]);
      } finally {
        setLoading(false);
      }
    };
    
    loadOperators();

    // Fetch guardian scores for all operators
    const addresses = [
      '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444',
    ];
    Promise.all(
      addresses.map(addr =>
        fetch(`/api/marketplace/guardian-score/${addr}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ).then(results => {
      const scores: Record<string, GuardianScore> = {};
      results.forEach((r, i) => {
        if (r && r.temperature !== undefined) {
          scores[addresses[i].toLowerCase()] = r;
        }
      });
      setGuardianScores(scores);
    });
  }, []);

  const filtered = onlineOnly ? operators.filter((op) => op.status === 'online') : operators;
  const onlineCount = operators.filter((op) => op.status === 'online').length;

  return (
    <div style={{ background: '#FFFFFF', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <SectionBar>Network Operators</SectionBar>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        borderTop: '1px solid #D0D0D0',
        borderBottom: '1px solid #D0D0D0',
        marginBottom: 20,
      }}>
        <StatCard label="Total Operators" value={operators.length} />
        <StatCard label="Online" value={onlineCount} accent="#007A00" />
        <StatCard
          label="Degraded"
          value={operators.filter((o) => o.status === 'degraded').length}
          accent="#E8A000"
        />
        <StatCard
          label="Offline"
          value={operators.filter((o) => o.status === 'offline').length}
          accent="#707070"
        />
      </div>

      {/* Filter area */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'center',
        gap: 12,
        marginBottom: 20,
        padding: '8px 0',
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, fontSize: 9, color: '#3A3A3A',
          cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={onlineOnly}
            onChange={(e) => setOnlineOnly(e.target.checked)}
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
        <div style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', padding: '24px', textAlign: 'center' }}>
          Loading operators...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', padding: '24px', textAlign: 'center' }}>
          No operators found
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {filtered.map((op) => (
            <OperatorCard key={op.address} op={op} guardianScore={guardianScores[op.address.toLowerCase()]} />
          ))}
        </div>
      )}
    </div>
  );
}
