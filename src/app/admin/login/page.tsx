'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type LoginState = 'idle' | 'connecting' | 'signing' | 'verifying' | 'error' | 'success';

function isValidSessionTokenClient(token: string): boolean {
  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'satv2') return false;
    const expiresAt = parseInt(parts[3], 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
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
  const [state, setState] = useState<LoginState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    const sessionToken = document.cookie
      .split('; ')
      .find((row) => row.startsWith('sentinai_admin_session='))
      ?.split('=')[1];

    if (sessionToken && isValidSessionTokenClient(sessionToken)) {
      router.push('/admin');
    }
  }, [router]);

  async function handleConnect() {
    setState('connecting');
    setError(null);

    if (!window.ethereum) {
      setError('MetaMask or compatible wallet not detected.');
      setState('error');
      return;
    }

    try {
      // 1. Request wallet account
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const userAddress = accounts[0];
      setAddress(userAddress);
      setState('signing');

      // 2. Get nonce from server
      const nonceRes = await fetch(`${BASE_PATH}/api/auth/siwe/nonce?address=${userAddress}`);
      if (!nonceRes.ok) {
        throw new Error('Failed to get nonce from server');
      }
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      // 3. Build SIWE message with nonce
      const issuedAt = new Date().toISOString();
      const message = [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        userAddress,
        '',
        'Sign in to SentinAI Admin Dashboard.',
        '',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      // 4. Request signature
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userAddress],
      })) as string;

      setState('verifying');

      // 5. Verify on server
      const verifyRes = await fetch(`${BASE_PATH}/api/auth/siwe/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: userAddress, signature, message }),
      });

      if (!verifyRes.ok) {
        const data = (await verifyRes.json()) as { error?: string };
        throw new Error(data.error || 'Verification failed');
      }

      setState('success');
      setTimeout(() => router.push('/admin'), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  }

  const isLoading = state === 'connecting' || state === 'signing' || state === 'verifying';

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#F0F0F0',
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      <div style={{
        width: '100%',
        maxWidth: '460px',
        border: '1px solid #C0C0C0',
        background: '#FFFFFF',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}>
        <div style={{
          borderBottom: '2px solid #8B0000',
          background: '#D40000',
          color: 'white',
          padding: '12px 16px',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}>
          SENTINAI ADMIN LOGIN
        </div>

        <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {state === 'success' && (
            <div style={{
              background: '#F0FFF0',
              border: '1px solid #C8E6C9',
              padding: '12px',
              fontSize: '12px',
              color: '#27ae60',
              textAlign: 'center',
            }}>
              Signed in successfully. Redirecting...
            </div>
          )}

          {error && (
            <div style={{
              background: '#FFF8F8',
              border: '1px solid #FFCDD2',
              padding: '12px',
              fontSize: '12px',
              color: '#D40000',
            }}>
              {error}
            </div>
          )}

          {state !== 'success' && (
            <>
              <div style={{ fontSize: '12px', color: '#555', lineHeight: '1.6' }}>
                {state === 'idle' && 'Connect your wallet to access the admin dashboard.'}
                {state === 'connecting' && 'Connecting wallet...'}
                {state === 'signing' && 'Sign the message in your wallet...'}
                {state === 'verifying' && 'Verifying signature...'}
              </div>

              {address && (
                <div style={{
                  background: '#FAFAFA',
                  border: '1px solid #D0D0D0',
                  padding: '8px 12px',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                  color: '#0055AA',
                }}>
                  {address}
                </div>
              )}

              <button
                onClick={handleConnect}
                disabled={isLoading}
                style={{
                  background: isLoading ? '#A9A9A9' : '#D40000',
                  color: 'white',
                  border: isLoading ? 'none' : '2px solid #8B0000',
                  padding: '12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                {isLoading ? 'LOADING...' : 'CONNECT WALLET'}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
