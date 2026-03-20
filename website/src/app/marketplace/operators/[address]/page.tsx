'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useIsMobile } from '@/lib/useMediaQuery';
import { formatTONPrice, getOperatorByAddress } from '@/lib/agent-marketplace';
import PurchaseModal from '@/components/PurchaseModal';
import { SLADashboard } from '@/components/SLADashboard';
import { PerformanceGraphs } from '@/components/PerformanceGraphs';
import { TrialButton } from '@/components/TrialButton';

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
          {/* System Health */}
          {snapshot && (
            <div style={{ marginBottom: 24, border: '1px solid #D0D0D0' }}>
              <SectionBar>System Health</SectionBar>
              <div style={{ display: 'flex', borderBottom: '1px solid #E0E0E0' }}>
                <MetricCell label="CPU Usage" value={cpu !== undefined ? formatCpu(cpu) : '---'} />
                <MetricCell label="Memory" value={mem !== undefined ? `${mem} GiB` : '---'} />
                <MetricCell
                  label="Anomalies"
                  value={String(anomalies)}
                  last
                />
              </div>
              {snapshot.chain && (
                <div style={{ padding: '8px 14px', fontFamily: FONT, fontSize: 9, color: '#707070' }}>
                  Chain: <span style={{ color: '#0A0A0A' }}>{snapshot.chain.displayName}</span>
                </div>
              )}
            </div>
          )}

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

          {/* Service Catalog */}
          {catalog && (
            <div style={{ border: '1px solid #D0D0D0' }}>
              <SectionBar>Service Catalog</SectionBar>
              {catalog.services.map((service, i) => {
                const isActive = service.state === 'active';
                return (
                  <div
                    key={service.key}
                    style={{
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: isMobile ? 'flex-start' : 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderBottom: i < catalog.services.length - 1 ? '1px solid #F0F0F0' : 'none',
                      gap: isMobile ? 10 : 0,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: '#0A0A0A', letterSpacing: '0.05em' }}>
                        {service.displayName.toUpperCase()}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: 9, color: '#707070', marginTop: 3 }}>
                        {service.description}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: 9, color: '#007A00', fontWeight: 700, marginTop: 3 }}>
                        {formatTONPrice(service.payment.amount)} / CALL
                      </div>
                      {/* SLA Dashboard rendered if available */}
                      {service.sla && <SLADashboard sla={service.sla} />}
                    </div>
                                        {/* Service Card Buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <TrialButton serviceKey={service.key} displayName={service.displayName} />
                      </div>
                      <button
                      disabled={!isActive}
                      onClick={() => {
                        if (isActive && catalog) {
                          setPurchaseTarget({
                            serviceKey: service.key,
                            displayName: service.displayName,
                            endpoint: `/api/marketplace/services/${service.key}`,
                            amount: service.payment.amount,
                          });
                        }
                      }}
                      style={{
                        fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                        padding: '4px 14px',
                        width: isMobile ? '100%' : 'auto',
                        background: isActive ? '#007A00' : '#C0C0C0',
                        color: 'white', border: 'none',
                        cursor: isActive ? 'pointer' : 'not-allowed',
                        opacity: isActive ? 1 : 0.6,
                        flexShrink: 0,
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
          onClose={() => setPurchaseTarget(null)}
        />
      )}
    </div>
  );
}
