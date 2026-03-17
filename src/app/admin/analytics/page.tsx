'use client';

import { useEffect, useState } from 'react';
import type { MarketplaceOrder } from '@/types/marketplace';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  revenueByBracket: Record<string, number>;
  ordersByBracket: Record<string, number>;
  scoreDistribution: number[]; // 10 buckets: 0-9, 10-19, ..., 90-100
  topAgents: Array<{ agentId: string; orders: number; revenue: number; avgScore: number }>;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#3b82f6';
  if (score >= 60) return '#10b981';
  if (score >= 30) return '#f59e0b';
  return '#ef4444';
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalOrders: 0,
    totalRevenue: 0,
    revenueByBracket: {},
    ordersByBracket: {},
    scoreDistribution: Array(10).fill(0),
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
      const res = await fetch(`${BASE_PATH}/api/admin/orders?page=1&limit=1000`);
      if (!res.ok) throw new Error('Failed to fetch orders');

      interface OrdersResponse {
        success: boolean;
        orders: MarketplaceOrder[];
        summary: { totalCount: number; totalRevenueInCents: number };
      }

      const data = (await res.json()) as OrdersResponse;
      const orders = data.orders || [];

      const stats: AnalyticsData = {
        totalOrders: data.summary.totalCount,
        totalRevenue: data.summary.totalRevenueInCents,
        revenueByBracket: {},
        ordersByBracket: {},
        scoreDistribution: Array(10).fill(0),
        topAgents: [],
      };

      const agentStats = new Map<
        string,
        { orders: number; revenue: number; totalScore: number }
      >();

      orders.forEach((order) => {
        const bracket = order.bracketLabel || 'Unknown';

        // Revenue and order count by bracket
        stats.revenueByBracket[bracket] = (stats.revenueByBracket[bracket] || 0) + order.priceInCents;
        stats.ordersByBracket[bracket] = (stats.ordersByBracket[bracket] || 0) + 1;

        // Score distribution (10-point buckets)
        const bucket = Math.min(9, Math.floor(order.opsScoreAtPurchase / 10));
        stats.scoreDistribution[bucket]++;

        // Agent stats
        if (!agentStats.has(order.agentId)) {
          agentStats.set(order.agentId, { orders: 0, revenue: 0, totalScore: 0 });
        }
        const agent = agentStats.get(order.agentId)!;
        agent.orders += 1;
        agent.revenue += order.priceInCents;
        agent.totalScore += order.opsScoreAtPurchase;
      });

      stats.topAgents = Array.from(agentStats.entries())
        .map(([agentId, s]) => ({
          agentId,
          orders: s.orders,
          revenue: s.revenue,
          avgScore: Math.round(s.totalScore / s.orders),
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

  const bracketColors: Record<string, string> = {
    Expert: '#3b82f6',
    Advanced: '#10b981',
    Standard: '#f59e0b',
    Starter: '#6b7280',
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

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading analytics...
        </div>
      ) : (
        <>
          {/* Key metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
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

          {/* Revenue by bracket */}
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0', color: '#111827' }}>
              Revenue by Bracket
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {Object.entries(analytics.revenueByBracket).map(([bracket, revenue]) => {
                const percentage =
                  analytics.totalRevenue > 0 ? ((revenue / analytics.totalRevenue) * 100).toFixed(1) : '0';
                const color = bracketColors[bracket] ?? '#6b7280';
                const orderCount = analytics.ordersByBracket[bracket] ?? 0;

                return (
                  <div
                    key={bracket}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '16px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '500', color: '#6b7280', marginBottom: '8px' }}>
                      {bracket}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '700', color, marginBottom: '8px' }}>
                      {formatPrice(revenue)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {percentage}% of total &bull; {orderCount} orders
                    </div>
                  </div>
                );
              })}
              {Object.keys(analytics.revenueByBracket).length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: '13px' }}>No bracket data yet</div>
              )}
            </div>
          </div>

          {/* Score Distribution */}
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0', color: '#111827' }}>
              Score Distribution
            </h2>
            {analytics.scoreDistribution.map((count, i) => {
              const label = `${i * 10}-${i * 10 + 9}`;
              const maxCount = Math.max(...analytics.scoreDistribution, 1);
              const percentage = ((count / maxCount) * 100).toFixed(0);
              const midScore = i * 10 + 5;

              return (
                <div key={i} style={{ marginBottom: '8px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: '500', color: '#374151', minWidth: '50px' }}>
                      {label}
                    </span>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      {count} orders
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '16px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${percentage}%`,
                        backgroundColor: getScoreColor(midScore),
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
                        Ops Score
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
                        <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right' }}>
                          <span style={{ fontWeight: '500', color: getScoreColor(agent.avgScore) }}>
                            {agent.avgScore}
                          </span>
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
