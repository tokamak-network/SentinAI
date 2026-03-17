'use client';

import { useEffect, useState } from 'react';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface ServicePayment {
  scheme: string;
  network: string;
  token: string;
  amount: string;
}

interface Service {
  key: string;
  state: 'active' | 'planned';
  displayName: string;
  description: string;
  payment?: ServicePayment;
}

function tonFromWei(weiStr: string): string {
  try {
    return (Number(BigInt(weiStr)) / 1e18).toFixed(4);
  } catch {
    return weiStr;
  }
}

function weiFromTon(ton: string): string {
  try {
    const val = parseFloat(ton);
    if (isNaN(val) || val < 0) throw new Error();
    return BigInt(Math.round(val * 1e18)).toString();
  } catch {
    throw new Error('Invalid TON amount');
  }
}

const STATE_STYLE: Record<string, { bg: string; text: string }> = {
  active: { bg: '#dcfce7', text: '#15803d' },
  planned: { bg: '#fef3c7', text: '#92400e' },
};

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editState, setEditState] = useState<'active' | 'planned'>('active');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function fetchServices() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/services`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchServices(); }, []);

  function startEdit(service: Service) {
    setEditingKey(service.key);
    setEditAmount(service.payment ? tonFromWei(service.payment.amount) : '0');
    setEditState(service.state);
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setSaveError(null);
  }

  async function saveEdit(key: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const amount = weiFromTon(editAmount);
      const res = await fetch(`${BASE_PATH}/api/admin/services/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, state: editState }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEditingKey(null);
      await fetchServices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          x402 Services
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Configure operational data services sold via x402 TON payment. Changes are reflected in{' '}
          <code style={{ fontSize: '12px', backgroundColor: '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>
            agent.json
          </code>{' '}
          immediately after save.
        </p>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: '20px',
          backgroundColor: '#fee2e2', border: '1px solid #fecaca',
          borderRadius: '6px', color: '#991b1b', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {/* Info box */}
      <div style={{
        padding: '14px 16px', marginBottom: '24px',
        backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: '6px', fontSize: '13px', color: '#1e40af',
      }}>
        <strong>How it works:</strong> Each service below is a pay-per-call API endpoint gated by
        x402 TON payment. Set the price in TON, toggle state to active/planned, and click Save.
        Buyers see the current catalog via{' '}
        <code style={{ fontSize: '11px', backgroundColor: '#dbeafe', padding: '1px 4px', borderRadius: '2px' }}>
          /api/agent-marketplace/agent.json
        </code>.
        {' '}Redis is required to persist overrides — without it, default prices are used.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading services...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {services.map((service) => {
            const isEditing = editingKey === service.key;
            const stateStyle = STATE_STYLE[service.state] ?? STATE_STYLE.planned;

            return (
              <div key={service.key} style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                overflow: 'hidden',
              }}>
                {/* Card header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '16px 20px',
                  borderBottom: isEditing ? '1px solid #e5e7eb' : 'none',
                  backgroundColor: isEditing ? '#f8fafc' : '#ffffff',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '600', color: '#111827' }}>
                        {service.displayName}
                      </span>
                      <span style={{
                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                        backgroundColor: stateStyle.bg, color: stateStyle.text,
                      }}>
                        {service.state}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 6px 0' }}>
                      {service.description}
                    </p>
                    <code style={{ fontSize: '11px', color: '#6b7280', backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '3px' }}>
                      {service.key}
                    </code>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: '24px', flexShrink: 0 }}>
                    {service.payment && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: '#111827' }}>
                          {tonFromWei(service.payment.amount)} TON
                        </div>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                          per call · {service.payment.network}
                        </div>
                      </div>
                    )}
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(service)}
                        style={{
                          padding: '7px 16px',
                          backgroundColor: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          color: '#374151',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e5e7eb')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div style={{ padding: '16px 20px', backgroundColor: '#f8fafc' }}>
                    {saveError && (
                      <div style={{
                        padding: '8px 12px', marginBottom: '12px',
                        backgroundColor: '#fee2e2', border: '1px solid #fecaca',
                        borderRadius: '4px', color: '#991b1b', fontSize: '13px',
                      }}>
                        {saveError}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                          Price (TON)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          disabled={saving}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px',
                            boxSizing: 'border-box',
                          }}
                        />
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px' }}>
                          = {(() => { try { return weiFromTon(editAmount); } catch { return '—'; } })()} wei
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                          State
                        </label>
                        <select
                          value={editState}
                          onChange={(e) => setEditState(e.target.value as 'active' | 'planned')}
                          disabled={saving}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="active">Active (buyers can purchase)</option>
                          <option value="planned">Planned (hidden from buyers)</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => saveEdit(service.key)}
                          disabled={saving}
                          style={{
                            padding: '8px 20px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.6 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: 'white',
                            color: '#374151',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '13px',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.6 : 1,
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
