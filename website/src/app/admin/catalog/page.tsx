'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Agent {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const MONO_FONT = "'IBM Plex Mono', monospace";

export default function CatalogPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', status: 'active' });

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      const res = await fetch('/api/admin/catalog');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAgent() {
    try {
      const res = await fetch('/api/admin/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setFormData({ name: '', description: '', status: 'active' });
      setShowForm(false);
      loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteAgent(id: string) {
    if (!confirm('Delete this agent?')) return;
    try {
      const res = await fetch(`/api/admin/catalog/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

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
              color: item.href === '/admin/catalog' ? '#D40000' : '#333',
              textDecoration: 'none',
              borderBottom: item.href === '/admin/catalog' ? '2px solid #D40000' : 'none',
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

        <div style={{ marginBottom: '20px', display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              background: '#D40000',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: MONO_FONT,
            }}
          >
            {showForm ? 'CANCEL' : 'ADD AGENT'}
          </button>
        </div>

        {showForm && (
          <div style={{
            background: 'white',
            border: '1px solid #D0D0D0',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #D0D0D0',
                  fontSize: '12px',
                  fontFamily: MONO_FONT,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #D0D0D0',
                  fontSize: '12px',
                  fontFamily: MONO_FONT,
                  boxSizing: 'border-box',
                  minHeight: '80px',
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                style={{
                  padding: '8px',
                  border: '1px solid #D0D0D0',
                  fontSize: '12px',
                  fontFamily: MONO_FONT,
                }}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <button
              onClick={handleAddAgent}
              style={{
                background: '#D40000',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: MONO_FONT,
              }}
            >
              CREATE
            </button>
          </div>
        )}

        {loading ? (
          <div>Loading agents...</div>
        ) : (
          <div style={{
            background: 'white',
            border: '1px solid #D0D0D0',
            borderRadius: '2px',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
            }}>
              <thead>
                <tr style={{ background: '#F5F5F5', borderBottom: '1px solid #D0D0D0' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>ID</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>Name</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>Description</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>Created</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} style={{ borderBottom: '1px solid #E0E0E0' }}>
                    <td style={{ padding: '12px', fontSize: '11px' }}>{agent.id}</td>
                    <td style={{ padding: '12px' }}>{agent.name}</td>
                    <td style={{ padding: '12px', color: '#666' }}>{agent.description}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{
                        background: agent.status === 'active' ? '#E8F8E8' : '#F8E8E8',
                        color: agent.status === 'active' ? '#27ae60' : '#D40000',
                        padding: '4px 8px',
                        fontSize: '10px',
                        fontWeight: 700,
                      }}>
                        {agent.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px', fontSize: '11px' }}>
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button
                        onClick={() => handleDeleteAgent(agent.id)}
                        style={{
                          background: '#F8E8E8',
                          color: '#D40000',
                          border: '1px solid #D40000',
                          padding: '4px 8px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: MONO_FONT,
                        }}
                      >
                        DELETE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
