'use client';

import { useState, useEffect } from 'react';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

interface ServicePrice {
  tier: string;
  price: number;
}

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
}

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<'CATALOG' | 'AGENT' | 'SERVICES' | 'ABOUT'>('CATALOG');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/agent-marketplace/catalog', { next: { revalidate: 60 } });
        if (!response.ok) throw new Error(`Failed to fetch catalog: ${response.status}`);
        const data = await response.json();
        setCatalog(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setCatalog([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCatalog();
  }, []);

  return (
    <div style={{ background: '#FFFFFF', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#FFFFFF', borderBottom: '1px solid #D0D0D0',
        display: 'flex', alignItems: 'stretch', height: 40,
      }}>
        {/* Brand block with back link */}
        <a href="/" style={{
          background: '#D40000', color: 'white',
          padding: '0 18px', display: 'flex', alignItems: 'center',
          borderRight: '2px solid #8B0000', flexShrink: 0,
          textDecoration: 'none', fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
        }}>
          SENTINAI
        </a>

        <nav style={{
          display: 'flex', alignItems: 'center', gap: 0, marginLeft: 'auto', marginRight: 'auto',
        }}>
          {['CATALOG', 'AGENT', 'SERVICES', 'ABOUT'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              style={{
                fontFamily: FONT,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: activeTab === tab ? '#D40000' : '#3A3A3A',
                background: 'transparent',
                border: 'none',
                padding: '0 16px',
                height: '100%',
                cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid #D40000' : 'none',
              }}
              onMouseEnter={e => {
                if (activeTab !== tab) (e.currentTarget as HTMLButtonElement).style.color = '#D40000';
              }}
              onMouseLeave={e => {
                if (activeTab !== tab) (e.currentTarget as HTMLButtonElement).style.color = '#3A3A3A';
              }}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '40px 20px' }}>
        {/* CATALOG tab */}
        {activeTab === 'CATALOG' && (
          <section>
            <h1 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              Agent Catalog
            </h1>
            {loading ? (
              <p style={{ fontFamily: FONT, fontSize: 12, color: '#666' }}>Loading catalog...</p>
            ) : error ? (
              <p style={{ fontFamily: FONT, fontSize: 12, color: '#D40000' }}>Error: {error}</p>
            ) : catalog.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {catalog.map(entry => (
                  <div
                    key={entry.id}
                    style={{
                      border: '1px solid #E0E0E0',
                      padding: 20,
                      fontFamily: FONT,
                      fontSize: 11,
                    }}
                  >
                    <h3 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{entry.name}</h3>
                    <p style={{ color: '#666', lineHeight: 1.5 }}>{entry.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontFamily: FONT, fontSize: 12, color: '#999' }}>No agents in catalog</p>
            )}
          </section>
        )}

        {/* AGENT tab */}
        {activeTab === 'AGENT' && (
          <section>
            <h1 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              Agent Information
            </h1>
            <div style={{
              border: '1px solid #E0E0E0',
              padding: 20,
              fontFamily: FONT,
              fontSize: 12,
              lineHeight: 1.8,
              color: '#333',
            }}>
              <p>Agent ID: <span style={{ color: '#D40000', fontWeight: 700 }}>sentinai-v1</span></p>
              <p>Status: <span style={{ color: '#00AA00', fontWeight: 700 }}>ACTIVE</span></p>
              <p>Services: 3 (sequencer-health, incident-summary, batch-submission-status)</p>
              <p>Payment Required: Yes (x402 standard with base64-encoded envelope)</p>
            </div>
          </section>
        )}

        {/* SERVICES tab */}
        {activeTab === 'SERVICES' && (
          <section>
            <h1 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              Premium Services
            </h1>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 20,
            }}>
              {[
                {
                  name: 'Sequencer Health',
                  endpoint: 'GET /api/agent-marketplace/sequencer-health',
                  description: 'Real-time sequencer health metrics and status',
                },
                {
                  name: 'Incident Summary',
                  endpoint: 'GET /api/agent-marketplace/incident-summary',
                  description: 'Comprehensive incident analysis and reports',
                },
                {
                  name: 'Batch Submission Status',
                  endpoint: 'GET /api/agent-marketplace/batch-submission-status',
                  description: 'Track batch processing metrics and progress',
                },
              ].map(service => (
                <div
                  key={service.name}
                  style={{
                    border: '1px solid #E0E0E0',
                    padding: 20,
                    fontFamily: FONT,
                    fontSize: 11,
                  }}
                >
                  <h3 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{service.name}</h3>
                  <code style={{
                    display: 'block',
                    background: '#F5F5F5',
                    padding: 8,
                    marginBottom: 8,
                    fontSize: 10,
                    color: '#D40000',
                  }}>
                    {service.endpoint}
                  </code>
                  <p style={{ color: '#666', lineHeight: 1.5 }}>{service.description}</p>
                  <p style={{ color: '#999', marginTop: 8, fontSize: 10 }}>Requires X-PAYMENT header</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ABOUT tab */}
        {activeTab === 'ABOUT' && (
          <section>
            <h1 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              About This Marketplace
            </h1>
            <div style={{
              maxWidth: '600px',
              fontFamily: FONT,
              fontSize: 12,
              lineHeight: 1.8,
              color: '#333',
            }}>
              <p style={{ marginBottom: 16 }}>
                The SentinAI Marketplace is a decentralized marketplace for autonomous agents. Agents register and offer services that can be discovered and used by other systems.
              </p>
              <p style={{ marginBottom: 16 }}>
                <strong>x402 Payment Standard:</strong> All premium services support the x402 HTTP payment standard. Clients must include an X-PAYMENT header with a base64-encoded JSON envelope containing the agent ID.
              </p>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>API Endpoints</h3>
              <ul style={{ marginLeft: 20, marginBottom: 16 }}>
                <li>GET /api/agent-marketplace/catalog — Public, no auth</li>
                <li>GET /api/agent-marketplace/agent.json — Public, no auth</li>
                <li>GET /api/agent-marketplace/sequencer-health — x402 required</li>
                <li>GET /api/agent-marketplace/incident-summary — x402 required</li>
                <li>GET /api/agent-marketplace/batch-submission-status — x402 required</li>
              </ul>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>Payment Envelope Format</h3>
              <code style={{
                display: 'block',
                background: '#F5F5F5',
                padding: 12,
                fontSize: 10,
                lineHeight: 1.4,
                overflowX: 'auto',
              }}>
                {`const envelope = JSON.stringify({ agentId: "agent-123" });
const encoded = Buffer.from(envelope).toString('base64');
// Send: X-PAYMENT: [encoded]`}
              </code>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
