'use client';

import { Github } from 'lucide-react';

const GITHUB_URL = 'https://github.com/tokamak-network/SentinAI';
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, marginRight: 6, flexShrink: 0,
    }} />
  );
}

export function Navbar() {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: '#FFFFFF', borderBottom: '1px solid #D0D0D0',
      display: 'flex', alignItems: 'stretch', height: 40,
    }}>
      {/* Brand block */}
      <a href="/" style={{
        background: '#D40000', color: 'white', textDecoration: 'none',
        padding: '0 18px', display: 'flex', alignItems: 'center',
        borderRight: '2px solid #8B0000', flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>
          SENTINAI
        </span>
      </a>

      {/* Nav links */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 0, marginLeft: 0, flex: 1,
      }}>
        {[
          { href: '/docs', label: 'DOCS' },
          { href: '/marketplace', label: 'MARKETPLACE' },
        ].map(({ href, label }) => (
          <a key={label} href={href} style={{
            fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
            color: '#3A3A3A', textDecoration: 'none', padding: '0 16px', height: '100%',
            display: 'flex', alignItems: 'center',
            borderRight: '1px solid #E8E8E8',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = '#D40000')}
            onMouseLeave={e => (e.currentTarget.style.color = '#3A3A3A')}
          >
            {label}
          </a>
        ))}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{
          fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
          color: '#3A3A3A', textDecoration: 'none', padding: '0 16px', height: '100%',
          display: 'flex', alignItems: 'center', gap: 6,
          borderRight: '1px solid #E8E8E8',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = '#D40000')}
          onMouseLeave={e => (e.currentTarget.style.color = '#3A3A3A')}
        >
          <Github size={13} />
          GITHUB
        </a>
      </nav>

      {/* CTA */}
      <a href="/connect" style={{
        background: '#D40000', color: 'white',
        padding: '0 20px', display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        textDecoration: 'none', borderLeft: '2px solid #8B0000',
      }}
        onMouseEnter={e => (e.currentTarget.style.background = '#8B0000')}
        onMouseLeave={e => (e.currentTarget.style.background = '#D40000')}
      >
        CONNECT NODE →
      </a>
    </header>
  );
}
