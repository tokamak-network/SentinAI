'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Analytics {
  timestamp: string;
  agents: { total: number; active: number; inactive: number };
  orders: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    byTier: Record<string, number>;
    recent7Days: number;
  };
  revenue: {
    total: number;
    byTier: Record<string, number>;
  };
  pricing: Record<string, number>;
}

const MONO_FONT = "'IBM Plex Mono', monospace";

export default function AnalyticsPage() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/admin/analytics');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  return (
    <main style={{ minHeight: '100vh', background: '#F0F0F0', fontFamily: MONO_FONT }}>
      <header style={{
        background: '#D40000',
        color: 'white',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #8B0000',
      }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}>
          SENTINAI MARKETPLACE ADMIN
        </h1>
        <button
          onClick={handleLogout}
          style={{
            background: '#8B0000',
            color: 'white',
            border: '1px solid #FFFFFF',
            padding: '8px 16px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: MONO_FONT,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
            (e.currentTarget as HTMLButtonElement).style.color = '#D40000';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#8B0000';
            (e.currentTarget as HTMLButtonElement).style.color = 'white';
          }}
        >
          LOGOUT
        </button>
      </header>

      <nav style={{
        background: '#E8E8E8',
        borderBottom: '1px solid #D0D0D0',
        padding: '12px 24px',
        display: 'flex',
        gap: '24px',
      }}>
        {[
          { href: '/admin', label: 'Dashboard' },
          { href: '/admin/catalog', label: 'Catalog' },
          { href: '/admin/pricing', label: 'Pricing' },
          { href: '/admin/orders', label: 'Orders' },
          { href: '/admin/analytics', label: 'Analytics' },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: item.href === '/admin/analytics' ? '#D40000' : '#333',
              textDecoration: 'none',
              borderBottom: item.href === '/admin/analytics' ? '2px solid #D40000' : 'none',
              paddingBottom: '2px',
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div style={{ padding: '40px 24px', maxWidth: '1200px', margin: '0 auto' }}>
        {error && (
          <div style={{
            background: '#FFF8F8',
            border: '1px solid #D40000',
            color: '#D40000',
            padding: '12px',
            marginBottom: '20px',
            fontSize: '12px',
          }}>
            Error: {error}
          </div>
        )}

        {loading ? (
          <div>Loading analytics...</div>
        ) : analytics ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Agents */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>AGENTS</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Total</span>
                  <strong>{analytics.agents.total}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Active</span>
                  <strong style={{ color: '#27ae60' }}>{analytics.agents.active}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Inactive</span>
                  <strong style={{ color: '#D40000' }}>{analytics.agents.inactive}</strong>
                </div>
              </div>
            </div>

            {/* Orders Summary */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>ORDERS SUMMARY</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Total</span>
                  <strong>{analytics.orders.total}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Completed</span>
                  <strong style={{ color: '#27ae60' }}>{analytics.orders.completed}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Pending</span>
                  <strong style={{ color: '#E67E22' }}>{analytics.orders.pending}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Failed</span>
                  <strong style={{ color: '#D40000' }}>{analytics.orders.failed}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '1px solid #E0E0E0', paddingTop: '8px', marginTop: '8px' }}>
                  <span>Last 7 Days</span>
                  <strong>{analytics.orders.recent7Days}</strong>
                </div>
              </div>
            </div>

            {/* Revenue */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>TOTAL REVENUE</h3>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#27ae60', marginBottom: '16px' }}>
                {formatPrice(analytics.revenue.total)}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>
                by tier breakdown below
              </div>
            </div>

            {/* Orders by Tier */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>ORDERS BY TIER</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {['trainee', 'junior', 'senior', 'expert'].map((tier) => (
                  <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ textTransform: 'capitalize' }}>{tier}</span>
                    <strong>{analytics.orders.byTier[tier] || 0}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue by Tier */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>REVENUE BY TIER</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {['trainee', 'junior', 'senior', 'expert'].map((tier) => (
                  <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ textTransform: 'capitalize' }}>{tier}</span>
                    <strong>{formatPrice(analytics.revenue.byTier[tier] || 0)}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>CURRENT PRICING</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {['trainee', 'junior', 'senior', 'expert'].map((tier) => (
                  <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ textTransform: 'capitalize' }}>{tier}</span>
                    <strong>{formatPrice(analytics.pricing[tier] || 0)}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Last Updated */}
            <div style={{ background: 'white', border: '1px solid #D0D0D0', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700 }}>LAST UPDATED</h3>
              <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.6' }}>
                {formatDate(analytics.timestamp)}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
