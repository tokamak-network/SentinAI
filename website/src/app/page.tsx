import {
  Activity,
  Eye,
  Brain,
  Zap,
  ShieldCheck,
  FileSearch,
  Terminal,
  Cloud,
  ArrowRight,
  CheckCircle2,
  Lock,
  ClipboardList,
  Github,
  ExternalLink,
  Shield,
} from "lucide-react";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";

// ============================================================================
// Navbar
// ============================================================================

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-lg font-bold text-transparent">
            SentinAI
          </span>
        </div>

        {/* Links */}
        <nav className="hidden items-center gap-6 text-sm text-slate-400 sm:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-slate-100"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <a
            href="/docs"
            className="transition-colors hover:text-slate-100"
          >
            Docs
          </a>
        </nav>

        {/* CTA */}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-cyan-500/20 transition-opacity hover:opacity-90"
        >
          Get Started
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}

// ============================================================================
// Hero
// ============================================================================

function Hero() {
  return (
    <section className="relative overflow-hidden pb-24 pt-24">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
        <div className="h-[600px] w-[800px] rounded-full bg-cyan-500/5 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            Autonomous Node Guardian
          </div>

          {/* Heading */}
          <h1 className="mb-6 max-w-3xl text-4xl font-bold tracking-tight text-slate-100 sm:text-5xl lg:text-6xl">
            AI-Native Ops for{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              L2 & Rollup
            </span>{" "}
            Infrastructure
          </h1>

          {/* Subheading */}
          <p className="mb-10 max-w-2xl text-lg text-slate-400">
            SentinAI detects incidents, plans actions by policy, and helps teams
            recover safely with approval-gated automation.
          </p>

          {/* CTAs */}
          <div className="mb-16 flex flex-wrap items-center justify-center gap-4">
            <a
              href={`${GITHUB_URL}#quick-start`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-opacity hover:opacity-90"
            >
              <Terminal className="h-4 w-4" />
              Run Local Demo
            </a>
            <a
              href="/docs"
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              Read Docs
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {/* Terminal code block */}
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 text-left shadow-2xl shadow-slate-950">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-rose-500/80" />
              <span className="h-3 w-3 rounded-full bg-amber-500/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
              <span className="ml-2 text-xs text-slate-500">terminal</span>
            </div>
            {/* Code */}
            <div className="p-4 font-mono text-sm">
              <p className="text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">
                  cp .env.local.sample .env.local
                </span>
              </p>
              <p className="mt-1 text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">docker compose up -d</span>
              </p>
              <p className="mt-2 text-emerald-400">
                ✓ sentinai started on port 3002
              </p>
              <p className="text-cyan-400">
                ✓ agent loop active — observing L2 metrics
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// What it does
// ============================================================================

const capabilities = [
  {
    icon: Eye,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    title: "Real-time Detection",
    description:
      "Monitors L2 operational anomalies in real time — sync failures, sequencer stalls, infra instability.",
  },
  {
    icon: Brain,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    title: "Policy-based Planning",
    description:
      "Generates recovery plans based on risk tiers. Dangerous actions are blocked by default.",
  },
  {
    icon: Zap,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    title: "Auto-execution",
    description:
      "Low-risk remediation actions (restart, scale) execute automatically within policy bounds.",
  },
  {
    icon: ShieldCheck,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    title: "Approval Gating",
    description:
      "High-risk operations (drain, replace, rollback) require human approval via ChatOps.",
  },
  {
    icon: FileSearch,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    title: "Audit Trails",
    description:
      "Every decision, action, and outcome is logged. Full traceability for ops teams and governance.",
  },
];

function WhatItDoes() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-100">
            What it does
          </h2>
          <p className="mx-auto max-w-xl text-slate-400">
            Five capabilities working together to reduce MTTR and operator
            burden for L2 infrastructure teams.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.title}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 transition-colors hover:border-slate-700"
              >
                <div
                  className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${cap.bg}`}
                >
                  <Icon className={`h-5 w-5 ${cap.color}`} />
                </div>
                <h3 className="mb-2 font-semibold text-slate-100">
                  {cap.title}
                </h3>
                <p className="text-sm text-slate-400">{cap.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// How it works
// ============================================================================

const steps = [
  {
    number: "01",
    title: "Observe",
    description:
      "Continuously ingests L1/L2 metrics, RPC responses, pod health, and logs from the chain infrastructure.",
    accent: "border-cyan-500/50 text-cyan-400",
  },
  {
    number: "02",
    title: "Decide",
    description:
      "AI analyzes anomalies, scores severity, selects remediation playbook, and assigns a risk level.",
    accent: "border-blue-500/50 text-blue-400",
  },
  {
    number: "03",
    title: "Act",
    description:
      "Executes low-risk actions automatically. Routes high-risk actions to on-call approval before acting.",
    accent: "border-violet-500/50 text-violet-400",
  },
];

function HowItWorks() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-100">
            How it works
          </h2>
          <p className="mx-auto max-w-xl text-slate-400">
            A simple three-phase loop that runs every 30 seconds on your
            infrastructure.
          </p>
        </div>

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start">
          {steps.map((step, i) => (
            <div key={step.number} className="flex flex-1 flex-col items-center text-center">
              {/* Number */}
              <div
                className={`mb-6 flex h-14 w-14 items-center justify-center rounded-full border-2 bg-slate-900 font-mono text-lg font-bold ${step.accent}`}
              >
                {step.number}
              </div>

              {/* Connector arrow (desktop) */}
              {i < steps.length - 1 && (
                <div className="absolute hidden lg:block" style={{ left: `${(i + 1) * 33.33 - 4}%`, top: "1.75rem" }}>
                  <ArrowRight className="h-6 w-6 text-slate-700" />
                </div>
              )}

              <h3 className="mb-3 text-xl font-semibold text-slate-100">
                {step.title}
              </h3>
              <p className="max-w-xs text-sm text-slate-400">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Deployment Options
// ============================================================================

function Deployment() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-100">
            Deployment Options
          </h2>
          <p className="text-slate-400">
            Start locally in minutes. Scale to production when ready.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Docker Compose */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Terminal className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-slate-100">
              Docker Compose
            </h3>
            <p className="mb-4 text-sm text-slate-400">
              Local development and demo. Up in under 10 minutes.
            </p>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-sm">
              <p className="text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">
                  docker compose up -d
                </span>
              </p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              {["Next.js dashboard on :3002", "Redis state store", "Caddy HTTPS proxy (optional)"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Kubernetes */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
              <Cloud className="h-5 w-5 text-cyan-400" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-slate-100">
              Kubernetes (EKS)
            </h3>
            <p className="mb-4 text-sm text-slate-400">
              Production-grade deployment with real K8s scaling integration.
            </p>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-sm">
              <p className="text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">
                  AWS_CLUSTER_NAME=my-cluster docker compose up -d
                </span>
              </p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              {["Auto-detects EKS region & API endpoint", "Real pod scaling (kubectl integration)", "L1 RPC failover with auto-switch"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Safety & Control
// ============================================================================

const safetyItems = [
  {
    icon: Shield,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    title: "Risk-tiered Policies",
    description:
      "Actions are classified by risk level. Each tier has its own execution policy — from auto-approve to always-block.",
  },
  {
    icon: Lock,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    title: "Destructive Actions Blocked",
    description:
      "Node deletion, data wipes, and other irreversible operations are blocked by default at the policy layer.",
  },
  {
    icon: ShieldCheck,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    title: "Approval Required",
    description:
      "High-risk remediations trigger a ChatOps approval flow. No action is taken without on-call confirmation.",
  },
  {
    icon: ClipboardList,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    title: "Full Audit History",
    description:
      "Every decision, action, and outcome is stored with timestamps. Replay past incidents for post-mortems.",
  },
];

function SafetyControl() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-100">
            Safety & Control
          </h2>
          <p className="mx-auto max-w-xl text-slate-400">
            Autonomous doesn&apos;t mean uncontrolled. Every action is
            governed by policy, risk score, and human approval gates.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {safetyItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="flex gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6 transition-colors hover:border-slate-700"
              >
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.bg}`}
                >
                  <Icon className={`h-5 w-5 ${item.color}`} />
                </div>
                <div>
                  <h3 className="mb-1 font-semibold text-slate-100">
                    {item.title}
                  </h3>
                  <p className="text-sm text-slate-400">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Footer
// ============================================================================

function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-900/30">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-12 text-sm text-slate-500 sm:flex-row sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-blue-600">
              <Activity className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-slate-400">SentinAI</span>
          </div>
          <p className="max-w-xs text-center text-xs sm:text-left">
            Autonomous Node Guardian for L2 & Rollup Infrastructure.
            Built by{" "}
            <a
              href="https://tokamak.network"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-slate-300"
            >
              Tokamak Network
            </a>
            .
          </p>
        </div>

        {/* Links */}
        <nav className="flex items-center gap-6">
          <a
            href="/docs"
            className="hover:text-slate-300"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-slate-300"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <a
            href="https://x.com/tokamak_network"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300"
          >
            X
          </a>
        </nav>
      </div>
    </footer>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />
      <main>
        <Hero />
        <WhatItDoes />
        <HowItWorks />
        <Deployment />
        <SafetyControl />
      </main>
      <Footer />
    </div>
  );
}
