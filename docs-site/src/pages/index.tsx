import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

const CARDS = [
  {
    emoji: '🚀',
    title: 'Get Started',
    description: 'Understand what SentinAI does and get it running in 5 minutes.',
    links: [
      { label: 'Overview', href: '/docs/guide/overview' },
      { label: 'Quick Start (5 min)', href: '/docs/guide/quickstart' },
      { label: 'Troubleshooting', href: '/docs/guide/troubleshooting' },
    ],
  },
  {
    emoji: '⚙️',
    title: 'Deploy',
    description: 'Run SentinAI on Docker, EC2, or alongside your chain node.',
    links: [
      { label: 'Docker Setup', href: '/docs/guide/setup' },
      { label: 'EC2 Deployment', href: '/docs/guide/ec2-setup-guide' },
      { label: 'OP Stack', href: '/docs/guide/opstack-example-runbook' },
      { label: 'Arbitrum Orbit', href: '/docs/guide/arbitrum-orbit-local-setup' },
    ],
  },
  {
    emoji: '📚',
    title: 'Reference',
    description: 'Architecture deep-dive, REST API, and external integrations.',
    links: [
      { label: 'Architecture', href: '/docs/guide/architecture' },
      { label: 'API Reference', href: '/docs/guide/api-reference' },
      { label: 'MCP Integration', href: '/docs/guide/sentinai-mcp-user-guide' },
    ],
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="hero hero--primary" style={{ backgroundColor: 'transparent', textAlign: 'center', padding: '6rem 2rem', color: 'inherit' }}>
      <div className="container">
        <h1 className="hero__title" style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '1rem' }}>
          SentinAI
        </h1>
        <p className="hero__subtitle" style={{ fontSize: '1.25rem', opacity: 0.8, maxWidth: '600px', margin: '0 auto 2.5rem' }}>
          Autonomous monitoring and auto-scaling for L2 blockchain nodes.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <Link
            className="button button--primary"
            style={{ borderRadius: '8px', padding: '12px 24px', fontWeight: 600, color: '#fff' }}
            to="/docs/guide/quickstart">
            ⚡ Quick Start
          </Link>
          <Link
            className="button button--secondary button--outline"
            style={{ borderRadius: '8px', padding: '12px 24px', fontWeight: 600 }}
            to="/docs/guide/architecture">
            🏗️ Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): React.ReactNode {
  return (
    <Layout
      title="Documentation"
      description="SentinAI autonomous node guardian documentation">
      <HomepageHeader />
      <main style={{ padding: '2rem 1rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
          {CARDS.map((card) => (
            <div
              key={card.title}
              className="card"
              style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{card.emoji}</span>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{card.title}</h2>
              </div>
              <p style={{ fontSize: '0.875rem', opacity: 0.8, marginBottom: '1.5rem', lineHeight: 1.6, flexGrow: 1 }}>{card.description}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {card.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      to={link.href}
                      style={{ fontSize: '0.9rem', color: 'var(--ifm-color-primary)', textDecoration: 'none', fontWeight: 500 }}
                      onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {link.label} →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </main>
    </Layout>
  );
}
