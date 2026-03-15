'use client';

import { Github } from 'lucide-react';
import { HeroMiniature } from '@/components/hero-miniature';

const GITHUB_URL = 'https://github.com/tokamak-network/SentinAI';
const EXAMPLE_DASHBOARD_URL = 'https://sentinai.tokamak.network/thanos-sepolia';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Shared primitives ────────────────────────────────────────────────────────

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


// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section style={{ background: '#FFFFFF', borderBottom: '1px solid #D0D0D0' }}>
      {/* Ticker-style status bar */}
      <div style={{
        background: '#0A0A0A', padding: '0 18px', height: 22,
        display: 'flex', alignItems: 'center', gap: 20, overflow: 'hidden',
      }}>
        {[
          { label: 'STATUS', value: 'OPERATIONAL', color: '#00FF88' },
          { label: 'AGENT LOOP', value: 'ACTIVE · 30s', color: '#00FF88' },
          { label: 'CHAINS', value: 'OP STACK · ARB NITRO · ZK STACK', color: '#FFD700' },
          { label: 'OPEN SOURCE', value: 'MIT LICENSE', color: '#888' },
        ].map(({ label, value, color }) => (
          <span key={label} style={{ fontFamily: FONT, fontSize: 9, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#666', letterSpacing: '0.08em' }}>{label}</span>
            <span style={{ color, fontWeight: 700, letterSpacing: '0.06em' }}>{value}</span>
          </span>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 60 }}>
          {/* Left: text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid #D0D0D0', padding: '3px 10px', marginBottom: 20,
            }}>
              <StatusDot color="#007A00" />
              <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#007A00' }}>
                AUTONOMOUS NODE GUARDIAN
              </span>
            </div>

            {/* Heading */}
            <h1 style={{
              fontFamily: FONT, fontSize: 32, fontWeight: 700,
              color: '#0A0A0A', lineHeight: 1.2, letterSpacing: '0.01em',
              marginBottom: 16, maxWidth: 560,
            }}>
              L1 & L2 Node Infrastructure{' '}
              <span style={{ color: '#D40000' }}>Autonomous Operations</span>
            </h1>

            {/* Sub */}
            <p style={{
              fontFamily: FONT, fontSize: 12, color: '#707070', lineHeight: 1.7,
              marginBottom: 32, maxWidth: 480,
            }}>
              Geth, Reth, OP Stack, Arbitrum — AI-powered 24/7 autonomous ops for every EVM node.
              Anomaly detection, policy-based planning, and approval-gated remediation.
            </p>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 36 }}>
              <a href="/connect" style={{
                background: '#D40000', color: 'white',
                padding: '8px 20px', fontFamily: FONT, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.1em', textDecoration: 'none', display: 'inline-flex',
                alignItems: 'center', gap: 8,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = '#8B0000')}
                onMouseLeave={e => (e.currentTarget.style.background = '#D40000')}
              >
                ▶ CONNECT YOUR NODE
              </a>
              <a href={EXAMPLE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" style={{
                background: 'transparent', color: '#0055AA',
                padding: '8px 20px', fontFamily: FONT, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.1em', textDecoration: 'none', display: 'inline-flex',
                alignItems: 'center', gap: 8, border: '1px solid #0055AA',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#0055AA'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#0055AA'; }}
              >
                VIEW DASHBOARD ↗
              </a>
              <a href="/docs" style={{
                background: 'transparent', color: '#3A3A3A',
                padding: '8px 20px', fontFamily: FONT, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.1em', textDecoration: 'none', display: 'inline-flex',
                alignItems: 'center', gap: 8, border: '1px solid #D0D0D0',
              }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#A0A0A0')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#D0D0D0')}
              >
                READ DOCS
              </a>
            </div>

            {/* Terminal block */}
            <div style={{
              border: '1px solid #D0D0D0', maxWidth: 480, overflow: 'hidden',
            }}>
              <div style={{
                background: '#F7F7F7', borderBottom: '1px solid #D0D0D0',
                padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: '#A0A0A0', letterSpacing: '0.1em' }}>
                  TERMINAL
                </span>
                <span style={{
                  marginLeft: 'auto', background: '#007A00', color: 'white',
                  fontSize: 8, fontFamily: FONT, padding: '1px 6px', fontWeight: 700,
                }}>
                  READY
                </span>
              </div>
              <div style={{ background: '#0A0A0A', padding: '14px 16px', fontFamily: FONT, fontSize: 11 }}>
                <p style={{ color: '#555', marginBottom: 6 }}>
                  <span style={{ color: '#888' }}>$</span>{' '}
                  <span style={{ color: '#D0D0D0' }}>cp .env.local.sample .env.local</span>
                </p>
                <p style={{ color: '#555', marginBottom: 10 }}>
                  <span style={{ color: '#888' }}>$</span>{' '}
                  <span style={{ color: '#D0D0D0' }}>docker compose up -d</span>
                </p>
                <p style={{ color: '#00FF88', marginBottom: 4 }}>
                  ✓ sentinai started on port 3002
                </p>
                <p style={{ color: '#00AAFF' }}>
                  ✓ agent loop active — observing L2 metrics
                </p>
              </div>
            </div>
          </div>

          {/* Right: dashboard miniature */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: 520 }} className="hidden lg:block">
            <HeroMiniature />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Supported Clients ────────────────────────────────────────────────────────

const clientGroups = [
  {
    label: 'L2',
    color: '#D40000',
    clients: ['OP Stack', 'Arbitrum Nitro', 'ZK Stack'],
  },
  {
    label: 'L1 EXECUTION',
    color: '#0055AA',
    clients: ['Geth', 'Reth', 'Nethermind', 'Besu'],
  },
];

function SupportedClients() {
  return (
    <section style={{ borderBottom: '1px solid #D0D0D0' }}>
      <SectionBar>Supported Clients</SectionBar>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px' }}>
        <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
          {clientGroups.map((group, gi) => (
            <div key={group.label} style={{
              flex: 1, minWidth: 200,
              borderRight: gi < clientGroups.length - 1 ? '1px solid #D0D0D0' : 'none',
              padding: '0 20px', paddingLeft: gi === 0 ? 0 : 20,
            }}>
              <div style={{
                fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
                color: group.color, marginBottom: 10, textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <StatusDot color={group.color} />
                {group.label}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {group.clients.map(client => (
                  <span key={client} style={{
                    border: `1px solid ${group.color}30`,
                    background: `${group.color}08`,
                    color: '#3A3A3A',
                    padding: '3px 8px',
                    fontFamily: FONT, fontSize: 10, fontWeight: 500,
                  }}>
                    {client}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── What It Does ─────────────────────────────────────────────────────────────

const capabilities = [
  {
    dot: '#D40000',
    title: 'Real-time Detection',
    description: 'Monitors L2 operational anomalies — sync failures, sequencer stalls, infra instability. Z-Score + AI analysis pipeline.',
  },
  {
    dot: '#0055AA',
    title: 'Policy-based Planning',
    description: 'Generates recovery plans based on risk tiers. Dangerous actions are blocked by default at the policy layer.',
  },
  {
    dot: '#007A00',
    title: 'Auto-execution',
    description: 'Low-risk remediation actions (restart, scale) execute automatically within policy bounds. No human needed for routine ops.',
  },
  {
    dot: '#CC6600',
    title: 'Approval Gating',
    description: 'High-risk operations (drain, replace, rollback) require human approval via ChatOps. Fully auditable.',
  },
  {
    dot: '#0055AA',
    title: 'Audit Trails',
    description: 'Every decision, action, and outcome is logged with timestamps. Full traceability for ops teams and governance.',
  },
  {
    dot: '#D40000',
    title: 'L1 Validator Monitoring',
    description: 'Real-time detection of finality delays, peer isolation, and sync issues before they impact L2 operations.',
  },
];

function WhatItDoes() {
  return (
    <section style={{ borderBottom: '1px solid #D0D0D0' }}>
      <SectionBar>What It Does</SectionBar>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {capabilities.map((cap, i) => (
            <div key={cap.title} style={{
              padding: '18px 20px',
              borderRight: (i + 1) % 3 !== 0 ? '1px solid #F0F0F0' : 'none',
              borderBottom: i < 3 ? '1px solid #F0F0F0' : 'none',
            }}>
              <div style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                color: '#0A0A0A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <StatusDot color={cap.dot} />
                {cap.title.toUpperCase()}
              </div>
              <p style={{ fontFamily: FONT, fontSize: 10, color: '#707070', lineHeight: 1.6 }}>
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const pipeline = [
  {
    phase: 'OBSERVE',
    sub: 'collector · rpc',
    color: '#0055AA',
    fill: '#F0F4FF',
    desc: 'Collect L1/L2 metrics from RPC. Block heights, tx pool, gas ratio, CPU.',
  },
  {
    phase: 'DETECT',
    sub: 'z-score · ai',
    color: '#0055AA',
    fill: '#F0F4FF',
    desc: 'Z-Score statistical anomaly detection + AI semantic analysis (4-layer pipeline).',
  },
  {
    phase: 'ANALYZE',
    sub: 'rca · context',
    color: '#007A00',
    fill: '#F0FFF4',
    desc: 'Root cause analysis traces fault propagation. Goal Manager prioritizes response.',
  },
  {
    phase: 'ACT',
    sub: 'k8s · actions',
    color: '#D40000',
    fill: '#FFF0F0',
    desc: 'Execute scaling or remediation. Verify outcome. Auto-rollback on failure.',
  },
];

function HowItWorks() {
  return (
    <section style={{ borderBottom: '1px solid #D0D0D0' }}>
      <SectionBar>How It Works</SectionBar>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>
        <p style={{ fontFamily: FONT, fontSize: 10, color: '#707070', marginBottom: 24 }}>
          An autonomous agent loop running every 30 seconds.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
          {pipeline.map((node, i) => (
            <div key={node.phase} style={{ display: 'flex', alignItems: 'flex-start', flex: 1 }}>
              {/* Node */}
              <div style={{ flex: 1 }}>
                <div style={{
                  border: `1.5px solid ${node.color}`,
                  background: node.fill,
                  padding: '10px 14px',
                }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 700, color: node.color,
                    letterSpacing: '0.08em', marginBottom: 2,
                  }}>
                    {node.phase}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: '#A0A0A0', marginBottom: 8 }}>
                    {node.sub}
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 9, color: '#707070', lineHeight: 1.5 }}>
                    {node.desc}
                  </p>
                </div>
              </div>
              {/* Arrow */}
              {i < pipeline.length - 1 && (
                <div style={{
                  padding: '12px 6px 0',
                  fontFamily: FONT, fontSize: 14, color: '#A0A0A0', flexShrink: 0,
                }}>
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Deployment ───────────────────────────────────────────────────────────────

function Deployment() {
  return (
    <section style={{ borderBottom: '1px solid #D0D0D0' }}>
      <SectionBar>Deployment Options</SectionBar>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* Docker */}
        <div style={{ padding: '24px', borderRight: '1px solid #D0D0D0' }}>
          <div style={{
            fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            color: '#0A0A0A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <StatusDot color="#007A00" />
            DOCKER COMPOSE
          </div>
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#707070', marginBottom: 14, lineHeight: 1.6 }}>
            Local development and demo. Up in under 10 minutes.
          </p>
          <div style={{ background: '#0A0A0A', padding: '12px 14px', marginBottom: 14 }}>
            <span style={{ color: '#888', fontFamily: FONT, fontSize: 10 }}>$ </span>
            <span style={{ color: '#D0D0D0', fontFamily: FONT, fontSize: 10 }}>docker compose up -d</span>
          </div>
          {['Next.js dashboard on :3002', 'Redis state store', 'Caddy HTTPS proxy (optional)'].map(item => (
            <div key={item} style={{
              fontFamily: FONT, fontSize: 10, color: '#3A3A3A',
              padding: '4px 0', borderBottom: '1px solid #F0F0F0',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ color: '#007A00' }}>✓</span> {item}
            </div>
          ))}
          <a href="/connect" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginTop: 16, background: '#0055AA', color: 'white',
            padding: '7px 16px', fontFamily: FONT, fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', textDecoration: 'none',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = '#003D80')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0055AA')}
          >
            GENERATE SETUP SCRIPT →
          </a>
        </div>

        {/* K8s */}
        <div style={{ padding: '24px' }}>
          <div style={{
            fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            color: '#0A0A0A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <StatusDot color="#0055AA" />
            KUBERNETES (EKS)
          </div>
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#707070', marginBottom: 14, lineHeight: 1.6 }}>
            Production-grade deployment with real K8s scaling integration.
          </p>
          <div style={{ background: '#0A0A0A', padding: '12px 14px', marginBottom: 14 }}>
            <span style={{ color: '#888', fontFamily: FONT, fontSize: 10 }}>$ </span>
            <span style={{ color: '#D0D0D0', fontFamily: FONT, fontSize: 10 }}>
              AWS_CLUSTER_NAME=my-cluster docker compose up -d
            </span>
          </div>
          {['Auto-detects EKS region & API endpoint', 'Real pod scaling (kubectl integration)', 'L1 RPC failover with auto-switch'].map(item => (
            <div key={item} style={{
              fontFamily: FONT, fontSize: 10, color: '#3A3A3A',
              padding: '4px 0', borderBottom: '1px solid #F0F0F0',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ color: '#0055AA' }}>✓</span> {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Safety & Control ─────────────────────────────────────────────────────────

const safetyItems = [
  {
    dot: '#0055AA',
    label: 'RISK-TIERED POLICIES',
    level: 'POLICY',
    levelColor: '#0055AA',
    description: 'Actions are classified by risk level. Each tier has its own execution policy — from auto-approve to always-block.',
  },
  {
    dot: '#D40000',
    label: 'DESTRUCTIVE ACTIONS BLOCKED',
    level: 'BLOCKED',
    levelColor: '#D40000',
    description: 'Node deletion, data wipes, and irreversible operations are blocked by default at the policy layer.',
  },
  {
    dot: '#CC6600',
    label: 'APPROVAL REQUIRED',
    level: 'GATED',
    levelColor: '#CC6600',
    description: 'High-risk remediations trigger a ChatOps approval flow. No action taken without on-call confirmation.',
  },
  {
    dot: '#007A00',
    label: 'FULL AUDIT HISTORY',
    level: 'LOGGED',
    levelColor: '#007A00',
    description: 'Every decision, action, and outcome stored with timestamps. Replay incidents for post-mortems.',
  },
];

function SafetyControl() {
  return (
    <section style={{ borderBottom: '1px solid #D0D0D0' }}>
      <SectionBar>Safety &amp; Control</SectionBar>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {safetyItems.map((item, i) => (
          <div key={item.label} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '12px 24px',
            borderBottom: i < safetyItems.length - 1 ? '1px solid #F0F0F0' : 'none',
          }}>
            <StatusDot color={item.dot} />
            <span style={{
              fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: '#0A0A0A', minWidth: 240,
            }}>
              {item.label}
            </span>
            <span style={{
              fontFamily: FONT, fontSize: 8, fontWeight: 700,
              padding: '2px 6px', border: `1px solid ${item.levelColor}`,
              color: item.levelColor, flexShrink: 0,
            }}>
              {item.level}
            </span>
            <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070', lineHeight: 1.6, flex: 1 }}>
              {item.description}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{ background: '#0A0A0A' }}>
      <div style={{
        maxWidth: 1100, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            background: '#D40000', color: 'white',
            padding: '2px 10px', fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          }}>
            SENTINAI
          </div>
          <span style={{ fontFamily: FONT, fontSize: 9, color: '#555' }}>
            Autonomous Node Guardian · Built by{' '}
            <a href="https://tokamak.network" target="_blank" rel="noopener noreferrer"
              style={{ color: '#888', textDecoration: 'none' }}>
              Tokamak Network
            </a>
          </span>
        </div>

        {/* Links */}
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          {[
            { href: '/docs', label: 'DOCS' },
            { href: GITHUB_URL, label: 'GITHUB', external: true },
            { href: 'https://x.com/tokamak_network', label: 'X / TWITTER', external: true },
          ].map(({ href, label, external }) => (
            <a key={label} href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              style={{
                fontFamily: FONT, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                color: '#666', textDecoration: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', fontFamily: FONT }}>
      <main>
        <Hero />
        <SupportedClients />
        <WhatItDoes />
        <HowItWorks />
        <Deployment />
        <SafetyControl />
      </main>
      <Footer />
    </div>
  );
}
