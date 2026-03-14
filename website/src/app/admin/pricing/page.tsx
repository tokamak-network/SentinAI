'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PricingPolicy {
  trainee: number;
  junior: number;
  senior: number;
  expert: number;
}

const MONO_FONT = "'IBM Plex Mono', monospace";

const TIER_LABELS: Record<keyof PricingPolicy, string> = {
  trainee: 'Trainee',
  junior: 'Junior',
  senior: 'Senior',
  expert: 'Expert',
};

export default function PricingPage() {
  const router = useRouter();
  const [pricing, setPricing] = useState<PricingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState<Partial<PricingPolicy>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPricing();
  }, []);

  async function loadPricing() {
    try {
      const res = await fetch('/api/admin/pricing');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPricing(data);
      setEdited({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!pricing || Object.keys(edited).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edited),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPricing(data);
      setEdited({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
              color: item.href === '/admin/pricing' ? '#D40000' : '#333',
              textDecoration: 'none',
              borderBottom: item.href === '/admin/pricing' ? '2px solid #D40000' : 'none',
              paddingBottom: '2px',
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div style={{ padding: '40px 24px', maxWidth: '800px', margin: '0 auto' }}>
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
          <div>Loading pricing...</div>
        ) : pricing ? (
          <div style={{
            background: 'white',
            border: '1px solid #D0D0D0',
            padding: '24px',
            borderRadius: '2px',
          }}>
            <h2 style={{ margin: '0 0 24px 0', fontSize: '13px', fontWeight: 700 }}>
              TIER PRICING (USD)
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              {(Object.entries(TIER_LABELS) as [keyof PricingPolicy, string][]).map(([tier, label]) => (
                <div key={tier}>
                  <label style={{ fontSize: '11px', display: 'block', fontWeight: 700, marginBottom: '8px' }}>
                    {label}
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                      {formatPrice(edited[tier] !== undefined ? edited[tier] : pricing[tier])}
                    </span>
                    <input
                      type="number"
                      value={edited[tier] !== undefined ? edited[tier] : pricing[tier]}
                      onChange={(e) =>
                        setEdited({
                          ...edited,
                          [tier]: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #D0D0D0',
                        fontSize: '12px',
                        fontFamily: MONO_FONT,
                      }}
                      placeholder="0"
                    />
                    <span style={{ fontSize: '11px', color: '#888' }}>¢</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', paddingTop: '20px', borderTop: '1px solid #D0D0D0' }}>
              <button
                onClick={handleSave}
                disabled={Object.keys(edited).length === 0 || saving}
                style={{
                  background: Object.keys(edited).length === 0 ? '#A9A9A9' : '#D40000',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: Object.keys(edited).length === 0 ? 'not-allowed' : 'pointer',
                  fontFamily: MONO_FONT,
                }}
              >
                {saving ? 'SAVING...' : 'SAVE CHANGES'}
              </button>
              <button
                onClick={() => setEdited({})}
                style={{
                  background: '#E8E8E8',
                  color: '#333',
                  border: '1px solid #D0D0D0',
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: MONO_FONT,
                }}
              >
                RESET
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
