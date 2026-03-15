'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function isValidSessionTokenClient(token: string): boolean {
  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'satv2') return false;
    const expiresAtStr = parts[3];
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already logged in
  useEffect(() => {
    const sessionToken = document.cookie
      .split('; ')
      .find((row) => row.startsWith('sentinai_admin_session='))
      ?.split('=')[1];

    if (sessionToken && isValidSessionTokenClient(sessionToken)) {
      // Already logged in, redirect to admin dashboard
      router.push('/admin');
    }
  }, [router]);

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);

    try {
      // 1. Request MetaMask account
      if (!window.ethereum) {
        throw new Error('MetaMask not installed');
      }

      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found');
      }

      const address = accounts[0];

      // 2. Create message to sign
      const message = 'Sign in to SentinAI Marketplace Admin';

      // 3. Request signature
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;

      // 4. Send to backend for verification
      const response = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message }),
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }

      // 5. Redirect to admin
      router.push('/admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f5f5f5',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        padding: '40px 24px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <h1 style={{
          fontSize: '18px',
          fontWeight: 700,
          marginBottom: '8px',
          color: '#333',
        }}>
          Admin Login
        </h1>

        <p style={{
          fontSize: '14px',
          color: '#666',
          marginBottom: '24px',
          lineHeight: '1.5',
        }}>
          Connect your MetaMask wallet to access the marketplace admin panel.
        </p>

        {error && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '4px',
            color: '#c33',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={isConnecting}
          style={{
            width: '100%',
            padding: '12px',
            background: isConnecting ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: isConnecting ? 'not-allowed' : 'pointer',
          }}
        >
          {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
        </button>
      </div>
    </main>
  );
}
