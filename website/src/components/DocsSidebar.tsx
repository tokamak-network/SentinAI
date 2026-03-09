'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Menu, X } from 'lucide-react';
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
    title: 'Get Started',
    items: [
      { title: 'Overview', href: '/docs/guide/overview', emoji: '📖' },
      { title: 'Quick Start', href: '/docs/guide/quickstart', emoji: '⚡' },
      { title: 'Demo Scenarios', href: '/docs/guide/demo-scenarios' },
      { title: 'Troubleshooting', href: '/docs/guide/troubleshooting', emoji: '🔧' },
    ],
  },
  {
    title: 'Deploy',
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
      { title: 'MCP User Guide', href: '/docs/guide/sentinai-mcp-user-guide' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { title: 'Architecture', href: '/docs/guide/architecture', emoji: '🏗️' },
      { title: 'API Reference', href: '/docs/guide/api-reference', emoji: '📡' },
      { title: 'Anomaly Detection', href: '/docs/spec/anomaly-detection-guide' },
      { title: 'RCA Engine', href: '/docs/spec/rca-engine-guide' },
    ],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(docStructure.map((s) => s.title))
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-md shadow-md border border-slate-200 hover:bg-slate-50"
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? (
          <X className="h-5 w-5 text-slate-700" />
        ) : (
          <Menu className="h-5 w-5 text-slate-700" />
        )}
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop: always visible, Mobile: slide-in */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-40
          w-56 h-screen
          flex flex-col
          border-r border-slate-200 bg-slate-50
          overflow-hidden
          transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="px-4 py-5 border-b border-slate-200">
          <Link href="/" className="flex items-center gap-2 text-base font-bold text-slate-900">
            <span>SentinAI</span>
          </Link>
        </div>

        <nav className="px-4 py-4 space-y-5 overflow-y-auto flex-1">
          {docStructure.map((section) => {
            const isExpanded = expandedSections.has(section.title);
            return (
              <div key={section.title}>
                <button
                  onClick={() => toggleSection(section.title)}
                  className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 mb-1.5"
                >
                  <span className="break-words text-left">{section.title}</span>
                  <ChevronRight
                    className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </button>
                {isExpanded && (
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                              isActive
                                ? 'bg-blue-50 font-medium text-blue-700'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {item.emoji && <span className="text-sm flex-shrink-0">{item.emoji}</span>}
                            <span className="flex-1 break-words leading-snug">{item.title}</span>
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
      </aside>
    </>
  );
}
