import Link from 'next/link';
import DocsSidebar from '@/components/DocsSidebar';

const CARDS = [
  {
    emoji: '🚀',
    title: 'Get Started',
    description: 'Install, connect, and run your first simulation.',
    links: [
      { label: 'Overview', href: '/docs/guide/overview' },
      { label: 'Quick Start (5 min)', href: '/docs/guide/quickstart' },
      { label: 'Demo Scenarios', href: '/docs/guide/demo-scenarios' },
      { label: 'Troubleshooting', href: '/docs/guide/troubleshooting' },
    ],
  },
  {
    emoji: '⚙️',
    title: 'Deploy',
    description: 'Run SentinAI on Docker, EC2, or alongside your OP Stack node.',
    links: [
      { label: 'Local Setup (Docker)', href: '/docs/guide/setup' },
      { label: 'EC2 Deployment', href: '/docs/guide/ec2-setup-guide' },
      { label: 'OP Stack Runbook', href: '/docs/guide/opstack-example-runbook' },
      { label: 'Environment Variables', href: '/docs/guide/setup' },
    ],
  },
  {
    emoji: '🔌',
    title: 'Integrate & Extend',
    description: 'Connect via API or MCP, understand the architecture, add custom chains.',
    links: [
      { label: 'Architecture', href: '/docs/guide/architecture' },
      { label: 'API Reference', href: '/docs/guide/api-reference' },
      { label: 'MCP Setup', href: '/docs/guide/sentinai-mcp-user-guide' },
      { label: 'Anomaly Detection', href: '/docs/spec/anomaly-detection-guide' },
    ],
  },
  {
    emoji: '✅',
    title: 'Verify',
    description: 'Run the test suite, review integration reports, and validate your deployment.',
    links: [
      { label: 'Testing Guide', href: '/docs/verification/testing-guide' },
      { label: 'Integration Tests', href: '/docs/verification/integration-test-report' },
      { label: 'Dashboard UI Testing', href: '/docs/verification/dashboard-ui-testing-guide' },
    ],
  },
];

export default function DocsLandingPage() {
  return (
    <div className="flex min-h-screen">
      <DocsSidebar />

      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-10 lg:ml-0">
        <div className="mx-auto max-w-4xl">

          {/* Header */}
          <div className="mb-10">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">
              SentinAI Docs
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">
              Documentation
            </h1>
            <p className="text-slate-500 text-base mb-6 max-w-xl">
              Autonomous monitoring and auto-scaling for L2 blockchain nodes.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link
                href="/docs/guide/quickstart"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                ⚡ Quick Start
              </Link>
              <Link
                href="/docs/guide/architecture"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                🏗️ Architecture
              </Link>
            </div>
          </div>

          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {CARDS.map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{card.emoji}</span>
                  <h2 className="text-base font-semibold text-slate-900">{card.title}</h2>
                </div>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">{card.description}</p>
                <ul className="space-y-1.5">
                  {card.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-blue-600 hover:text-blue-500 hover:underline transition-colors"
                      >
                        {link.label} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

        </div>
      </main>
    </div>
  );
}
