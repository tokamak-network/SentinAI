'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type LoginState = 'idle' | 'connecting' | 'signing' | 'verifying' | 'error' | 'success';

const MONO_FONT = "'IBM Plex Mono', monospace";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/v2/marketplace';

  const [state, setState] = useState<LoginState>('idle');
  const [error, setError] = useState<string>('');
  const [address, setAddress] = useState<string>('');

  async function handleConnect() {
    setState('connecting');
    setError('');

    // Step 1: Check if MetaMask is available
    const provider = (window as any).ethereum;
    if (!provider) {
      setError('MetaMask or compatible wallet not detected. Please install MetaMask.');
      setState('error');
      return;
    }

    try {
      // Step 2: Request account access
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const userAddress = accounts[0];
      setAddress(userAddress);
      setState('signing');

      // Step 3: Get nonce from server
      const nonceRes = await fetch(`${BASE_PATH}/api/auth/siwe/nonce?address=${userAddress}`);
      if (!nonceRes.ok) {
        throw new Error('Failed to get nonce from server');
      }

      const { nonce } = (await nonceRes.json()) as { nonce: string };

      // Step 4: Build SIWE message (EIP-4361 compliant)
      const issuedAt = new Date().toISOString();

      const message = [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        userAddress,
        '',
        'Please sign this message to verify ownership of your wallet and authenticate to the SentinAI marketplace.',
        '',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      // Step 5: Request signature
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [message, userAddress],
      })) as string;

      setState('verifying');

      // Step 6: Verify on server
      const verifyRes = await fetch(`${BASE_PATH}/api/auth/siwe/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: userAddress,
          signature,
          message,
        }),
      });

      if (!verifyRes.ok) {
        const errorData = (await verifyRes.json()) as { error: string };
        throw new Error(errorData.error || 'Verification failed');
      }

      setState('success');
      // Redirect after brief success display
      setTimeout(() => {
        // Validate callback URL before redirect
        if (!isValidCallbackUrl(callbackUrl)) {
          setError('Invalid callback URL');
          setState('error');
          return;
        }
        router.push(callbackUrl);
      }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
    }
  }

  // Validate callback URL using whitelist approach
  const isValidCallbackUrl = (url: string): boolean => {
    if (!url.startsWith('/')) return false;

    // Whitelist of safe paths
    const allowedPaths = [
      '/',
      '/v2/marketplace',
      '/v2/marketplace/',
      '/admin',
      '/admin/',
    ];

    // Check if URL matches any allowed path or starts with allowed prefix
    return allowedPaths.some(path =>
      url === path || url.startsWith(path + '/'),
    );
  };

  const isLoading = state === 'connecting' || state === 'signing' || state === 'verifying';
  const isError = state === 'error';
  const isSuccess = state === 'success';

  return (
    <main style={{
      minHeight: '100vh',
      background: '#F0F0F0',
      padding: '40px 20px',
      fontFamily: MONO_FONT,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        maxWidth: '500px',
        width: '100%',
        border: '1px solid #C0C0C0',
        background: '#FFFFFF',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{
          borderBottom: '2px solid #8B0000',
          background: '#D40000',
          color: 'white',
          padding: '12px 16px',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          SentinAI Marketplace Admin
        </div>

        {/* Content */}
        <div style={{
          padding: '40px',
          minHeight: '280px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '20px',
        }}>
          {/* Status Messages */}
          {isError && (
            <div style={{
              background: '#FFF8F8',
              border: '1px solid #D0D0D0',
              padding: '12px',
              fontSize: '12px',
              color: '#D40000',
              borderRadius: '2px',
            }}>
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>Error</div>
              <div>{error}</div>
            </div>
          )}

          {isSuccess && (
            <div style={{
              background: '#F0FFF0',
              border: '1px solid #D0D0D0',
              padding: '12px',
              fontSize: '12px',
              color: '#27ae60',
              borderRadius: '2px',
              textAlign: 'center',
            }}>
              ✓ Signed in successfully. Redirecting...
            </div>
          )}

          {!isSuccess && (
            <>
              {/* Description */}
              <div style={{ fontSize: '12px', color: '#555', lineHeight: '1.6' }}>
                {state === 'idle' && (
                  <>
                    <p>Connect your Ethereum wallet to access the marketplace admin panel.</p>
                    <p style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                      Only the marketplace operator account can access this page.
                    </p>
                  </>
                )}
                {state === 'connecting' && 'Connecting wallet...'}
                {state === 'signing' && 'Sign the message in your wallet...'}
                {state === 'verifying' && 'Verifying signature...'}
              </div>

              {/* Address Display */}
              {address && (
                <div style={{
                  background: '#FAFAFA',
                  border: '1px solid #D0D0D0',
                  padding: '8px 12px',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                  color: '#0055AA',
                }}>
                  <div style={{ color: '#888', marginBottom: '4px' }}>Address:</div>
                  {address}
                </div>
              )}

              {/* Connect Button */}
              <button
                onClick={handleConnect}
                disabled={isLoading}
                style={{
                  background: isLoading ? '#A9A9A9' : '#D40000',
                  color: 'white',
                  border: isLoading ? 'none' : '2px solid #8B0000',
                  padding: '12px 20px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.7 : 1,
                  fontFamily: MONO_FONT,
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#8B0000';
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = '#D40000';
                }}
              >
                {isLoading ? '⏳ LOADING...' : '🔗 CONNECT WALLET'}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #E8E8E8',
          background: '#FAFAFA',
          padding: '12px 16px',
          fontSize: '10px',
          color: '#888',
          textAlign: 'center',
        }}>
          Powered by SentinAI | MetaMask Required
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
