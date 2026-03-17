'use client';

import { useRouter } from 'next/navigation';

export default function AdminDashboard() {
  const router = useRouter();

  const cards = [
    {
      title: 'Catalog',
      description: 'Manage agents & ops scores',
      count: '0 agents',
      link: '/admin/catalog',
      icon: '📦',
    },
    {
      title: 'Pricing',
      description: 'Manage pricing brackets',
      count: 'Score-based brackets',
      link: '/admin/pricing',
      icon: '💰',
    },
    {
      title: 'Orders',
      description: 'View transactions',
      count: '0 orders',
      link: '/admin/orders',
      icon: '📊',
    },
    {
      title: 'Analytics',
      description: 'View analytics',
      count: 'Revenue data',
      link: '/admin/analytics',
      icon: '📈',
    },
    {
      title: 'Registry',
      description: 'ERC8004 registration',
      count: 'On-chain registry',
      link: '/admin/registry',
      icon: '📋',
    },
    {
      title: 'Services',
      description: 'x402 service catalog & pricing',
      count: '3 services',
      link: '/admin/services',
      icon: '🛒',
    },
    {
      title: 'Settlements',
      description: 'x402 payment settlements',
      count: 'TON payment records',
      link: '/admin/settlements',
      icon: '💳',
    },
  ];

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Marketplace Admin
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Manage your marketplace operations
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
          marginBottom: '40px',
        }}
      >
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={() => router.push(card.link)}
            style={{
              padding: '24px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              cursor: 'pointer',
              transition: 'all 200ms',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3b82f6';
              e.currentTarget.style.boxShadow =
                '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div style={{ fontSize: '28px', marginRight: '12px' }}>{card.icon}</div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 4px 0', color: '#111827' }}>
                  {card.title}
                </h2>
                <p style={{ fontSize: '13px', color: '#6b7280', margin: '0' }}>{card.description}</p>
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                marginBottom: '12px',
              }}
            >
              <p style={{ fontSize: '14px', fontWeight: '500', color: '#374151', margin: '0' }}>
                {card.count}
              </p>
            </div>

            <button
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '500',
                color: '#374151',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#e5e7eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }}
            >
              Go to {card.title} →
            </button>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '20px',
          backgroundColor: '#f0f9ff',
          border: '1px solid #bfdbfe',
          borderRadius: '8px',
          color: '#0c4a6e',
          fontSize: '13px',
        }}
      >
        <p style={{ margin: '0' }}>
          <strong>Quick Start:</strong> Begin by managing your agent catalog. Each agent is scored
          based on operational data and priced according to score brackets.
        </p>
      </div>
    </div>
  );
}
