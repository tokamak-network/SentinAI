import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Github,
  Shield,
} from 'lucide-react';

type SectionCard = {
  title: string;
  description: string;
};

type Step = {
  title: string;
  description: string;
};

const whatItDoes: SectionCard[] = [
  { title: 'Real-time anomaly detection', description: 'Monitors sync health, sequencer behavior, and infrastructure drift in one stream.' },
  { title: 'Policy-based action planning', description: 'Generates incident response plans aligned with configurable operational policy.' },
  { title: 'Safe auto-remediation', description: 'Executes low-risk actions automatically and verifies outcomes before closing the loop.' },
  { title: 'Approval-gated high-risk actions', description: 'Requests explicit ChatOps approval before potentially disruptive operations.' },
  { title: 'Auditable execution trail', description: 'Preserves decision traces, actions, and verification evidence for every incident.' },
];

const whyNow: string[] = [
  'L2 and Rollup operations now span more components, dependencies, and failure modes.',
  'Manual triage increases MTTR and operator burden as traffic and stack complexity grow.',
  'Teams need safe automation with governance instead of opaque black-box autopilot.',
];

const howItWorks: Step[] = [
  { title: 'Observe', description: 'Continuously ingests metrics, logs, and RPC signals.' },
  { title: 'Decide', description: 'Analyzes incidents and builds a risk-scored action plan.' },
  { title: 'Act', description: 'Executes approved actions and verifies recovery status.' },
];

const deploymentOptions: SectionCard[] = [
  {
    title: 'Local Container (Docker Compose)',
    description: 'Fast 10-minute local setup for evaluation, demos, and development workflows.',
  },
  {
    title: 'Kubernetes (AWS EKS)',
    description: 'Production-grade deployment path that scales with team and infrastructure complexity.',
  },
];

const safetyControls: string[] = [
  'Risk-tiered policy levels (low / medium / high / critical)',
  'Destructive actions forbidden by default',
  'High-risk actions require explicit approval',
  'Full audit history for every decision and action',
];

const proofPlaceholders: string[] = [
  'Incident detection latency (Observed in DRY_RUN)',
  'Auto-remediation success rate (Observed in DRY_RUN)',
  'False action rate (Observed in DRY_RUN)',
];

const docsNavigation = [
  { title: 'Introduction', href: '/docs/README.md#1-introduction' },
  { title: 'Quickstart', href: '/docs/README.md#2-quickstart-10-min' },
  { title: 'Installation', href: '/docs/README.md#3-installation' },
  { title: 'Configuration', href: '/docs/README.md#4-configuration' },
  { title: 'Operations Runbook', href: '/docs/README.md#5-operations-runbook' },
  { title: 'Playbooks', href: '/docs/README.md#6-playbooks' },
  { title: 'API & MCP', href: '/docs/README.md#7-api--mcp' },
  { title: 'Safety Model', href: '/docs/README.md#8-safety-model' },
  { title: 'Observability', href: '/docs/README.md#9-observability' },
  { title: 'Troubleshooting', href: '/docs/README.md#10-troubleshooting' },
  { title: 'Contributing', href: '/docs/README.md#11-contributing' },
  { title: 'Changelog', href: '/docs/README.md#12-changelog' },
];

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-2 text-2xl md:text-3xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-2 text-sm text-slate-600 max-w-3xl">{subtitle}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-12 md:py-20 space-y-16">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-6">
            <Shield className="h-4 w-4 text-blue-600" />
            <span>SentinAI</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight max-w-4xl">
            AI-Native Ops for L2 & Rollup Infrastructure
          </h1>
          <p className="mt-5 max-w-3xl text-slate-600 text-lg">
            SentinAI detects incidents, plans actions by policy, and helps teams recover safely with approval-gated automation.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs/guide/optimism-l2-sentinai-local-setup.md" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              Run Local Demo (Docker)
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/docs/guide/ec2-setup-guide.md" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Deploy to EKS
            </Link>
            <Link href="/docs/README.md" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Read Docs
            </Link>
            <Link href="/docs/guide/demo-scenarios.md" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Watch Guided Demo
            </Link>
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Capabilities" title="What it does" />
          <div className="grid gap-4 md:grid-cols-2">
            {whatItDoes.map((item) => (
              <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Context" title="Why now" />
          <ul className="space-y-3">
            {whyNow.map((item) => (
              <li key={item} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <CircleDot className="mt-0.5 h-4 w-4 text-blue-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle eyebrow="Flow" title="How it works" />
          <div className="grid gap-4 md:grid-cols-3">
            {howItWorks.map((step, index) => (
              <article key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold text-blue-600">Step {index + 1}</p>
                <h3 className="mt-2 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Deployment" title="Deployment options" />
          <div className="grid gap-4 md:grid-cols-2">
            {deploymentOptions.map((option) => (
              <article key={option.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">{option.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{option.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Governance" title="Safety & control" />
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <ul className="space-y-3">
              {safetyControls.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Evidence" title="Proof / evidence" subtitle="Production baselines are pending publication. Until then, present metrics with an explicit DRY_RUN label." />
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <ul className="space-y-3">
              {proofPlaceholders.map((item) => (
                <li key={item} className="text-sm text-slate-700">• {item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Docs" title="Docs navigation" subtitle="Information architecture from docs/brand/docs-ia.md wired into the docs index." />
          <div className="grid gap-2 md:grid-cols-2">
            {docsNavigation.map((item) => (
              <Link key={item.title} href={item.href} className="group rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-100">
                <span className="inline-flex items-center gap-2">
                  {item.title}
                  <ExternalLink className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-6 text-sm text-slate-600">
          <Link href="/docs/README.md" className="hover:text-slate-900">Docs</Link>
          <a href="https://github.com/tokamak-network/SentinAI" className="inline-flex items-center gap-1 hover:text-slate-900" target="_blank" rel="noreferrer">
            GitHub <Github className="h-3.5 w-3.5" />
          </a>
          <a href="https://x.com" className="hover:text-slate-900" target="_blank" rel="noreferrer">X (Twitter)</a>
          <a href="mailto:contact@sentinai.ai" className="hover:text-slate-900">Contact</a>
        </div>
      </footer>
    </main>
  );
}
