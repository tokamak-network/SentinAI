'use client';

import { useFreeTrials } from '@/lib/useFreeTrials';
import { useState } from 'react';

interface TrialButtonProps {
  serviceKey: string;
  displayName: string;
}

export function TrialButton({ serviceKey, displayName }: TrialButtonProps) {
  const { trial, isLoading, useFreeCall } = useFreeTrials(serviceKey);
  const [result, setResult] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(false);

  const FONT = 'IBM Plex Mono';

  if (isLoading) {
    return null;
  }

  const remaining = trial ? trial.totalFreeCalls - trial.usedCalls : 0;
  const canTry = remaining > 0;

  const handleTryFree = async () => {
    setIsLoading2(true);
    try {
      const res = await useFreeCall();
      if (res.success) {
        setResult(`✅ Mock data received! Remaining: ${remaining - 1}`);
      } else {
        setResult(`❌ ${res.reason}`);
      }
    } finally {
      setIsLoading2(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Free Calls Counter */}
      <div style={{
        fontSize: 8,
        color: '#707070',
        fontFamily: FONT,
      }}>
        {remaining > 0 ? (
          `${remaining} free ${remaining === 1 ? 'call' : 'calls'} remaining`
        ) : (
          '❌ Free calls used'
        )}
      </div>

      {/* TRY FREE Button */}
      <button
        onClick={handleTryFree}
        disabled={!canTry || isLoading2}
        style={{
          background: canTry ? '#0084FF' : '#C0C0C0',
          color: 'white',
          border: 'none',
          borderRadius: 3,
          padding: '6px 16px',
          fontSize: 9,
          fontWeight: 700,
          cursor: canTry ? 'pointer' : 'not-allowed',
          fontFamily: FONT,
          opacity: canTry ? 1 : 0.6,
        }}
      >
        {isLoading2 ? 'LOADING...' : 'TRY FREE'}
      </button>

      {/* Result Message */}
      {result && (
        <div style={{
          fontSize: 8,
          color: '#007A00',
          fontFamily: FONT,
          marginTop: 4,
        }}>
          {result}
        </div>
      )}
    </div>
  );
}
