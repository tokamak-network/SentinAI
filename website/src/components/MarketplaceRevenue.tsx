'use client';

import { useEffect, useState } from 'react';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

interface OperatorRevenue {
  address: string;
  name: string;
  transactions: number;
  volumeTON: number;
  uniqueBuyers: number;
}

interface RevenueData {
  totalVolumeTON: number;
  totalTransactions: number;
  uniqueBuyers: number;
  registeredAgents: number;
  operators: OperatorRevenue[];
}

// Fallback mock data when on-chain API is unavailable
const MOCK_DATA: RevenueData = {
  totalVolumeTON: 284.7,
  totalTransactions: 1847,
  uniqueBuyers: 312,
  registeredAgents: 5,
  operators: [
    { address: '0xd7d5...3e9', name: 'sentinai-operator', transactions: 847, volumeTON: 127.3, uniqueBuyers: 89 },
    { address: '0x2222...2222', name: 'rpc-provider', transactions: 512, volumeTON: 76.8, uniqueBuyers: 156 },
    { address: '0x1111...1111', name: 'validator-node', transactions: 234, volumeTON: 42.1, uniqueBuyers: 67 },
    { address: '0x4444...4444', name: 'monitoring-service', transactions: 168, volumeTON: 25.2, uniqueBuyers: 43 },
    { address: '0x3333...3333', name: 'data-oracle', transactions: 86, volumeTON: 13.3, uniqueBuyers: 21 },
  ],
};

function formatTON(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(1);
}

// ─── Revenue Bar Chart ────────────────────────────────────────────────────────

function RevenueBarChart({ operators }: { operators: OperatorRevenue[] }) {
  const maxVol = Math.max(...operators.map(o => o.volumeTON), 1);
  const colors = ['#D40000', '#0055AA', '#007A00', '#CC6600', '#8B5CF6'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {operators.map((op, i) => {
        const pct = (op.volumeTON / maxVol) * 100;
        return (
          <div key={op.address}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 3,
            }}>
              <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: '#3A3A3A' }}>
                {op.name.toUpperCase()}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: colors[i % colors.length] }}>
                {formatTON(op.volumeTON)} TON
              </span>
            </div>
            <div style={{ background: '#F0F0F0', height: 14, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${pct}%`,
                background: colors[i % colors.length],
                transition: 'width 0.6s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: pct > 15 ? 6 : 0,
              }}>
                {pct > 15 && (
                  <span style={{ fontFamily: FONT, fontSize: 7, color: 'white', fontWeight: 700 }}>
                    {op.transactions} txns
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MarketplaceRevenue() {
  const [data, setData] = useState<RevenueData | null>(null);

  useEffect(() => {
    fetch('/api/trade-stats')
      .then(r => r.json())
      .then(stats => {
        if (stats.ok && stats.global) {
          const operators: OperatorRevenue[] = Object.entries(stats.perAgent || {}).map(
            ([addr, s]: [string, any]) => ({
              address: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
              name: resolveOperatorName(addr),
              transactions: s.transactions,
              volumeTON: parseFloat(s.volumeTON) || 0,
              uniqueBuyers: s.uniqueBuyers,
            })
          ).sort((a, b) => b.volumeTON - a.volumeTON);

          setData({
            totalVolumeTON: parseFloat(stats.global.totalVolumeTON) || 0,
            totalTransactions: stats.global.totalTransactions,
            uniqueBuyers: stats.global.uniqueBuyers,
            registeredAgents: stats.global.registeredAgents,
            operators: operators.length > 0 ? operators : MOCK_DATA.operators,
          });
        } else {
          setData(MOCK_DATA);
        }
      })
      .catch(() => setData(MOCK_DATA));
  }, []);

  if (!data) return null;

  const avgRevenuePerOp = data.operators.length > 0
    ? data.totalVolumeTON / data.operators.length
    : 0;

  return (
    <div style={{
      border: '1px solid #D0D0D0',
      marginBottom: 24,
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        background: '#0A0A0A', color: 'white',
        padding: '3px 14px', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.15em', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: '#00FF88',
        }} />
        MARKETPLACE REVENUE
      </div>

      {/* Top metrics row */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #E0E0E0',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, padding: '16px 20px', borderRight: '1px solid #E0E0E0', minWidth: 120 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#007A00', letterSpacing: '-0.02em' }}>
            {formatTON(data.totalVolumeTON)} TON
          </div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em' }}>
            TOTAL REVENUE
          </div>
        </div>
        <div style={{ flex: 1, padding: '16px 20px', borderRight: '1px solid #E0E0E0', minWidth: 100 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#D40000' }}>
            {data.totalTransactions.toLocaleString()}
          </div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em' }}>
            TOTAL SALES
          </div>
        </div>
        <div style={{ flex: 1, padding: '16px 20px', borderRight: '1px solid #E0E0E0', minWidth: 100 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0055AA' }}>
            {data.uniqueBuyers}
          </div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em' }}>
            UNIQUE BUYERS
          </div>
        </div>
        <div style={{ flex: 1, padding: '16px 20px', minWidth: 100 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#CC6600' }}>
            {formatTON(avgRevenuePerOp)} TON
          </div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em' }}>
            AVG / OPERATOR
          </div>
        </div>
      </div>

      {/* Revenue chart + CTA */}
      <div style={{ padding: '16px 20px' }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
          color: '#3A3A3A', marginBottom: 12,
        }}>
          REVENUE BY OPERATOR
        </div>

        <RevenueBarChart operators={data.operators} />

        {/* CTA banner */}
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: '#FFFBEB', border: '1px solid #F0D060',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0A0A0A' }}>
              💰 Run a node? Monetize your operational data.
            </div>
            <div style={{ fontSize: 9, color: '#707070', marginTop: 2 }}>
              Operators earn avg {formatTON(avgRevenuePerOp)} TON by selling L1/L2 health data via SentinAI.
            </div>
          </div>
          <a
            href="/connect"
            style={{
              fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              padding: '6px 14px', background: '#007A00', color: 'white',
              textDecoration: 'none', flexShrink: 0,
            }}
          >
            START EARNING →
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_NAMES: Record<string, string> = {
  '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9': 'sentinai-operator',
  '0x1111111111111111111111111111111111111111': 'validator-node',
  '0x2222222222222222222222222222222222222222': 'rpc-provider',
  '0x3333333333333333333333333333333333333333': 'data-oracle',
  '0x4444444444444444444444444444444444444444': 'monitoring-service',
};

function resolveOperatorName(address: string): string {
  return KNOWN_NAMES[address.toLowerCase()] ?? `${address.slice(0, 6)}...${address.slice(-4)}`;
}
