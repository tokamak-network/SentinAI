'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Session is already gated by middleware, so just mark as loaded
    setIsLoading(false);
  }, []);

  async function handleLogout() {
    await fetch(`${BASE_PATH}/api/admin/auth/logout`, { method: 'POST' });
    router.push('/admin/login');
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const navItems = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/catalog', label: 'Catalog' },
    { href: '/admin/pricing', label: 'Pricing' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/analytics', label: 'Analytics' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <header style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 700,
          color: '#111',
        }}>
          MARKETPLACE ADMIN
        </h1>
        <button
          onClick={handleLogout}
          style={{
            padding: '8px 16px',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          LOGOUT
        </button>
      </header>

      {/* Navigation */}
      <nav style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '0 24px',
        display: 'flex',
        gap: '32px',
      }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '12px 0',
                fontSize: '13px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#3b82f6' : '#666',
                textDecoration: 'none',
                borderBottom: isActive ? '2px solid #3b82f6' : 'none',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Content */}
      <main style={{
        padding: '24px',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        {children}
      </main>
    </div>
  );
}
