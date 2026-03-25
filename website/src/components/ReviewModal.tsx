'use client';

import { useState } from 'react';
import { submitReviewOnChain, waitForReviewTx } from '@/lib/review-onchain';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

interface ReviewModalProps {
  operatorAddress: string;
  serviceKey: string;
  serviceName: string;
  txHash: string;
  reviewerAddress: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

const CATEGORIES = [
  { key: 'dataAccuracy', label: 'DATA ACCURACY' },
  { key: 'responseSpeed', label: 'RESPONSE SPEED' },
  { key: 'uptime', label: 'UPTIME' },
  { key: 'valueForMoney', label: 'VALUE FOR MONEY' },
] as const;

function StarRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0', borderBottom: '1px solid #F0F0F0',
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#3A3A3A' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            onClick={() => onChange(star)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, padding: 0, lineHeight: 1,
              color: star <= value ? '#FFB800' : '#D0D0D0',
            }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReviewModal({
  operatorAddress,
  serviceKey,
  serviceName,
  txHash,
  reviewerAddress,
  onClose,
  onSubmitted,
}: ReviewModalProps) {
  const [ratings, setRatings] = useState({ dataAccuracy: 0, responseSpeed: 0, uptime: 0, valueForMoney: 0 });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRated = Object.values(ratings).every(v => v >= 1);

  const handleSubmit = async () => {
    if (!allRated) return;
    setSubmitting(true);
    setError(null);

    try {
      // Submit review on-chain via MetaMask
      // txHash here is the settlement nonce (approveAndCall tx hash)
      // We need the settlement nonce from the Facilitator — for now use txHash as identifier
      const { txHash: reviewTxHash } = await submitReviewOnChain({
        account: reviewerAddress,
        operator: operatorAddress,
        settlementNonce: txHash, // The settlement tx nonce
        dataAccuracy: ratings.dataAccuracy,
        responseSpeed: ratings.responseSpeed,
        uptime: ratings.uptime,
        valueForMoney: ratings.valueForMoney,
        comment: comment.trim(),
      });

      // Wait for confirmation
      const success = await waitForReviewTx(reviewTxHash);
      if (!success) {
        throw new Error('Review transaction reverted');
      }

      onSubmitted?.();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFFFF', border: '1px solid #D0D0D0',
          width: 400, maxWidth: '90vw', fontFamily: FONT,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: '#0A0A0A', color: 'white',
          padding: '6px 14px', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.15em', display: 'flex', justifyContent: 'space-between',
        }}>
          <span>RATE THIS OPERATOR</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#888',
              cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {/* Service info */}
          <div style={{ fontSize: 9, color: '#707070', marginBottom: 14 }}>
            Service: <span style={{ color: '#0A0A0A', fontWeight: 700 }}>{serviceName}</span>
          </div>

          {/* Star ratings */}
          {CATEGORIES.map(cat => (
            <StarRow
              key={cat.key}
              label={cat.label}
              value={ratings[cat.key]}
              onChange={v => setRatings(prev => ({ ...prev, [cat.key]: v }))}
            />
          ))}

          {/* Comment */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 8, color: '#A0A0A0', letterSpacing: '0.1em', marginBottom: 4 }}>
              COMMENT (OPTIONAL)
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={500}
              rows={3}
              style={{
                width: '100%', fontFamily: FONT, fontSize: 10,
                border: '1px solid #D0D0D0', padding: 8,
                resize: 'vertical', boxSizing: 'border-box',
              }}
              placeholder="Share your experience..."
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 9, color: '#D40000', marginTop: 8 }}>{error}</div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!allRated || submitting}
            style={{
              marginTop: 14, width: '100%',
              background: allRated ? '#007A00' : '#C0C0C0',
              color: 'white', border: 'none',
              padding: '8px 0', fontFamily: FONT,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              cursor: allRated && !submitting ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'SUBMITTING...' : 'SUBMIT REVIEW'}
          </button>
        </div>
      </div>
    </div>
  );
}
