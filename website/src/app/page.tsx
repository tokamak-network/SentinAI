'use client';

import {
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HeroMiniature } from "@/components/hero-miniature";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";
const EXAMPLE_DASHBOARD_URL = "https://sentinai.tokamak.network/thanos-sepolia";

// ============================================================================
// Navbar
// ============================================================================

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <ShieldCheck className="h-4 w-4 text-white" />
          </div>
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-lg font-bold text-transparent">
            SentinAI
          </span>
        </div>

        {/* Links */}
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <a
            href="/docs"
            className="transition-colors hover:text-foreground"
          >
            Docs
          </a>
          <a href="/setup" className="transition-colors hover:text-foreground">
            Deploy
          </a>
        </nav>

        {/* CTA */}
        <Button asChild size="sm" className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-primary/20 hover:opacity-90 hover:bg-primary">
          <a href="/connect">
            Connect Your Node
            <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
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
        <div className="flex items-center gap-12 lg:gap-16">
          {/* Hero text content */}
          <div className="flex-1 flex flex-col items-center text-center lg:items-start lg:text-left">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Autonomous Node Guardian
            </div>

            {/* Heading */}
            <h1 className="mb-6 max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              L1 & L2 Node Infrastructure{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Autonomous Operations
              </span>
            </h1>

            {/* Subheading */}
            <p className="mb-10 max-w-2xl text-lg text-muted-foreground">
              Geth, Reth, OP Stack, Arbitrum — AI-powered 24/7 autonomous operations for every EVM node.
              Reduce operator burden with anomaly detection, policy-based planning, and approval gate automation.
            </p>

            {/* CTAs */}
            <div className="mb-16 flex flex-wrap items-center justify-center lg:justify-start gap-4">
              <Button asChild size="lg" className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-primary/20 hover:opacity-90 hover:bg-primary">
                <a href="/connect">
                  <Terminal className="h-4 w-4" />
                  Connect Your Node
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-border bg-card/50 text-foreground hover:border-border/70 hover:text-foreground">
                <a href={EXAMPLE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  View Example Dashboard
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-border bg-card/50 text-foreground hover:border-border/70 hover:text-foreground">
                <a href="/docs">
                  Read Docs
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>

            {/* Terminal code block */}
            <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card/80 text-left shadow-2xl shadow-background">
              {/* Title bar */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
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

          {/* Hero miniature */}
          <div className="shrink-0 hidden lg:block">
            <HeroMiniature />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Supported Clients
// ============================================================================

const clientGroups = [
  {
    label: "L1 Execution",
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/5",
    clients: ["Geth", "Reth", "Nethermind", "Besu"],
  },
  {
    label: "L2",
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    bgColor: "bg-cyan-500/5",
    clients: ["OP Stack", "Arbitrum Nitro", "ZK Stack"],
  },
  {
    label: "L1 Consensus",
    color: "text-violet-400",
    borderColor: "border-violet-500/30",
    bgColor: "bg-violet-500/5",
    clients: ["Lighthouse", "Prysm", "Teku"],
  },
];

function SupportedClients() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground/80">
            Supported Clients
          </h2>
          <p className="text-sm text-muted-foreground">
            Compatible with all major EVM execution, consensus, and L2 clients
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          {clientGroups.map((group) => (
            <div
              key={group.label}
              className={`flex w-full flex-col gap-3 rounded-xl border ${group.borderColor} ${group.bgColor} p-4 sm:w-auto sm:min-w-[200px]`}
            >
              <span className={`text-xs font-semibold uppercase tracking-wider ${group.color}`}>
                {group.label}
              </span>
              <div className="flex flex-wrap gap-2">
                {group.clients.map((client) => (
                  <span
                    key={client}
                    className="rounded-md border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground/80"
                  >
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
  {
    icon: Shield,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    title: "L1 Validator Monitoring",
    description:
      "Real-time detection of finality delays, peer isolation, and sync issues. Block L1 consensus anomalies before they impact L2 operations.",
  },
];

function WhatItDoes() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground">
            What it does
          </h2>
          <p className="mx-auto max-w-xl text-muted-foreground">
            Five capabilities working together to reduce MTTR and operator
            burden for L2 infrastructure teams.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <Card
                key={cap.title}
                className="transition-colors hover:border-border/70"
              >
                <CardContent className="p-6">
                  <div
                    className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${cap.bg}`}
                  >
                    <Icon className={`h-5 w-5 ${cap.color}`} />
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground">
                    {cap.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{cap.description}</p>
                </CardContent>
              </Card>
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
    title: "Observe & Detect",
    description:
      "Collect L1/L2 metrics and run the 4-layer anomaly detection pipeline (Z-Score + AI analysis).",
    accent: "border-cyan-500/50 text-cyan-400",
  },
  {
    number: "02",
    title: "Analyze & Plan",
    description:
      "Trace root causes with AI RCA. The Goal Manager prioritizes and plans the response.",
    accent: "border-blue-500/50 text-blue-400",
  },
  {
    number: "03",
    title: "Act & Verify",
    description:
      "Execute scaling or remediation, then verify the outcome. Automatic rollback on failure.",
    accent: "border-violet-500/50 text-violet-400",
  },
];

function HowItWorks() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground">
            How it works
          </h2>
          <p className="mx-auto max-w-xl text-muted-foreground">
            An agent loop running every 30 seconds — observe, analyze, and act to autonomously manage your infrastructure.
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

              <h3 className="mb-3 text-xl font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="max-w-xs text-sm text-muted-foreground">
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
          <h2 className="mb-4 text-3xl font-bold text-foreground">
            Deployment Options
          </h2>
          <p className="text-muted-foreground">
            Start locally in minutes. Scale to production when ready.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Docker Compose */}
          <div className="rounded-xl border border-border bg-card/50 p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Terminal className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-foreground">
              Docker Compose
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Local development and demo. Up in under 10 minutes.
            </p>
            <div className="rounded-lg border border-border bg-background p-4 font-mono text-sm">
              <p className="text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">
                  docker compose up -d
                </span>
              </p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {["Next.js dashboard on :3002", "Redis state store", "Caddy HTTPS proxy (optional)"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild className="mt-6 w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg hover:opacity-90 hover:bg-primary">
              <a href="/setup">
                <Terminal className="h-4 w-4" />
                Generate Setup Script
              </a>
            </Button>
          </div>

          {/* Kubernetes */}
          <div className="rounded-xl border border-border bg-card/50 p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
              <Cloud className="h-5 w-5 text-cyan-400" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-foreground">
              Kubernetes (EKS)
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Production-grade deployment with real K8s scaling integration.
            </p>
            <div className="rounded-lg border border-border bg-background p-4 font-mono text-sm">
              <p className="text-slate-500">
                <span className="text-slate-600">$</span>{" "}
                <span className="text-slate-300">
                  AWS_CLUSTER_NAME=my-cluster docker compose up -d
                </span>
              </p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
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
          <h2 className="mb-4 text-3xl font-bold text-foreground">
            Safety & Control
          </h2>
          <p className="mx-auto max-w-xl text-muted-foreground">
            Autonomous doesn&apos;t mean uncontrolled. Every action is
            governed by policy, risk score, and human approval gates.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {safetyItems.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.title}
                className="transition-colors hover:border-border/70"
              >
                <CardContent className="flex gap-4 p-6">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.bg}`}
                  >
                    <Icon className={`h-5 w-5 ${item.color}`} />
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </CardContent>
              </Card>
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
    <footer className="border-t border-border bg-card/30">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-12 text-sm text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-blue-600">
              <ShieldCheck className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-foreground/70">SentinAI</span>
          </div>
          <p className="max-w-xs text-center text-xs sm:text-left">
            Autonomous Node Guardian for L2 & Rollup Infrastructure.
            Built by{" "}
            <a
              href="https://tokamak.network"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
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
            className="hover:text-foreground"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <a
            href="https://x.com/tokamak_network"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
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
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
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
