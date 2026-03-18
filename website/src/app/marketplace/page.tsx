'use client';

import { useEffect, useState } from 'react';
import {
  AgentMarketplaceCatalog,
  AgentMarketplaceServiceDefinition,
  formatTONPrice,
  serviceKeyToEndpoint,
  formatNetworkName,
} from '@/lib/agent-marketplace';
import PurchaseModal from '@/components/PurchaseModal';
import TradeStatsBanner from '@/components/TradeStatsBanner';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

type TabType = 'registry' | 'instance' | 'guide' | 'sandbox';

interface PurchaseTarget {
  service: AgentMarketplaceServiceDefinition;
  endpoint: string;
}

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

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, marginRight: 6, flexShrink: 0,
    }} />
  );
}

function ServiceCard({
  service,
  operator,
  onBuy,
}: {
  service: AgentMarketplaceServiceDefinition;
  operator: string;
  onBuy?: () => void;
}) {
  const isActive = service.state === 'active';

  return (
    <div style={{
      border: '1px solid #D0D0D0',
      padding: '16px',
      marginBottom: '12px',
      background: '#FFFFFF',
    }}>
      {/* Header: name + state badge */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '6px',
      }}>
        <div style={{
          fontFamily: FONT,
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: '#0A0A0A',
        }}>
          {service.displayName.toUpperCase()}
        </div>
        <span style={{
          fontFamily: FONT,
          fontSize: '9px',
          fontWeight: 700,
          color: isActive ? '#007A00' : '#A06000',
          background: isActive ? '#F0FFF0' : '#FFFBE0',
          padding: '2px 8px',
          border: `1px solid ${isActive ? '#B0D0B0' : '#D0C060'}`,
          borderRadius: '2px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}>
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
            background: isActive ? '#007A00' : '#A06000',
          }} />
          {service.state.toUpperCase()}
        </span>
      </div>

      {/* Description */}
      <div style={{
        fontFamily: FONT,
        fontSize: '9px',
        color: '#707070',
        marginBottom: '12px',
      }}>
        {service.description}
      </div>

      {/* Registry metadata block */}
      <div style={{
        background: '#F7F7F7',
        border: '1px solid #E0E0E0',
        padding: '8px 10px',
        marginBottom: '12px',
      }}>
        <div style={{
          fontFamily: FONT,
          fontSize: '8px',
          color: '#A0A0A0',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: '6px',
        }}>
          Registry
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr',
          rowGap: '4px',
        }}>
          {[
            ['OPERATOR', operator],
            ['NETWORK', formatNetworkName(service.payment.network)],
            ['PROTOCOL', `x402 · ${service.payment.scheme}`],
            ['TOKEN', service.payment.token],
          ].map(([label, value]) => (
            <>
              <span key={`l-${label}`} style={{
                fontFamily: FONT,
                fontSize: '8px',
                color: '#A0A0A0',
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
              }}>
                {label}
              </span>
              <span key={`v-${label}`} style={{
                fontFamily: FONT,
                fontSize: '9px',
                color: '#3A3A3A',
                fontWeight: 600,
              }}>
                {value}
              </span>
            </>
          ))}
        </div>
      </div>

      {/* Footer: key + price + buy button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{
          fontFamily: FONT,
          fontSize: '9px',
          color: '#A0A0A0',
        }}>
          ID: <span style={{ color: '#3A3A3A', fontWeight: 600 }}>{service.key}</span>
          <span style={{ marginLeft: 12, color: '#007A00', fontWeight: 700 }}>
            {formatTONPrice(service.payment.amount)} / CALL
          </span>
        </div>
        <button
          onClick={isActive ? onBuy : undefined}
          disabled={!isActive}
          style={{
            fontFamily: FONT,
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '4px 14px',
            background: isActive ? '#007A00' : '#C0C0C0',
            color: 'white',
            border: 'none',
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
}

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<TabType>('registry');
  const [catalog, setCatalog] = useState<AgentMarketplaceCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchaseTarget, setPurchaseTarget] = useState<PurchaseTarget | null>(null);

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const response = await fetch('/api/agent-marketplace/catalog');
        if (!response.ok) {
          throw new Error(`Failed to fetch catalog: ${response.status}`);
        }
        const data: AgentMarketplaceCatalog = await response.json();
        setCatalog(data);
      } catch (error) {
        console.error('Failed to load catalog:', error);
        setCatalog(null);
      } finally {
        setLoading(false);
      }
    };

    loadCatalog();
  }, []);

  function handleBuy(service: AgentMarketplaceServiceDefinition) {
    const endpoint = serviceKeyToEndpoint(service.key, catalog!.agent.baseUrl);
    setPurchaseTarget({ service, endpoint });
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FFFFFF',
      fontFamily: FONT,
    }}>
      {/* Navbar */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: '#FFFFFF',
        borderBottom: '1px solid #D0D0D0',
        display: 'flex',
        alignItems: 'stretch',
        height: 40,
      }}>
        {/* Brand */}
        <div style={{
          background: '#D40000',
          color: 'white',
          padding: '0 18px',
          display: 'flex',
          alignItems: 'center',
          borderRight: '2px solid #8B0000',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}>
            SENTINAI
          </span>
        </div>

        {/* Nav */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          marginLeft: 0,
          flex: 1,
        }}>
          {[
            { href: '/docs', label: 'DOCS' },
            { href: '/connect', label: 'DEPLOY' },
            { href: '/marketplace', label: 'MARKETPLACE' },
          ].map(({ href, label }) => (
            <a key={label} href={href} style={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              color: label === 'MARKETPLACE' ? '#D40000' : '#3A3A3A',
              textDecoration: 'none',
              padding: '0 16px',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              borderRight: '1px solid #E8E8E8',
            }}>
              {label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <a href="/connect" style={{
          background: '#D40000',
          color: 'white',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: FONT,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textDecoration: 'none',
          borderLeft: '2px solid #8B0000',
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#8B0000')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#D40000')}
        >
          CONNECT NODE →
        </a>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '24px',
      }}>
        {/* Section Bar */}
        <SectionBar>Agent Marketplace</SectionBar>

        {/* Heading */}
        <h1 style={{
          fontFamily: FONT,
          fontSize: '24px',
          fontWeight: 700,
          color: '#0A0A0A',
          marginTop: '24px',
          marginBottom: '16px',
          letterSpacing: '0.02em',
        }}>
          Agent Marketplace
        </h1>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: 0,
          marginBottom: '24px',
          borderBottom: '1px solid #D0D0D0',
        }}>
          {(['registry', 'instance', 'guide', 'sandbox'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '12px 16px',
                fontFamily: FONT,
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                border: 'none',
                background: activeTab === tab ? '#D40000' : '#F7F7F7',
                color: activeTab === tab ? 'white' : '#3A3A3A',
                cursor: 'pointer',
                borderBottom: activeTab === tab ? '3px solid #D40000' : 'none',
                transition: 'all 200ms',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'registry' && (
          <div>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                fontFamily: FONT,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: '#0A0A0A',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <StatusDot color="#007A00" />
                DATA SERVICES
              </div>
              <p style={{
                fontFamily: FONT,
                fontSize: '10px',
                color: '#707070',
                marginTop: '8px',
              }}>
                {loading
                  ? 'Loading...'
                  : '7 data services available · x402 protocol · TON payment'}
              </p>
            </div>

            {loading ? (
              <div style={{
                fontFamily: FONT,
                fontSize: '10px',
                color: '#A0A0A0',
                padding: '24px',
                textAlign: 'center',
              }}>
                Loading services...
              </div>
            ) : catalog ? (
              <div>
                {/* Operator meta row */}
                <div style={{
                  display: 'flex',
                  gap: 20,
                  marginBottom: '16px',
                  padding: '8px 12px',
                  background: '#F7F7F7',
                  border: '1px solid #E0E0E0',
                  fontFamily: FONT,
                  fontSize: '9px',
                }}>
                  <span>
                    <span style={{ color: '#A0A0A0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>OPERATOR: </span>
                    <span style={{ color: '#0A0A0A', fontWeight: 700 }}>{catalog.agent.operatorAddress ?? catalog.agent.operator}</span>
                  </span>
                  <span>
                    <span style={{ color: '#A0A0A0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>VERSION: </span>
                    <span style={{ color: '#0A0A0A', fontWeight: 700 }}>{catalog.agent.version}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#A0A0A0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>STATUS: </span>
                    <span style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                      background: catalog.agent.status === 'active' ? '#007A00' : '#A0A0A0',
                    }} />
                    <span style={{ color: '#0A0A0A', fontWeight: 700 }}>{catalog.agent.status}</span>
                  </span>
                </div>

                {/* On-chain activity banner */}
                <TradeStatsBanner />

                {/* Service cards */}
                {catalog.services.map((service) => (
                  <ServiceCard
                    key={service.key}
                    service={service}
                    operator={catalog.agent.operatorAddress ?? catalog.agent.operator}
                    onBuy={() => handleBuy(service)}
                  />
                ))}
              </div>
            ) : (
              <div style={{
                fontFamily: FONT,
                fontSize: '10px',
                color: '#D40000',
                padding: '24px',
                textAlign: 'center',
              }}>
                Failed to load services
              </div>
            )}
          </div>
        )}

        {activeTab === 'instance' && (
          <div style={{
            padding: '24px',
            background: '#F7F7F7',
            border: '1px solid #D0D0D0',
          }}>
            <div style={{ fontFamily: FONT, fontSize: '10px', color: '#707070' }}>
              Instance deployment information coming soon
            </div>
          </div>
        )}

        {activeTab === 'guide' && (
          <div style={{
            padding: '24px',
            background: '#F7F7F7',
            border: '1px solid #D0D0D0',
          }}>
            <div style={{ fontFamily: FONT, fontSize: '10px', color: '#707070' }}>
              Integration guide coming soon
            </div>
          </div>
        )}

        {activeTab === 'sandbox' && (
          <div style={{
            padding: '24px',
            background: '#F7F7F7',
            border: '1px solid #D0D0D0',
          }}>
            <div style={{ fontFamily: FONT, fontSize: '10px', color: '#707070' }}>
              Sandbox testing environment coming soon
            </div>
          </div>
        )}
      </main>

      {/* Purchase Modal */}
      {purchaseTarget && (
        <PurchaseModal
          agentId={purchaseTarget.service.key}
          agentName={purchaseTarget.service.displayName}
          endpoint={purchaseTarget.endpoint}
          onClose={() => setPurchaseTarget(null)}
        />
      )}
    </div>
  );
}
