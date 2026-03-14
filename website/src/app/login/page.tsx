'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { generateSiweMessage } from '@/lib/siwe-session';

type AuthState = 'idle' | 'connecting' | 'signing' | 'verifying' | 'error';

const FONT = "'IBM Plex Mono', monospace";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/v2/marketplace';

  const [state, setState] = useState<AuthState>('idle');
  const [error, setError] = useState<string>('');
  const [address, setAddress] = useState<string>('');

  useEffect(() => {
    // Check if already authenticated
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/siwe/nonce?address=0x' + '0'.repeat(40), {
          method: 'GET',
        });
        if (response.ok) {
          // Just testing the endpoint availability
        }
      } catch (err) {
        // Endpoint not available, continue with login flow
      }
    };
    checkSession();
  }, []);

  const handleConnect = async () => {
    setError('');
    setState('connecting');

    try {
      // Check if MetaMask is available
      if (!window.ethereum) {
        setError('MetaMask not detected. Please install MetaMask wallet.');
        setState('error');
        return;
      }

      // Request account access
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        setError('No accounts available');
        setState('error');
        return;
      }

      const userAddress = accounts[0];
      setAddress(userAddress);

      // Get nonce
      const nonceResponse = await fetch(
        `/api/auth/siwe/nonce?address=${userAddress}`
      );

      if (!nonceResponse.ok) {
        const data = await nonceResponse.json();
        throw new Error(data.error || 'Failed to get nonce');
      }

      const { nonce } = (await nonceResponse.json());

      // Generate SIWE message
      const message = generateSiweMessage(userAddress as `0x${string}`, nonce);

      // Sign message
      setState('signing');
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userAddress],
      })) as string;

      // Verify signature
      setState('verifying');
      const verifyResponse = await fetch('/api/auth/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: userAddress,
          nonce,
          message,
          signature,
        }),
      });

      if (!verifyResponse.ok) {
        const data = await verifyResponse.json();
        throw new Error(data.error || 'Verification failed');
      }

      // Authenticated successfully
      router.push(callbackUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      setState('error');
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'connecting':
        return 'Connecting wallet...';
      case 'signing':
        return 'Sign the message in MetaMask...';
      case 'verifying':
        return 'Verifying signature...';
      case 'error':
        return 'Authentication failed';
      default:
        return 'Click below to connect your wallet';
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#FFFFFF',
      fontFamily: FONT,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: '40px',
        border: '1px solid #D0D0D0',
        background: '#FFFFFF',
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '32px',
        }}>
          <div style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#D40000',
            marginBottom: '8px',
            letterSpacing: '0.05em',
          }}>
            SENTINAI
          </div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#707070',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Admin Authentication
          </div>
        </div>

        {/* Status */}
        <div style={{
          background: state === 'error' ? '#FFF0F0' : '#F7F7F7',
          border: `1px solid ${state === 'error' ? '#FFD0D0' : '#E0E0E0'}`,
          padding: '16px',
          marginBottom: '24px',
          fontSize: 9,
          fontWeight: 500,
          color: state === 'error' ? '#D40000' : '#707070',
          textAlign: 'center',
          letterSpacing: '0.05em',
        }}>
          {getStatusText()}
        </div>

        {/* Address display */}
        {address && (
          <div style={{
            background: '#F7F7F7',
            padding: '12px',
            marginBottom: '24px',
            fontSize: 8,
            fontWeight: 600,
            color: '#3A3A3A',
            wordBreak: 'break-all',
            border: '1px solid #E0E0E0',
          }}>
            {address}
          </div>
        )}

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={state !== 'idle' && state !== 'error'}
          style={{
            width: '100%',
            padding: '12px',
            background: state === 'error' ? '#8B0000' : '#D40000',
            color: 'white',
            border: 'none',
            fontFamily: FONT,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: state !== 'idle' && state !== 'error' ? 'wait' : 'pointer',
            opacity: state !== 'idle' && state !== 'error' ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (state === 'idle' || state === 'error') {
              e.currentTarget.style.background = '#8B0000';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = state === 'error' ? '#8B0000' : '#D40000';
          }}
        >
          {state === 'idle' ? 'CONNECT WALLET' : 'Connecting...'}
        </button>

        {/* Error message */}
        {error && state === 'error' && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: '#FFE0E0',
            border: '1px solid #FFB0B0',
            fontSize: 8,
            color: '#8B0000',
            fontWeight: 500,
            wordBreak: 'break-word',
          }}>
            {error}
          </div>
        )}

        {/* Info text */}
        <div style={{
          marginTop: '32px',
          fontSize: 8,
          color: '#A0A0A0',
          textAlign: 'center',
          lineHeight: '1.6',
        }}>
          Sign in with your Ethereum wallet to access the admin dashboard.
          <br />
          Only the authorized admin address can proceed.
        </div>
      </div>
    </div>
  );
}
