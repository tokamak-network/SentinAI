'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simple session check: if the page loads, assume session is valid
    // Full middleware protection will be added in next phase
    setIsLoading(false);
  }, []);

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const MONO_FONT = "'IBM Plex Mono', monospace";

  return (
    <main style={{
      minHeight: '100vh',
      background: '#F0F0F0',
      fontFamily: MONO_FONT,
    }}>
      {/* Header */}
      <header style={{
        background: '#D40000',
        color: 'white',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #8B0000',
      }}>
        <h1 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>
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
            transition: 'all 0.2s',
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

      {/* Navigation */}
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
              color: item.href === '/admin' ? '#D40000' : '#333',
              textDecoration: 'none',
              borderBottom: item.href === '/admin' ? '2px solid #D40000' : 'none',
              paddingBottom: '2px',
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* Content */}
      <div style={{
        padding: '40px 24px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #D0D0D0',
          padding: '24px',
          borderRadius: '2px',
        }}>
          <h2 style={{
            margin: '0 0 16px 0',
            fontSize: '13px',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: '#333',
          }}>
            Dashboard
          </h2>

          <div style={{
            fontSize: '12px',
            color: '#666',
            lineHeight: '1.6',
            marginBottom: '20px',
          }}>
            <p>Welcome to the SentinAI Marketplace Admin Panel.</p>
            <p>Manage your marketplace agents, pricing, orders, and analytics from the navigation menu.</p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
          }}>
            {[
              { href: '/admin/catalog', label: 'Catalog', desc: 'Manage marketplace agents' },
              { href: '/admin/pricing', label: 'Pricing', desc: 'Set pricing and policies' },
              { href: '/admin/orders', label: 'Orders', desc: 'View and manage orders' },
              { href: '/admin/analytics', label: 'Analytics', desc: 'View statistics' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                style={{
                  background: '#F5F5F5',
                  border: '1px solid #D0D0D0',
                  padding: '16px',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#E8E8E8';
                  (e.currentTarget as HTMLElement).style.borderColor = '#D40000';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#F5F5F5';
                  (e.currentTarget as HTMLElement).style.borderColor = '#D0D0D0';
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#D40000', marginBottom: '4px' }}>
                  {item.label}
                </div>
                <div style={{ fontSize: '11px', color: '#666' }}>
                  {item.desc}
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
