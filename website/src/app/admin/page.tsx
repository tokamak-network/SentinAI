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
            <p>This is the administrator interface for managing marketplace operations.</p>
          </div>

          <div style={{
            background: '#F5F5F5',
            border: '1px solid #E0E0E0',
            padding: '16px',
            fontSize: '11px',
            color: '#666',
            fontFamily: MONO_FONT,
          }}>
            <div style={{ marginBottom: '12px', fontWeight: 700 }}>Navigation (Coming Soon):</div>
            <ul style={{ margin: 0, paddingLeft: '20px', listStyle: 'none' }}>
              <li>/admin/catalog - Manage marketplace agents</li>
              <li>/admin/pricing - Set pricing and policies</li>
              <li>/admin/orders - View and manage orders</li>
              <li>/admin/payments - Handle payments</li>
              <li>/admin/analytics - View statistics</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
