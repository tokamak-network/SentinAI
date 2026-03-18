'use client';

import { useEffect, useState } from 'react';
import type { TradeStatsResult } from '@/lib/trade-stats';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

interface StatColumnProps {
  label: string;
  value: string;
}

function StatColumn({ label, value }: StatColumnProps) {
  return (
    <div style={{
      flex: 1,
      padding: '16px 20px',
      borderRight: '1px solid #E0E0E0',
      minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT,
        fontSize: '20px',
        fontWeight: 700,
        color: '#D40000',
        letterSpacing: '-0.01em',
        marginBottom: '4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: FONT,
        fontSize: '8px',
        fontWeight: 700,
        color: '#707070',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

function formatVolume(ton: string): string {
  const num = parseFloat(ton);
  if (isNaN(num)) return '0 TON';
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K TON`;
  return `${num.toFixed(2)} TON`;
}

export default function TradeStatsBanner() {
  const [stats, setStats] = useState<TradeStatsResult | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    fetch('/api/trade-stats')
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.json() as Promise<TradeStatsResult>;
      })
      .then((data) => {
        if (!data.ok) {
          setHidden(true);
          return;
        }
        setStats(data);
      })
      .catch(() => setHidden(true));
  }, []);

  if (hidden) return null;

  const placeholder = '---';
  const g = stats?.global;

  return (
    <div style={{
      border: '1px solid #D0D0D0',
      background: '#F7F7F7',
      marginBottom: '20px',
    }}>
      {/* Header bar */}
      <div style={{
        background: '#0A0A0A',
        color: 'white',
        padding: '3px 14px',
        fontFamily: FONT,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: stats ? '#00C853' : '#888',
        }} />
        On-Chain Activity
        {stats && (
          <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.6 }}>
            cached {new Date(stats.cachedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Stats columns */}
      <div style={{ display: 'flex', borderTop: '1px solid #D0D0D0' }}>
        <StatColumn
          label="Registered Agents"
          value={g ? String(g.registeredAgents) : placeholder}
        />
        <StatColumn
          label="Total Transactions"
          value={g ? String(g.totalTransactions) : placeholder}
        />
        <StatColumn
          label="Volume (TON)"
          value={g ? formatVolume(g.totalVolumeTON) : placeholder}
        />
        <div style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>
          <div style={{
            fontFamily: FONT,
            fontSize: '20px',
            fontWeight: 700,
            color: '#D40000',
            letterSpacing: '-0.01em',
            marginBottom: '4px',
          }}>
            {g ? String(g.uniqueBuyers) : placeholder}
          </div>
          <div style={{
            fontFamily: FONT,
            fontSize: '8px',
            fontWeight: 700,
            color: '#707070',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}>
            Unique Buyers
          </div>
        </div>
      </div>
    </div>
  );
}
