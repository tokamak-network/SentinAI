# Docs Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the raw README.md dump with a clean, hardcoded landing page and trim the sidebar to 14 essential items.

**Architecture:** Four independent tasks — sidebar cleanup, page layout fixes, H1 dedup in MarkdownRenderer, and a new hardcoded landing page at `docs/page.tsx` that takes routing priority over the `[[...slug]]` catch-all.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Lucide icons

---

### Task 1: Sidebar — reduce to 4 sections, 14 items

**Files:**
- Modify: `website/src/components/DocsSidebar.tsx:19-66`

**Step 1: Replace `docStructure`**

Replace the entire `docStructure` array with:

```ts
const docStructure: DocSection[] = [
  {
    title: 'Get Started',
    items: [
      { title: 'Overview', href: '/guide/overview', emoji: '📖' },
      { title: 'Quick Start', href: '/guide/quickstart', emoji: '⚡' },
      { title: 'Demo Scenarios', href: '/guide/demo-scenarios' },
      { title: 'Troubleshooting', href: '/guide/troubleshooting', emoji: '🔧' },
    ],
  },
  {
    title: 'Deploy',
    items: [
      { title: 'Setup Guide', href: '/guide/setup' },
      { title: 'EC2 Deployment', href: '/guide/ec2-setup-guide' },
      { title: 'OP Stack Runbook', href: '/guide/opstack-example-runbook' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { title: 'Daily Operations', href: '/guide/agentic-q1-operations-runbook' },
      { title: 'Autonomy Cockpit', href: '/guide/autonomy-cockpit-user-guide' },
      { title: 'MCP User Guide', href: '/guide/sentinai-mcp-user-guide' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { title: 'Architecture', href: '/guide/architecture', emoji: '🏗️' },
      { title: 'API Reference', href: '/guide/api-reference', emoji: '📡' },
      { title: 'Anomaly Detection', href: '/spec/anomaly-detection-guide' },
      { title: 'RCA Engine', href: '/spec/rca-engine-guide' },
    ],
  },
];
```

**Step 2: Verify visually**

Open http://localhost:3002/docs (or check Vercel preview). Sidebar should show 4 sections, 14 links.

**Step 3: Commit**

```bash
git add website/src/components/DocsSidebar.tsx
git commit -m "docs(sidebar): reduce to 4 sections, 14 items"
```

---

### Task 2: Individual page layout — hide file path, fix max-width

**Files:**
- Modify: `website/src/app/docs/[[...slug]]/page.tsx:83-116`

**Step 1: Remove the file path line**

Find and delete this line (~line 93):
```tsx
<p className="text-xs text-slate-500 mt-1 break-all">{target.relativePath}</p>
```

**Step 2: Narrow max-width**

Change:
```tsx
<div className="mx-auto max-w-[1400px]">
```
To:
```tsx
<div className="mx-auto max-w-4xl xl:max-w-5xl">
```

**Step 3: Commit**

```bash
git add website/src/app/docs/[[...slug]]/page.tsx
git commit -m "docs(layout): hide file path, narrow max-width"
```

---

### Task 3: MarkdownRenderer — skip first H1

**Files:**
- Modify: `website/src/components/MarkdownRenderer.tsx`
- Modify: `website/src/app/docs/[[...slug]]/page.tsx` (pass the prop)

**Step 1: Add `skipFirstH1` prop and tracking ref**

Replace the component signature and add a ref to track whether the first H1 has been skipped:

```tsx
interface MarkdownRendererProps {
  content: string;
  skipFirstH1?: boolean;
}

export default function MarkdownRenderer({ content, skipFirstH1 = false }: MarkdownRendererProps) {
  const firstH1Skipped = { current: false };
  // ... rest unchanged
```

**Step 2: Update the `h1` component handler**

Replace the existing `h1` handler inside `components`:

```tsx
h1: ({ children }) => {
  if (skipFirstH1 && !firstH1Skipped.current) {
    firstH1Skipped.current = true;
    return null;
  }
  const id = String(children)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
  return (
    <h1 id={id} className="text-3xl lg:text-4xl font-bold text-slate-900 mb-5 mt-6 first:mt-0 leading-tight">
      {children}
    </h1>
  );
},
```

**Step 3: Pass `skipFirstH1` in the docs page**

In `website/src/app/docs/[[...slug]]/page.tsx`, update the MarkdownRenderer call:

```tsx
<MarkdownRenderer content={content} skipFirstH1 />
```

**Step 4: Commit**

```bash
git add website/src/components/MarkdownRenderer.tsx website/src/app/docs/[[...slug]]/page.tsx
git commit -m "docs(renderer): skip first H1 to avoid duplicate title"
```

---

### Task 4: Hardcoded landing page

**Files:**
- Create: `website/src/app/docs/page.tsx`

> **Note:** In Next.js, `app/docs/page.tsx` takes routing priority over `app/docs/[[...slug]]/page.tsx` for the `/docs` path. No changes needed to the slug route.

**Step 1: Create the file**

```tsx
import Link from 'next/link';
import DocsSidebar from '@/components/DocsSidebar';

const CARDS = [
  {
    emoji: '🚀',
    title: 'Get Started',
    description: 'Install, connect, and run your first simulation.',
    links: [
      { label: 'Overview', href: '/guide/overview' },
      { label: 'Quick Start (5 min)', href: '/guide/quickstart' },
      { label: 'Demo Scenarios', href: '/guide/demo-scenarios' },
      { label: 'Troubleshooting', href: '/guide/troubleshooting' },
    ],
  },
  {
    emoji: '⚙️',
    title: 'Deploy',
    description: 'Run SentinAI on Docker, EC2, or alongside your OP Stack node.',
    links: [
      { label: 'Local Setup (Docker)', href: '/guide/setup' },
      { label: 'EC2 Deployment', href: '/guide/ec2-setup-guide' },
      { label: 'OP Stack Runbook', href: '/guide/opstack-example-runbook' },
      { label: 'Environment Variables', href: '/guide/setup' },
    ],
  },
  {
    emoji: '🔌',
    title: 'Integrate & Extend',
    description: 'Connect via API or MCP, understand the architecture, add custom chains.',
    links: [
      { label: 'Architecture', href: '/guide/architecture' },
      { label: 'API Reference', href: '/guide/api-reference' },
      { label: 'MCP Setup', href: '/guide/sentinai-mcp-user-guide' },
      { label: 'Anomaly Detection', href: '/spec/anomaly-detection-guide' },
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
                href="/guide/quickstart"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                ⚡ Quick Start
              </Link>
              <Link
                href="/guide/architecture"
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
```

**Step 2: Verify**

Navigate to `/docs`. Should show:
- Sidebar with 4 sections
- Header with "Documentation" title + 2 CTA buttons
- 2×2 card grid (4 cards, each with links)
- No README.md content, no internal references

**Step 3: Commit**

```bash
git add website/src/app/docs/page.tsx
git commit -m "feat(docs): add hardcoded landing page with card grid"
```

---

### Task 5: Deploy

```bash
git push origin main
```

Vercel auto-deploys. Check https://sentinai-xi.vercel.app/docs after ~2 minutes.
