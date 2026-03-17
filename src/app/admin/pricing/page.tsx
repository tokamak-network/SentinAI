'use client';

import { useEffect, useState } from 'react';
import type { BracketPricingConfig, PricingBracket } from '@/types/marketplace';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function PricingPage() {
  const [brackets, setBrackets] = useState<PricingBracket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchPricing();
  }, []);

  const fetchPricing = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/marketplace/pricing`);
      if (!res.ok) throw new Error('Failed to fetch pricing');
      const data = (await res.json()) as { data: BracketPricingConfig };

      setBrackets(data.data?.brackets ?? []);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pricing');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBracketChange = (index: number, field: keyof PricingBracket, value: string) => {
    setBrackets((prev) => {
      const updated = [...prev];
      if (field === 'floor') {
        updated[index] = { ...updated[index], floor: Math.max(0, Math.min(100, parseInt(value, 10) || 0)) };
      } else if (field === 'priceCents') {
        updated[index] = { ...updated[index], priceCents: Math.max(0, parseInt(value, 10) || 0) };
      } else if (field === 'label') {
        updated[index] = { ...updated[index], label: value };
      }
      return updated;
    });
    setHasChanges(true);
    setSuccess(null);
  };

  const handleAddBracket = () => {
    setBrackets((prev) => [...prev, { floor: 0, priceCents: 0, label: '' }]);
    setHasChanges(true);
    setSuccess(null);
  };

  const handleRemoveBracket = (index: number) => {
    setBrackets((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
    setSuccess(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validate
    if (!brackets.some((b) => b.floor === 0)) {
      setError('At least one bracket with floor=0 is required');
      return;
    }

    const floors = brackets.map((b) => b.floor);
    if (new Set(floors).size !== floors.length) {
      setError('Bracket floors must be unique');
      return;
    }

    for (const b of brackets) {
      if (!b.label.trim()) {
        setError('All brackets must have a label');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`${BASE_PATH}/api/marketplace/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brackets }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to save pricing');
      }

      await fetchPricing();
      setSuccess('Bracket pricing updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setBrackets([
      { floor: 80, priceCents: 79900, label: 'Expert' },
      { floor: 60, priceCents: 49900, label: 'Advanced' },
      { floor: 30, priceCents: 19900, label: 'Standard' },
      { floor: 0, priceCents: 0, label: 'Starter' },
    ]);
    setHasChanges(true);
    setSuccess(null);
  };

  const formatPrice = (cents: number): string => {
    return (cents / 100).toFixed(2);
  };

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Pricing Management
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Configure score-based pricing brackets for marketplace agents
        </p>
      </div>

      {/* Status messages */}
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

      {success && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '20px',
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: '6px',
            color: '#166534',
            fontSize: '13px',
          }}
        >
          {success}
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading pricing...
        </div>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Bracket Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
            }}
          >
            {brackets
              .sort((a, b) => b.floor - a.floor)
              .map((bracket, index) => (
              <div
                key={index}
                style={{
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  position: 'relative',
                }}
              >
                {brackets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBracket(brackets.indexOf(bracket))}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      border: '1px solid #fecaca',
                      backgroundColor: '#fee2e2',
                      color: '#991b1b',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    x
                  </button>
                )}

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                    Label
                  </label>
                  <input
                    type="text"
                    value={bracket.label}
                    onChange={(e) => handleBracketChange(brackets.indexOf(bracket), 'label', e.target.value)}
                    placeholder="e.g., Expert"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '600',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                    Min Score (0-100)
                  </label>
                  <input
                    type="number"
                    value={bracket.floor}
                    onChange={(e) => handleBracketChange(brackets.indexOf(bracket), 'floor', e.target.value)}
                    min="0"
                    max="100"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                    Price (USD cents)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      value={bracket.priceCents}
                      onChange={(e) => handleBracketChange(brackets.indexOf(bracket), 'priceCents', e.target.value)}
                      min="0"
                      step="100"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '60px', textAlign: 'right' }}>
                      ${formatPrice(bracket.priceCents)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Bracket button */}
          <button
            type="button"
            onClick={handleAddBracket}
            style={{
              padding: '10px 16px',
              backgroundColor: '#f0f9ff',
              color: '#0c4a6e',
              border: '1px dashed #bfdbfe',
              borderRadius: '6px',
              fontWeight: '500',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            + Add Bracket
          </button>

          {/* Info box */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#f0f9ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              color: '#0c4a6e',
              fontSize: '13px',
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              <strong>Bracket Pricing Details:</strong>
            </div>
            <ul style={{ margin: '0', paddingLeft: '20px' }}>
              <li>Agents are priced based on their Ops Score (0-100)</li>
              <li>The bracket with the highest floor &le; agent score is applied</li>
              <li>At least one bracket with floor=0 is required (catches all agents)</li>
              <li>Prices are in USD cents (100 cents = $1.00)</li>
            </ul>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
              style={{
                padding: '10px 16px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontWeight: '500',
                fontSize: '14px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              Reset to Defaults
            </button>
            <button
              type="submit"
              disabled={!hasChanges || isSubmitting}
              style={{
                padding: '10px 16px',
                backgroundColor: hasChanges && !isSubmitting ? '#3b82f6' : '#d1d5db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '500',
                fontSize: '14px',
                cursor: hasChanges && !isSubmitting ? 'pointer' : 'not-allowed',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
