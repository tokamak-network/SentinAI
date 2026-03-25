'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useIsMobile } from '@/lib/useMediaQuery';
import { formatTONPrice, getOperatorByAddress } from '@/lib/agent-marketplace';
import PurchaseModal from '@/components/PurchaseModal';
import { SLADashboard } from '@/components/SLADashboard';
import { PerformanceGraphs } from '@/components/PerformanceGraphs';

import { GuardianTemperature } from '@/components/GuardianTemperature';
import { ReviewModal } from '@/components/ReviewModal';
import { getServiceMeta } from '@/lib/service-catalog-meta';
import type { GuardianScore, OperatorReview } from '@/types/review';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpsSnapshotData {
  version: string;
  generatedAt: string;
  chain?: { chainType: string; displayName: string };
  metrics?: {
    cpu?: { mean: number; max: number; trend: string };
    txPool?: { mean: number; max: number; trend: string };
    gasUsedRatio?: { mean: number; max: number };
  };
  scaling?: {
    currentVcpu: number;
    currentMemoryGiB: number;
    autoScalingEnabled: boolean;
    cooldownRemaining: number;
    lastDecisionScore: number | null;
    lastDecisionReason: string | null;
  };
  anomalies?: { activeCount: number; totalRecent: number };
  operatorAddress?: string;
}

interface CatalogData {
  agent: {
    id: string;
    status: string;
    version: string;
        operator: string;
    operatorAddress?: string;
    baseUrl: string;
    performanceHistory?: import('@/lib/agent-marketplace').PerformanceHistory;
  };
  services: Array<{
    key: string;
    state: 'active' | 'planned';
    displayName: string;
    description: string;
    payment: { scheme: string; network: string; token: string; amount: string };
    sla?: import('@/lib/agent-marketplace').ServiceSLA;
  }>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionBar({ children }: { children: string }) {
  return (
    <div style={{
      background: '#0A0A0A', color: 'white',
      padding: '3px 14px', fontFamily: FONT, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.15em', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function MetricCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid #E0E0E0',
      minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 20, fontWeight: 700, color: '#D40000',
        letterSpacing: '-0.01em', marginBottom: 4, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
        letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface PurchaseTarget {
  serviceKey: string;
  displayName: string;
  endpoint: string;
  amount: string;
}

export default function OperatorDetailPage() {
  const params = useParams();
  const address = typeof params.address === 'string' ? params.address : '';
  const isMobile = useIsMobile();

  const [snapshot, setSnapshot] = useState<OpsSnapshotData | null>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<PurchaseTarget | null>(null);
  const [guardianScore, setGuardianScore] = useState<GuardianScore | null>(null);
  const [reviews, setReviews] = useState<OperatorReview[]>([]);
  const [reviewTarget, setReviewTarget] = useState<{
    serviceKey: string; displayName: string; txHash: string; reviewerAddress: string;
  } | null>(null);

  useEffect(() => {
    if (!address) return;

    // Try to resolve the operator's agentUri from the discovery endpoint or catalog
    const resolveAgentUri = async (): Promise<string> => {
      try {
        const res = await fetch(`/api/agent-marketplace/discovery/${address}`);
        if (res.ok) {
          const data = await res.json();
          if (data.agentUri) return data.agentUri as string;
        }
      } catch { /* fall through */ }


      // Fallback: use the local catalog base URL (single-operator mode)
      const mockOp = getOperatorByAddress(address);
      if (mockOp) {
        setCatalog({
          agent: {
            id: mockOp.address,
            status: mockOp.status === 'offline' ? 'inactive' : 'active',
            version: '1.0.0',
            operator: mockOp.operator,
            operatorAddress: mockOp.address,
            baseUrl: `https://sentinai.tokamak.network/operators/${mockOp.address}`,
            performanceHistory: mockOp.performanceHistory,
          },
          services: mockOp.services,
        } as any);
        setSnapshot({
          version: '1.0.0',
          generatedAt: new Date().toISOString(),
          metrics: {
            cpu: { mean: mockOp.metrics.cpuMean, max: mockOp.metrics.cpuMean, trend: 'stable' },
          },
          scaling: {
            currentVcpu: 1,
            currentMemoryGiB: mockOp.metrics.memoryGiB,
            autoScalingEnabled: true,
            cooldownRemaining: 0,
            lastDecisionScore: null,
            lastDecisionReason: null,
          },
          anomalies: { activeCount: mockOp.metrics.activeAnomalies, totalRecent: mockOp.metrics.activeAnomalies },
          operatorAddress: mockOp.address,
        });
        return '';
      }
      return 'http://localhost:3002';

    };

    const load = async () => {
      try {
        const agentUri = await resolveAgentUri();
        if (!agentUri) { setLoading(false); return; }
        const baseUrl = agentUri.replace(/\/$/, '');

        const [snapRes, catRes] = await Promise.allSettled([
          fetch(`${baseUrl}/api/agent-marketplace/ops-snapshot.json`),
          fetch(`${baseUrl}/api/agent-marketplace/catalog`),
        ]);

        if (snapRes.status === 'fulfilled' && snapRes.value.ok) {
          setSnapshot(await snapRes.value.json());
        }
        if (catRes.status === 'fulfilled' && catRes.value.ok) {
          setCatalog(await catRes.value.json());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load operator data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [address]);

  // Fetch Guardian Score + Reviews
  useEffect(() => {
    if (!address) return;
    fetch(`/api/marketplace/guardian-score/${address}`)
      .then(r => r.json())
      .then(data => { if (data.temperature !== undefined) setGuardianScore(data); })
      .catch(() => {});
    fetch(`/api/marketplace/reviews?operator=${address}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setReviews(data); })
      .catch(() => {});
  }, [address]);

  const cpu = snapshot?.metrics?.cpu?.mean;
  const mem = snapshot?.scaling?.currentMemoryGiB;
  const anomalies = snapshot?.anomalies?.activeCount ?? 0;

  const formatCpu = (v: number) => `${(v > 1 ? v : v * 100).toFixed(1)}%`;

  return (
    <div style={{ background: '#FFFFFF', fontFamily: FONT }}>
      {/* Back nav */}
      <div style={{ marginBottom: 16 }}>
        <a
          href="/marketplace/operators"
          style={{
            fontFamily: FONT, fontSize: 9, color: '#707070', textDecoration: 'none',
            letterSpacing: '0.08em',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#D40000')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#707070')}
        >
          ← BACK TO OPERATORS
        </a>
      </div>

      {/* Header */}
      <SectionBar>Operator Detail</SectionBar>
      <div style={{ padding: '12px 0 20px', borderBottom: '1px solid #E0E0E0', marginBottom: 20 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: '#707070', wordBreak: 'break-all' }}>
          {address}
        </div>
        {catalog?.agent.operator && (
          <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#0A0A0A', marginTop: 4 }}>
            {catalog.agent.operator.toUpperCase()}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', padding: '24px', textAlign: 'center' }}>
          Loading...
        </div>
      ) : error ? (
        <div style={{ fontFamily: FONT, fontSize: 10, color: '#D40000', padding: '24px', textAlign: 'center' }}>
          {error}
        </div>
      ) : (
        <>
          {/* Performance Tab */}
          {catalog?.agent && snapshot?.operatorAddress && (
            <>
              <div style={{ 
                fontSize: 12, 
                fontWeight: 700, 
                marginTop: 24, 
                marginBottom: 12,
                color: '#0A0A0A' 
              }}>
                PERFORMANCE
              </div>
              {catalog.agent.performanceHistory && (
                <PerformanceGraphs history={catalog.agent.performanceHistory} />
              )}
            </>
          )}

          {/* Guardian Score + SLA */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            {guardianScore && (
              <div style={{ flex: 1, minWidth: 250, border: '1px solid #D0D0D0' }}>
                <SectionBar>Guardian Score</SectionBar>
                <div style={{ padding: 14 }}>
                  <GuardianTemperature score={guardianScore} variant="full" />
                </div>
              </div>
            )}
            {catalog && (() => {
              const firstSla = catalog.services.find(s => s.sla)?.sla;
              return firstSla ? (
                <div style={{ flex: 1, minWidth: 250, border: '1px solid #D0D0D0' }}>
                  <SectionBar>SLA Guarantees</SectionBar>
                  <div style={{ padding: '10px 16px' }}>
                    <SLADashboard sla={firstSla} />
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {/* Recent Reviews */}
          {reviews.length > 0 && (
            <div style={{ border: '1px solid #D0D0D0', marginBottom: 24 }}>
              <SectionBar>Recent Reviews</SectionBar>
              {reviews.slice(0, 5).map((review, i) => (
                <div key={review.id} style={{
                  padding: '10px 16px',
                  borderBottom: i < Math.min(reviews.length, 5) - 1 ? '1px solid #F0F0F0' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT, fontSize: 9, color: '#A0A0A0', marginBottom: 3 }}>
                      {review.reviewerAddress.slice(0, 8)}...{review.reviewerAddress.slice(-4)}
                      <span style={{ marginLeft: 8 }}>
                        {new Date(review.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {review.comment && (
                      <div style={{ fontFamily: FONT, fontSize: 10, color: '#3A3A3A', lineHeight: 1.5 }}>
                        {review.comment}
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 11, color: '#FFB800', flexShrink: 0, marginLeft: 12 }}>
                    {'★'.repeat(Math.round(
                      (review.ratings.dataAccuracy + review.ratings.responseSpeed +
                       review.ratings.uptime + review.ratings.valueForMoney) / 4
                    ))}
                    {'☆'.repeat(5 - Math.round(
                      (review.ratings.dataAccuracy + review.ratings.responseSpeed +
                       review.ratings.uptime + review.ratings.valueForMoney) / 4
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Service Catalog */}
          {catalog && (
            <div style={{ border: '1px solid #D0D0D0' }}>
              <SectionBar>Service Catalog</SectionBar>
              {catalog.services.map((service, i) => {
                const isActive = service.state === 'active';
                const meta = getServiceMeta(service.key);
                return (
                  <div
                    key={service.key}
                    style={{
                      padding: '16px',
                      borderBottom: i < catalog.services.length - 1 ? '1px solid #E0E0E0' : 'none',
                    }}
                  >
                    {/* Header: name + price */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                      <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: '#0A0A0A', letterSpacing: '0.05em' }}>
                        {service.displayName.toUpperCase()}
                      </div>
                      <div style={{
                        fontFamily: FONT, fontSize: 13, color: '#D40000', fontWeight: 700,
                        background: '#FFF0F0', padding: '2px 8px', border: '1px solid #FFD0D0',
                      }}>
                        {formatTONPrice(service.payment.amount)} / CALL
                      </div>
                    </div>

                    {/* Use Case */}
                    {meta && (
                      <div style={{
                        fontFamily: FONT, fontSize: 10, color: '#3A3A3A',
                        lineHeight: 1.6, marginBottom: 10,
                        borderLeft: '3px solid #D40000', paddingLeft: 10,
                      }}>
                        {meta.useCase}
                      </div>
                    )}

                    {/* Persona badges */}
                    {meta && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {meta.personas.map(p => (
                          <span key={p} style={{
                            fontFamily: FONT, fontSize: 8, fontWeight: 600,
                            color: '#0055AA', background: '#F0F4FF',
                            padding: '2px 6px', border: '1px solid #D0DFFF',
                          }}>
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Response Preview */}
                    {meta && (
                      <div style={{
                        background: '#0A0A0A', padding: '10px 12px',
                        marginBottom: 12, overflow: 'auto',
                      }}>
                        <div style={{
                          fontFamily: FONT, fontSize: 7, color: '#555',
                          letterSpacing: '0.1em', marginBottom: 6,
                        }}>
                          RESPONSE PREVIEW
                        </div>
                        <pre style={{
                          fontFamily: FONT, fontSize: 9, color: '#00FF88',
                          margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                        }}>
                          {JSON.stringify(meta.responsePreview, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Buy button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        disabled={!isActive}
                        onClick={() => {
                          if (isActive && catalog) {
                            const slug = service.key.replace(/_/g, '-');
                            const baseUrl = (catalog.agent.baseUrl ?? 'https://sentinai.tokamak.network/thanos-sepolia').replace(/\/$/, '');
                            setPurchaseTarget({
                              serviceKey: service.key,
                              displayName: service.displayName,
                              endpoint: `${baseUrl}/api/agent-marketplace/${slug}`,
                              amount: service.payment.amount,
                            });
                          }
                        }}
                        style={{
                          fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                          padding: '6px 20px',
                          background: isActive ? '#007A00' : '#C0C0C0',
                          color: 'white', border: 'none',
                          cursor: isActive ? 'pointer' : 'not-allowed',
                          opacity: isActive ? 1 : 0.6,
                        }}
                        onMouseEnter={(e) => { if (isActive) e.currentTarget.style.background = '#005500'; }}
                        onMouseLeave={(e) => { if (isActive) e.currentTarget.style.background = '#007A00'; }}
                      >
                        BUY DATA
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      
      {/* Purchase Modal */}
      {purchaseTarget && (
        <PurchaseModal
          agentId={address}
          operatorAddress={address}
          agentName={catalog?.agent.operator ?? 'Unknown Operator'}
          endpoint={purchaseTarget.endpoint}
          serviceKey={purchaseTarget.serviceKey}
          serviceName={purchaseTarget.displayName}
          onClose={() => setPurchaseTarget(null)}
          onPurchaseComplete={(txHash, buyerAddress) => {
            setReviewTarget({
              serviceKey: purchaseTarget.serviceKey,
              displayName: purchaseTarget.displayName,
              txHash,
              reviewerAddress: buyerAddress,
            });
          }}
        />
      )}

      {/* Review Modal — appears after successful purchase */}
      {reviewTarget && (
        <ReviewModal
          operatorAddress={address}
          serviceKey={reviewTarget.serviceKey}
          serviceName={reviewTarget.displayName}
          txHash={reviewTarget.txHash}
          reviewerAddress={reviewTarget.reviewerAddress}
          onClose={() => setReviewTarget(null)}
          onSubmitted={() => {
            // Refresh guardian score + reviews
            fetch(`/api/marketplace/guardian-score/${address}`)
              .then(r => r.json())
              .then(data => { if (data.temperature !== undefined) setGuardianScore(data); })
              .catch(() => {});
            fetch(`/api/marketplace/reviews?operator=${address}`)
              .then(r => r.json())
              .then(data => { if (Array.isArray(data)) setReviews(data); })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
