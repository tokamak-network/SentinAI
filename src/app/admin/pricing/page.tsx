'use client';

import { useEffect, useState } from 'react';
import type { MarketplacePricingConfig } from '@/types/marketplace';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface PricingFormData {
  traineePrice: number;
  juniorPrice: number;
  seniorPrice: number;
  expertPrice: number;
}

export default function PricingPage() {
  const [pricing, setPricing] = useState<MarketplacePricingConfig | null>(null);
  const [formData, setFormData] = useState<PricingFormData>({
    traineePrice: 0,
    juniorPrice: 0,
    seniorPrice: 0,
    expertPrice: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch pricing on mount
  useEffect(() => {
    fetchPricing();
  }, []);

  const fetchPricing = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/marketplace/pricing`);
      if (!res.ok) throw new Error('Failed to fetch pricing');
      const data = (await res.json()) as { tiers: Record<string, { price: number }> };

      const config: PricingFormData = {
        traineePrice: data.tiers.trainee?.price ?? 0,
        juniorPrice: data.tiers.junior?.price ?? 0,
        seniorPrice: data.tiers.senior?.price ?? 0,
        expertPrice: data.tiers.expert?.price ?? 0,
      };

      setFormData(config);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pricing');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePriceChange = (tier: keyof PricingFormData, value: string) => {
    const numValue = Math.max(0, parseInt(value, 10) || 0);
    setFormData((prev) => ({ ...prev, [tier]: numValue }));
    setHasChanges(true);
    setSuccess(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${BASE_PATH}/api/marketplace/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traineePrice: formData.traineePrice,
          juniorPrice: formData.juniorPrice,
          seniorPrice: formData.seniorPrice,
          expertPrice: formData.expertPrice,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to save pricing');
      }

      await fetchPricing();
      setSuccess('Pricing updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatPrice = (cents: number): string => {
    return (cents / 100).toFixed(2);
  };

  const tiers = [
    { key: 'traineePrice', label: 'Trainee', description: 'Basic tier for new users' },
    { key: 'juniorPrice', label: 'Junior', description: 'For developing users' },
    { key: 'seniorPrice', label: 'Senior', description: 'For experienced users' },
    { key: 'expertPrice', label: 'Expert', description: 'For professional users' },
  ] as const;

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Pricing Management
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Configure pricing tiers for marketplace agents
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
          {/* Pricing Tiers Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
            }}
          >
            {tiers.map(({ key, label, description }) => (
              <div
                key={key}
                style={{
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                }}
              >
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 4px 0', color: '#111827' }}>
                    {label}
                  </h3>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>{description}</p>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>
                    Price (USD cents)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>$</span>
                    <input
                      type="number"
                      value={formData[key]}
                      onChange={(e) => handlePriceChange(key, e.target.value)}
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
                    <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '40px', textAlign: 'right' }}>
                      {formatPrice(formData[key])}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

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
              <strong>Pricing Details:</strong>
            </div>
            <ul style={{ margin: '0', paddingLeft: '20px' }}>
              <li>Prices are in USD cents (100 cents = $1.00)</li>
              <li>Enter prices without currency symbols or decimals</li>
              <li>Prices must be non-negative integers</li>
              <li>Changes are saved immediately to Redis</li>
            </ul>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                setFormData({
                  traineePrice: 0,
                  juniorPrice: 19900,
                  seniorPrice: 49900,
                  expertPrice: 79900,
                });
                setHasChanges(true);
              }}
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
