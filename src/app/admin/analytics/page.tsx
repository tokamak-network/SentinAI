'use client';

import { useEffect, useState } from 'react';
import type { MarketplaceOrder } from '@/types/marketplace';

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  revenueByTier: Record<'trainee' | 'junior' | 'senior' | 'expert', number>;
  ordersByTier: Record<'trainee' | 'junior' | 'senior' | 'expert', number>;
  topAgents: Array<{ agentId: string; orders: number; revenue: number }>;
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalOrders: 0,
    totalRevenue: 0,
    revenueByTier: { trainee: 0, junior: 0, senior: 0, expert: 0 },
    ordersByTier: { trainee: 0, junior: 0, senior: 0, expert: 0 },
    topAgents: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch all orders to compute analytics
      const res = await fetch('/api/admin/orders?page=1&limit=1000');
      if (!res.ok) throw new Error('Failed to fetch orders');

      interface OrdersResponse {
        success: boolean;
        orders: MarketplaceOrder[];
        summary: { totalCount: number; totalRevenueInCents: number };
      }

      const data = (await res.json()) as OrdersResponse;
      const orders = data.orders || [];

      // Compute analytics
      const stats: AnalyticsData = {
        totalOrders: data.summary.totalCount,
        totalRevenue: data.summary.totalRevenueInCents,
        revenueByTier: { trainee: 0, junior: 0, senior: 0, expert: 0 },
        ordersByTier: { trainee: 0, junior: 0, senior: 0, expert: 0 },
        topAgents: [],
      };

      const agentStats = new Map<
        string,
        { orders: number; revenue: number }
      >();

      orders.forEach((order) => {
        // Revenue and order count by tier
        stats.revenueByTier[order.tier] += order.priceInCents;
        stats.ordersByTier[order.tier] += 1;

        // Agent stats
        if (!agentStats.has(order.agentId)) {
          agentStats.set(order.agentId, { orders: 0, revenue: 0 });
        }
        const agent = agentStats.get(order.agentId)!;
        agent.orders += 1;
        agent.revenue += order.priceInCents;
      });

      // Sort agents by revenue
      stats.topAgents = Array.from(agentStats.entries())
        .map(([agentId, stats]) => ({
          agentId,
          orders: stats.orders,
          revenue: stats.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      setAnalytics(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setIsLoading(false);
    }
  };

  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const tierInfo: Record<
    'trainee' | 'junior' | 'senior' | 'expert',
    { label: string; bg: string; text: string; color: string }
  > = {
    trainee: { label: 'Trainee', bg: '#dbeafe', text: '#1e40af', color: '#3b82f6' },
    junior: { label: 'Junior', bg: '#dcfce7', text: '#15803d', color: '#10b981' },
    senior: { label: 'Senior', bg: '#fed7aa', text: '#b45309', color: '#f59e0b' },
    expert: { label: 'Expert', bg: '#fce7f3', text: '#be185d', color: '#ec4899' },
  };

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Analytics
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Marketplace metrics and performance overview
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

      {/* Loading state */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading analytics...
        </div>
      ) : (
        <>
          {/* Key metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
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
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
                {analytics.totalOrders}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>All time</div>
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
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#059669', marginBottom: '8px' }}>
                {formatPrice(analytics.totalRevenue)}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>All time</div>
            </div>
          </div>

          {/* Revenue by tier */}
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0', color: '#111827' }}>
              Revenue by Tier
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {(Object.keys(tierInfo) as Array<'trainee' | 'junior' | 'senior' | 'expert'>).map((tier) => {
                const info = tierInfo[tier];
                const revenue = analytics.revenueByTier[tier];
                const percentage =
                  analytics.totalRevenue > 0 ? ((revenue / analytics.totalRevenue) * 100).toFixed(1) : '0';

                return (
                  <div
                    key={tier}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '16px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '500', color: '#6b7280', marginBottom: '8px' }}>
                      {info.label}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: info.text, marginBottom: '8px' }}>
                      {formatPrice(revenue)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {percentage}% of total • {analytics.ordersByTier[tier]} orders
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tier distribution bars */}
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0', color: '#111827' }}>
              Order Distribution
            </h2>
            {(Object.keys(tierInfo) as Array<'trainee' | 'junior' | 'senior' | 'expert'>).map((tier) => {
              const info = tierInfo[tier];
              const orders = analytics.ordersByTier[tier];
              const percentage =
                analytics.totalOrders > 0 ? ((orders / analytics.totalOrders) * 100).toFixed(1) : '0';

              return (
                <div key={tier} style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>{info.label}</span>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>
                      {orders} orders ({percentage}%)
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '24px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${percentage}%`,
                        backgroundColor: info.color,
                        transition: 'width 300ms ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Top agents */}
          {analytics.topAgents.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0', color: '#111827' }}>
                Top Agents
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                        Agent ID
                      </th>
                      <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                        Orders
                      </th>
                      <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                        Revenue
                      </th>
                      <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                        Avg Order Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topAgents.map((agent, index) => (
                      <tr
                        key={agent.agentId}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                        }}
                      >
                        <td
                          style={{
                            padding: '12px',
                            color: '#111827',
                            fontSize: '13px',
                            fontFamily: 'monospace',
                          }}
                        >
                          {agent.agentId.substring(0, 8)}...
                        </td>
                        <td style={{ padding: '12px', color: '#111827', fontSize: '13px', textAlign: 'right' }}>
                          {agent.orders}
                        </td>
                        <td style={{ padding: '12px', color: '#059669', fontSize: '13px', textAlign: 'right', fontWeight: '500' }}>
                          {formatPrice(agent.revenue)}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px', textAlign: 'right' }}>
                          {formatPrice(Math.round(agent.revenue / agent.orders))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {analytics.totalOrders === 0 && (
            <div
              style={{
                backgroundColor: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '32px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                No order data available yet
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                Analytics will appear once orders are created in the marketplace
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
