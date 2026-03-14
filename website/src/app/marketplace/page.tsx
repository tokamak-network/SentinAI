'use client';

import { useEffect, useState } from 'react';
import { Agent, getPriceDisplay } from '@/lib/agent-marketplace';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

type TabType = 'registry' | 'instance' | 'guide' | 'sandbox';

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

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div style={{
      border: '1px solid #D0D0D0',
      padding: '16px',
      marginBottom: '12px',
      background: '#FFFFFF',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'start',
        marginBottom: '8px',
      }}>
        <div>
          <div style={{
            fontFamily: FONT,
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#0A0A0A',
            marginBottom: '4px',
          }}>
            {agent.name.toUpperCase()}
          </div>
          <div style={{
            fontFamily: FONT,
            fontSize: '9px',
            color: '#707070',
            marginBottom: '8px',
          }}>
            {agent.description}
          </div>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: FONT,
            fontSize: '9px',
            fontWeight: 700,
            color: '#D40000',
            background: '#FFF0F0',
            padding: '2px 8px',
            border: '1px solid #D0D0D0',
            borderRadius: '2px',
          }}>
            {agent.tier.toUpperCase()}
          </span>
          <span style={{
            fontFamily: FONT,
            fontSize: '10px',
            fontWeight: 700,
            color: '#007A00',
          }}>
            {getPriceDisplay(agent.priceUSDCents)}
          </span>
        </div>
      </div>

      <div style={{
        fontFamily: FONT,
        fontSize: '9px',
        color: '#A0A0A0',
        marginBottom: '8px',
      }}>
        ID: <span style={{ color: '#3A3A3A', fontWeight: 600 }}>{agent.id}</span>
      </div>

      <div style={{
        display: 'flex',
        gap: '8px',
      }}>
        <button style={{
          fontFamily: FONT,
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          padding: '4px 12px',
          background: '#D40000',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#8B0000')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#D40000')}
        >
          DETAILS
        </button>
        <button style={{
          fontFamily: FONT,
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          padding: '4px 12px',
          background: 'transparent',
          color: '#0055AA',
          border: '1px solid #0055AA',
          cursor: 'pointer',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#0055AA'; e.currentTarget.style.color = 'white'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#0055AA'; }}
        >
          DOCS
        </button>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<TabType>('registry');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load agents from dynamic marketplace store via API
    const loadAgents = async () => {
      try {
        const response = await fetch('/api/agents');
        if (!response.ok) {
          throw new Error(`Failed to fetch agents: ${response.status}`);
        }
        const data = await response.json();
        setAgents(data.agents || []);
      } catch (error) {
        console.error('Failed to load agents:', error);
        setAgents([]); // Empty on error, don't break the UI
      } finally {
        setLoading(false);
      }
    };

    loadAgents();
  }, []);

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
            <div style={{
              marginBottom: '24px',
            }}>
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
                <StatusDot color="#D40000" />
                AVAILABLE AGENTS
              </div>
              <p style={{
                fontFamily: FONT,
                fontSize: '10px',
                color: '#707070',
                marginTop: '8px',
              }}>
                {loading ? 'Loading...' : `${agents.length} agent${agents.length !== 1 ? 's' : ''} available in registry`}
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
                Loading agents...
              </div>
            ) : (
              <div>
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
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
            <div style={{
              fontFamily: FONT,
              fontSize: '10px',
              color: '#707070',
            }}>
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
            <div style={{
              fontFamily: FONT,
              fontSize: '10px',
              color: '#707070',
            }}>
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
            <div style={{
              fontFamily: FONT,
              fontSize: '10px',
              color: '#707070',
            }}>
              Sandbox testing environment coming soon
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
