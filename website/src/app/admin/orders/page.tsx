'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Order {
  id: string;
  agentId: string;
  buyerAddress: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

const MONO_FONT = "'IBM Plex Mono', monospace";

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, [offset, limit]);

  async function loadOrders() {
    try {
      const res = await fetch(`/api/admin/orders?limit=${limit}&offset=${offset}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setOrders(data.orders);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusUpdate(orderId: string, newStatus: Order['status']) {
    setUpdatingOrder(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      loadOrders();
      setExpandedOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingOrder(null);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString();

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
              color: item.href === '/admin/orders' ? '#D40000' : '#333',
              textDecoration: 'none',
              borderBottom: item.href === '/admin/orders' ? '2px solid #D40000' : 'none',
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

        <div style={{ marginBottom: '12px', fontSize: '12px', color: '#666' }}>
          Total Orders: {total}
        </div>

        {loading ? (
          <div>Loading orders...</div>
        ) : (
          <div style={{
            background: 'white',
            border: '1px solid #D0D0D0',
            borderRadius: '2px',
          }}>
            {orders.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#888', fontSize: '12px' }}>
                No orders yet
              </div>
            ) : (
              <div>
                {orders.map((order) => (
                  <div key={order.id} style={{ borderBottom: '1px solid #E0E0E0' }}>
                    <div
                      style={{
                        padding: '16px',
                        cursor: 'pointer',
                        background: expandedOrder === order.id ? '#FAFAFA' : 'white',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                      onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                          Order: {order.id}
                        </div>
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          {formatPrice(order.amount)} · {order.tier.toUpperCase()} · {formatDate(order.createdAt)}
                        </div>
                      </div>
                      <span style={{
                        background: order.status === 'completed'
                          ? '#E8F8E8'
                          : order.status === 'pending'
                            ? '#F8F5E8'
                            : '#F8E8E8',
                        color: order.status === 'completed'
                          ? '#27ae60'
                          : order.status === 'pending'
                            ? '#E67E22'
                            : '#D40000',
                        padding: '4px 8px',
                        fontSize: '10px',
                        fontWeight: 700,
                      }}>
                        {order.status.toUpperCase()}
                      </span>
                    </div>
                    {expandedOrder === order.id && (
                      <div style={{
                        padding: '16px',
                        background: '#FAFAFA',
                        borderTop: '1px solid #E0E0E0',
                        fontSize: '12px',
                      }}>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ color: '#888', marginBottom: '4px' }}>Buyer Address</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                            {order.buyerAddress}
                          </div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ color: '#888', marginBottom: '4px' }}>Agent ID</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            {order.agentId}
                          </div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ color: '#888', marginBottom: '4px' }}>Updated</div>
                          <div style={{ fontSize: '11px' }}>{formatDate(order.updatedAt)}</div>
                        </div>
                        <div style={{
                          display: 'flex',
                          gap: '8px',
                          borderTop: '1px solid #E0E0E0',
                          paddingTop: '12px',
                        }}>
                          {(['pending', 'completed', 'failed'] as const).map((status) => (
                            <button
                              key={status}
                              onClick={() => handleStatusUpdate(order.id, status)}
                              disabled={updatingOrder === order.id || order.status === status}
                              style={{
                                background: order.status === status ? '#D40000' : '#E8E8E8',
                                color: order.status === status ? 'white' : '#333',
                                border: '1px solid #D0D0D0',
                                padding: '4px 8px',
                                fontSize: '10px',
                                fontWeight: 700,
                                cursor: updatingOrder === order.id || order.status === status ? 'not-allowed' : 'pointer',
                                fontFamily: MONO_FONT,
                              }}
                            >
                              {status.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            style={{
              background: offset === 0 ? '#E8E8E8' : '#D40000',
              color: offset === 0 ? '#999' : 'white',
              border: 'none',
              padding: '8px 16px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: offset === 0 ? 'not-allowed' : 'pointer',
              fontFamily: MONO_FONT,
            }}
          >
            PREVIOUS
          </button>
          <span style={{ padding: '8px 16px', fontSize: '11px', color: '#666' }}>
            Page {Math.floor(offset / limit) + 1}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            style={{
              background: offset + limit >= total ? '#E8E8E8' : '#D40000',
              color: offset + limit >= total ? '#999' : 'white',
              border: 'none',
              padding: '8px 16px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: offset + limit >= total ? 'not-allowed' : 'pointer',
              fontFamily: MONO_FONT,
            }}
          >
            NEXT
          </button>
        </div>
      </div>
    </main>
  );
}
