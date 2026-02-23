'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface DocSection {
  title: string;
  items: DocItem[];
}

interface DocItem {
  title: string;
  href: string;
  emoji?: string;
}

const docStructure: DocSection[] = [
  {
    title: 'Start Here',
    items: [
      { title: 'Overview', href: '/docs/guide/overview', emoji: '📖' },
      { title: 'Whitepaper', href: '/docs/whitepaper', emoji: '📄' },
      { title: 'Quick Start (5 min)', href: '/docs/guide/quickstart', emoji: '⚡' },
      { title: 'OP Stack Setup', href: '/docs/guide/optimism-l2-sentinai-local-setup' },
      { title: 'Demo Scenarios', href: '/docs/guide/demo-scenarios' },
      { title: 'Troubleshooting', href: '/docs/guide/troubleshooting', emoji: '🔧' },
    ],
  },
  {
    title: 'Setup & Deployment',
    items: [
      { title: 'Setup Guide', href: '/docs/guide/setup' },
      { title: 'EC2 Deployment', href: '/docs/guide/ec2-setup-guide' },
      { title: 'OP Stack Runbook', href: '/docs/guide/opstack-example-runbook' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { title: 'Daily Operations', href: '/docs/guide/agentic-q1-operations-runbook' },
      { title: 'Autonomy Cockpit', href: '/docs/guide/autonomy-cockpit-user-guide' },
    ],
  },
  {
    title: 'Integrate & Extend',
    items: [
      { title: 'Architecture', href: '/docs/guide/architecture', emoji: '🏗️' },
      { title: 'API Reference', href: '/docs/guide/api-reference', emoji: '📡' },
      { title: 'MCP User Guide', href: '/docs/guide/sentinai-mcp-user-guide' },
      { title: 'Claude MCP Setup', href: '/docs/guide/claude-code-mcp-setup' },
      { title: 'Client Ops Contract', href: '/docs/spec/client-ops-contract' },
      { title: 'Anomaly Detection', href: '/docs/spec/anomaly-detection-guide' },
      { title: 'RCA Engine', href: '/docs/spec/rca-engine-guide' },
    ],
  },
  {
    title: 'Testing & Verification',
    items: [
      { title: 'Testing Guide', href: '/docs/verification/testing-guide' },
      { title: 'Integration Tests', href: '/docs/verification/integration-test-report' },
      { title: 'Dashboard UI Testing', href: '/docs/verification/dashboard-ui-testing-guide' },
    ],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(docStructure.map((s) => s.title))
  );

  function toggleSection(title: string) {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(title)) {
      newExpanded.delete(title);
    } else {
      newExpanded.add(title);
    }
    setExpandedSections(newExpanded);
  }

  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-slate-50 sticky top-0 h-screen overflow-y-auto">
      <div className="p-6 min-w-0">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-6">
          <span>SentinAI</span>
        </Link>

        <nav className="space-y-6">
          {docStructure.map((section) => {
            const isExpanded = expandedSections.has(section.title);
            return (
              <div key={section.title}>
                <button
                  onClick={() => toggleSection(section.title)}
                  className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 mb-2"
                >
                  <span>{section.title}</span>
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </button>
                {isExpanded && (
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                              isActive
                                ? 'bg-blue-50 font-medium text-blue-700'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {item.emoji && <span className="text-base flex-shrink-0">{item.emoji}</span>}
                            <span className="flex-1 min-w-0">{item.title}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
