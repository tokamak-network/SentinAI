'use client';

import { useEffect, useState } from 'react';
import type { MarketplaceOrder } from '@/types/marketplace';

interface OrdersResponse {
  success: boolean;
  orders: MarketplaceOrder[];
  summary: {
    totalCount: number;
    totalRevenueInCents: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [summary, setSummary] = useState<{ totalCount: number; totalRevenueInCents: number }>({
    totalCount: 0,
    totalRevenueInCents: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch orders on mount and when page/limit changes
  useEffect(() => {
    fetchOrders();
  }, [currentPage, limit]);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: String(limit) });
      const res = await fetch(`/api/admin/orders?${params}`);
      if (!res.ok) throw new Error('Failed to fetch orders');

      const data = (await res.json()) as OrdersResponse;
      setOrders(data.orders || []);
      setSummary(data.summary);
      setTotalPages(Math.ceil(data.pagination.total / limit));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orders');
    } finally {
      setIsLoading(false);
    }
  };

  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const tierColors: Record<string, { bg: string; text: string }> = {
    trainee: { bg: '#dbeafe', text: '#1e40af' },
    junior: { bg: '#dcfce7', text: '#15803d' },
    senior: { bg: '#fed7aa', text: '#b45309' },
    expert: { bg: '#fce7f3', text: '#be185d' },
  };

  const filteredOrders = orders.filter(
    (order) =>
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.agentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.buyerAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Orders
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          View and manage marketplace orders ({summary.totalCount} total)
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '20px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            color: '#991b1b',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        {/* Total Orders */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#6b7280', marginBottom: '8px' }}>
            Total Orders
          </div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827' }}>
            {summary.totalCount}
          </div>
        </div>

        {/* Total Revenue */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#6b7280', marginBottom: '8px' }}>
            Total Revenue
          </div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#059669' }}>
            {formatPrice(summary.totalRevenueInCents)}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by order ID, agent ID, or buyer address..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
          }}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Orders Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading orders...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          {orders.length === 0 ? 'No orders found.' : 'No matching orders found.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Order ID
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Agent ID
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Buyer Address
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Tier
                </th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Price
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Created At
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  style={{
                    borderBottom: '1px solid #e5e7eb',
                    backgroundColor: '#ffffff',
                    transition: 'background-color 200ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }}
                >
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px', fontFamily: 'monospace' }}>
                    {order.id.substring(0, 8)}...
                  </td>
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px', fontFamily: 'monospace' }}>
                    {order.agentId.substring(0, 8)}...
                  </td>
                  <td style={{ padding: '12px', color: '#111827', fontSize: '12px', fontFamily: 'monospace' }}>
                    {order.buyerAddress.substring(0, 10)}...
                  </td>
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        backgroundColor: tierColors[order.tier].bg,
                        color: tierColors[order.tier].text,
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        textTransform: 'capitalize',
                      }}
                    >
                      {order.tier}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: '#059669', fontSize: '13px', textAlign: 'right', fontWeight: '500' }}>
                    {formatPrice(order.priceInCents)}
                  </td>
                  <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px' }}>
                    {formatDate(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination controls */}
      {!isLoading && filteredOrders.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Page {currentPage} of {totalPages}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1 || isLoading}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                color: currentPage === 1 ? '#9ca3af' : '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>

            <select
              value={limit}
              onChange={(e) => {
                setLimit(parseInt(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                padding: '8px 12px',
                backgroundColor: '#ffffff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              <option value={10}>10 per page</option>
              <option value={20}>20 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages || isLoading}
              style={{
                padding: '8px 12px',
                backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
                color: currentPage === totalPages ? '#9ca3af' : '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
