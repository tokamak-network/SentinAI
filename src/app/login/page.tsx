'use client';

import { useState, useEffect, useRef } from 'react';

type AuthState = 'idle' | 'connecting' | 'signing' | 'verifying' | 'error' | 'success';

interface ExtendedWindow extends Window {
  ethereum?: {
    request: (args: {
      method: string;
      params?: unknown[];
    }) => Promise<unknown>;
  };
}

export default function LoginPage() {
  const [state, setState] = useState<AuthState>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleConnect = async () => {
    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }

    try {
      setError(null);
      setState('connecting');

      const extWindow = window as ExtendedWindow;

      // Step 1: Check MetaMask installation
      if (!extWindow.ethereum) {
        setError('MetaMask not detected. Please install MetaMask.');
        setState('error');
        return;
      }

      // Step 2: Request wallet accounts
      let accounts: unknown[];
      try {
        accounts = (await extWindow.ethereum.request({
          method: 'eth_requestAccounts',
        })) as unknown[];
      } catch (walletError) {
        const errMsg = walletError instanceof Error ? walletError.message : String(walletError);
        if (errMsg.includes('user rejected')) {
          setError('Wallet connection rejected.');
        } else {
          setError(`Wallet connection failed: ${errMsg}`);
        }
        setState('error');
        return;
      }

      if (!accounts || accounts.length === 0) {
        setError('No accounts found in MetaMask.');
        setState('error');
        return;
      }

      const address = String(accounts[0]);

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        setError('Invalid wallet address format.');
        setState('error');
        return;
      }

      setState('signing');

      // Step 3: Request nonce from server
      const nonceRes = await fetch(`/api/auth/siwe/nonce?address=${address}`, {
        method: 'GET',
      });

      if (!nonceRes.ok) {
        const nonceErrBody = await nonceRes.json() as { error?: string };
        setError(
          `Failed to get nonce: ${nonceErrBody.error || 'Unknown error'}`
        );
        setState('error');
        return;
      }

      const nonceData = (await nonceRes.json()) as { nonce: string };
      const nonce = nonceData.nonce;

      // Step 4: Construct SIWE message
      const issuedAt = new Date().toISOString();
      const siweMessage = [
        'wallet.sentinai.io wants you to sign in with your Ethereum account:',
        address,
        '',
        'Version: 1',
        'Chain ID: 1',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      // Step 5: Sign message with MetaMask
      let signature: string;
      try {
        signature = (await extWindow.ethereum.request({
          method: 'personal_sign',
          params: [siweMessage, address],
        })) as string;
      } catch (signError) {
        const errMsg = signError instanceof Error ? signError.message : String(signError);
        if (errMsg.includes('user rejected')) {
          setError('Message signing rejected.');
        } else {
          setError(`Message signing failed: ${errMsg}`);
        }
        setState('error');
        return;
      }

      if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
        setError('Invalid signature format.');
        setState('error');
        return;
      }

      setState('verifying');

      // Step 6: Verify signature with server
      const verifyRes = await fetch('/api/auth/siwe/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address,
          message: siweMessage,
          signature,
        }),
      });

      if (!verifyRes.ok) {
        const verifyErrBody = await verifyRes.json() as { error?: string };
        if (verifyRes.status === 403) {
          setError('Not authorized. Only admin wallet can sign in.');
        } else {
          setError(
            `Verification failed: ${verifyErrBody.error || 'Unknown error'}`
          );
        }
        setState('error');
        return;
      }

      setState('success');

      // Step 7: Redirect to callback URL or default
      const searchParams = new URLSearchParams(window.location.search);
      const callbackUrl = searchParams.get('callbackUrl');
      const redirectPath =
        callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/v2/marketplace';

      setTimeout(() => {
        window.location.href = redirectPath;
      }, 500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Unexpected error: ${errMsg}`);
      setState('error');
    }
  };

  const getStatusMessage = (): string => {
    switch (state) {
      case 'idle':
        return 'Connect your Ethereum wallet to sign in.';
      case 'connecting':
        return 'Connecting to wallet...';
      case 'signing':
        return 'Sign the message to authenticate...';
      case 'verifying':
        return 'Verifying signature...';
      case 'success':
        return 'Authentication successful. Redirecting...';
      case 'error':
        return error || 'An error occurred.';
      default:
        return '';
    }
  };

  const isLoading = state === 'connecting' || state === 'signing' || state === 'verifying';
  const showRetry = state === 'error';

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white" style={{ fontFamily: "'Monaco', 'Courier New', monospace" }}>
      <div
        className="mx-auto max-w-md border border-white bg-black p-8"
        style={{
          borderWidth: '1px',
          boxShadow: '0 0 0 1px #333',
        }}
      >
        {/* Header */}
        <div className="mb-8 border-b border-white pb-6">
          <h1
            className="mb-2 text-sm font-bold tracking-widest text-white"
            style={{ letterSpacing: '0.1em' }}
          >
            SIWE AUTHENTICATION
          </h1>
          <p
            className="text-xs text-gray-400"
            style={{ letterSpacing: '0.05em' }}
          >
            Sign in with your Ethereum wallet
          </p>
        </div>

        {/* Status Display */}
        <div className="mb-8 min-h-[100px]">
          {state === 'error' ? (
            <div
              className="border border-red-600 bg-red-900 bg-opacity-20 p-4 text-sm"
              style={{
                borderColor: '#D40000',
                backgroundColor: 'rgba(212, 0, 0, 0.1)',
              }}
            >
              <p style={{ color: '#D40000', fontWeight: 'bold', marginBottom: '4px' }}>
                ERROR
              </p>
              <p className="text-red-200" style={{ color: '#ff6b6b', fontSize: '12px' }}>
                {error}
              </p>
            </div>
          ) : state === 'success' ? (
            <div
              className="border border-green-600 bg-green-900 bg-opacity-20 p-4 text-sm"
              style={{
                borderColor: '#00AA00',
                backgroundColor: 'rgba(0, 170, 0, 0.1)',
              }}
            >
              <p style={{ color: '#00AA00', fontWeight: 'bold' }}>
                SUCCESS
              </p>
              <p style={{ color: '#00AA00', fontSize: '12px', marginTop: '4px' }}>
                {getStatusMessage()}
              </p>
            </div>
          ) : (
            <div className="border border-gray-600 bg-gray-900 bg-opacity-20 p-4 text-sm">
              <p style={{ color: '#999', fontSize: '12px', lineHeight: '1.6' }}>
                {getStatusMessage()}
              </p>
              {isLoading && (
                <div className="mt-2 flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full bg-gray-400 animate-pulse"
                    style={{ animation: 'pulse 1.5s infinite' }}
                  />
                  <span style={{ color: '#999', fontSize: '11px' }}>Processing...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Button */}
        {state === 'idle' || showRetry ? (
          <button
            onClick={handleConnect}
            disabled={isLoading}
            className="w-full border border-white bg-black px-4 py-3 text-sm font-bold tracking-widest text-white transition-colors hover:bg-white hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              letterSpacing: '0.1em',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {showRetry ? 'RETRY' : 'CONNECT WALLET'}
          </button>
        ) : (
          <button
            disabled
            className="w-full border border-gray-600 bg-black px-4 py-3 text-sm font-bold tracking-widest text-gray-600"
            style={{
              letterSpacing: '0.1em',
              cursor: 'not-allowed',
              opacity: 0.5,
            }}
          >
            {state === 'connecting'
              ? 'CONNECTING...'
              : state === 'signing'
                ? 'SIGNING...'
                : state === 'verifying'
                  ? 'VERIFYING...'
                  : 'REDIRECTING...'}
          </button>
        )}

        {/* Footer */}
        <div className="mt-8 border-t border-gray-600 pt-6 text-center">
          <p style={{ fontSize: '11px', color: '#999', letterSpacing: '0.05em' }}>
            Powered by Sign-In with Ethereum (SIWE)
          </p>
        </div>
      </div>

      {/* CSS for animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </main>
  );
}
