'use client';

import { useEffect, useState } from 'react';
import type { MarketplacePricingConfig } from '@/types/marketplace';
import type { ExperienceTier } from '@/types/agent-resume';

// Color constants
const WHITE = '#ffffff';
const GRAY = '#888888';
const DARK_BG = '#0d0d0d';
const BLUE = '#0066FF';
const GREEN = '#00AA00';
const RED = '#FF0000';
const DARK_INPUT_BG = '#1a1a1a';
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

export default function MarketplacePage() {
  // Pricing state hooks
  const [pricingConfig, setPricingConfig] = useState<MarketplacePricingConfig | null>(null);
  const [editingTier, setEditingTier] = useState<ExperienceTier | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [pricingMessage, setPricingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);

  // Fetch pricing configuration on mount
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const res = await fetch('/api/marketplace/pricing');
        if (!res.ok) throw new Error('Failed to fetch pricing');
        const { data } = await res.json();
        setPricingConfig(data);
      } catch (error) {
        setPricingMessage({ type: 'error', text: 'Failed to load pricing configuration' });
      }
    };
    fetchPricing();
  }, []);

  // Pricing update handler
  const handlePricingUpdate = async (tier: ExperienceTier, newPriceCents: number) => {
    const apiKey = prompt('Enter SENTINAI_API_KEY to authorize pricing update:');
    if (!apiKey) return;

    setPricingLoading(true);
    try {
      const update: Record<string, number> = {};
      update[`${tier}Price`] = newPriceCents;

      const res = await fetch('/api/marketplace/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(update),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update pricing');
      }

      const { data } = await res.json();
      setPricingConfig(data);
      setPricingMessage({ type: 'success', text: `${tier} tier updated to $${(newPriceCents / 100).toFixed(2)}` });
      setEditingTier(null);
    } catch (error: any) {
      setPricingMessage({ type: 'error', text: error.message });
    } finally {
      setPricingLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', backgroundColor: DARK_BG, color: WHITE, minHeight: '100vh', fontFamily: FONT }}>
      <h1 style={{ fontSize: '32px', marginBottom: '30px' }}>Agent Marketplace</h1>

      {/* Pricing Management Section */}
      <div style={{ marginTop: '40px', padding: '20px', border: `1px solid ${GRAY}`, borderRadius: '4px', backgroundColor: DARK_BG }}>
        <h2 style={{ fontFamily: FONT, fontSize: '18px', marginBottom: '20px', color: WHITE }}>
          Pricing Management
        </h2>

        {!pricingConfig ? (
          <p style={{ color: GRAY, fontFamily: FONT }}>Loading pricing configuration...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
            {(['trainee', 'junior', 'senior', 'expert'] as const).map((tier) => {
              const priceKey = `${tier}Price` as keyof MarketplacePricingConfig;
              const currentPrice = pricingConfig[priceKey] as number;
              const isEditing = editingTier === tier;

              return (
                <div
                  key={tier}
                  style={{
                    padding: '15px',
                    border: `1px solid ${GRAY}`,
                    borderRadius: '4px',
                    backgroundColor: DARK_BG,
                    fontFamily: FONT,
                  }}
                >
                  <h3 style={{ textTransform: 'capitalize', marginBottom: '10px', color: WHITE }}>
                    {tier} Tier
                  </h3>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                      <input
                        type="number"
                        placeholder="Price in cents"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        min="0"
                        step="100"
                        style={{
                          flex: 1,
                          padding: '8px',
                          fontFamily: FONT,
                          fontSize: '14px',
                          backgroundColor: DARK_INPUT_BG,
                          color: WHITE,
                          border: `1px solid ${GRAY}`,
                        }}
                      />
                      <button
                        onClick={() => {
                          const newPrice = parseInt(editPrice, 10);
                          if (!isNaN(newPrice)) {
                            handlePricingUpdate(tier, newPrice);
                          }
                        }}
                        disabled={pricingLoading}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: GREEN,
                          color: WHITE,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: pricingLoading ? 'not-allowed' : 'pointer',
                          fontFamily: FONT,
                        }}
                      >
                        {pricingLoading ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingTier(null)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: GRAY,
                          color: WHITE,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontFamily: FONT,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '10px' }}>
                      <p style={{ fontSize: '20px', color: GREEN, margin: '0 0 10px 0' }}>
                        ${(currentPrice / 100).toFixed(2)} / month
                      </p>
                      <button
                        onClick={() => {
                          setEditingTier(tier);
                          setEditPrice(currentPrice.toString());
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: BLUE,
                          color: WHITE,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontFamily: FONT,
                        }}
                      >
                        Edit Price
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pricingMessage && (
          <div
            style={{
              marginTop: '15px',
              padding: '12px',
              borderRadius: '4px',
              backgroundColor: pricingMessage.type === 'success' ? '#1a4d1a' : '#4d1a1a',
              color: pricingMessage.type === 'success' ? GREEN : RED,
              fontFamily: FONT,
            }}
          >
            {pricingMessage.text}
          </div>
        )}

        <p style={{ marginTop: '15px', fontSize: '12px', color: GRAY, fontFamily: FONT }}>
          ⚠️ Updating prices requires SENTINAI_API_KEY authentication via Bearer token.
        </p>
      </div>
    </div>
  );
}
