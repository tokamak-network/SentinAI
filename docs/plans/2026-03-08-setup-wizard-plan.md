# Setup Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/setup` page to `website/` that generates a one-shot shell script for self-hosting SentinAI with any EVM client.

**Architecture:** Pure client-side generation — no backend, no API calls. A form collects EVM client config, a pure function (`generate-setup-script.ts`) produces a shell script string, displayed in a code block with a Copy button. The landing page `Deployment` section gets a CTA button linking to `/setup`.

**Tech Stack:** Next.js 15 (website/), React 19, Tailwind CSS 4, Lucide icons, TypeScript strict mode.

---

## Context

**Existing files to read before starting:**
- `website/src/app/connect/page.tsx` — reference for CodeBlock pattern, copy logic, form UI style
- `website/src/app/page.tsx` — landing page to add CTA button to

**Key constraints:**
- `website/` is a separate Next.js app from `src/app/` (dashboard)
- All components in `website/` must be compatible with Vercel static deployment
- Follow existing dark theme: `bg-slate-950`, `border-slate-800`, `text-slate-100`
- The `CodeBlock` component in `connect/page.tsx` can be copied as a pattern — do NOT import from there, just duplicate the pattern

---

## Task 1: Script Generator (Pure Function)

**Files:**
- Create: `website/src/lib/generate-setup-script.ts`

**Step 1: Create the file**

```typescript
// website/src/lib/generate-setup-script.ts

const COMPOSE_RAW_URL =
  'https://raw.githubusercontent.com/tokamak-network/SentinAI/main/docker-compose.yml';

const AI_KEY_VAR: Record<string, string> = {
  qwen: 'QWEN_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export type AiProvider = 'none' | 'qwen' | 'anthropic' | 'openai' | 'gemini';

export type ClientFamily =
  | 'geth'
  | 'reth'
  | 'nethermind'
  | 'besu'
  | 'erigon'
  | 'op-geth'
  | 'nitro-node'
  | 'ethrex'
  | 'other';

export interface SetupConfig {
  clientFamily: ClientFamily;
  rpcUrl: string;
  networkName: string;
  aiProvider: AiProvider;
  aiApiKey: string;
}

export function generateSetupScript(config: SetupConfig): string {
  const rpcUrl = config.rpcUrl.trim() || '<your-rpc-url>';
  const networkName = config.networkName.trim() || 'My Network';

  // ethrex uses geth-compatible API
  const clientFamily = config.clientFamily === 'ethrex' ? 'geth' : config.clientFamily;

  const envLines: string[] = [
    `NEXT_PUBLIC_NETWORK_NAME=${networkName}`,
    `L2_RPC_URL=${rpcUrl}`,
  ];

  if (clientFamily !== 'other') {
    envLines.push(`SENTINAI_CLIENT_FAMILY=${clientFamily}`);
  }

  envLines.push('SCALING_SIMULATION_MODE=true');

  if (config.aiProvider !== 'none' && config.aiApiKey.trim()) {
    envLines.push(`${AI_KEY_VAR[config.aiProvider]}=${config.aiApiKey.trim()}`);
  }

  return `#!/bin/bash
set -e
mkdir -p sentinai && cd sentinai
curl -sSL ${COMPOSE_RAW_URL} -o docker-compose.yml
cat > .env.local << 'SENTINAI_EOF'
${envLines.join('\n')}
SENTINAI_EOF
docker compose up -d
echo "✓ SentinAI is running at http://localhost:3002"`;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add website/src/lib/generate-setup-script.ts
git commit -m "feat(website): add setup script generator utility"
```

---

## Task 2: Setup Wizard Page

**Files:**
- Create: `website/src/app/setup/page.tsx`

**Step 1: Create the page**

```tsx
// website/src/app/setup/page.tsx
"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Github,
  Terminal,
  Copy,
  Check,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import {
  generateSetupScript,
  type SetupConfig,
  type ClientFamily,
  type AiProvider,
} from "@/lib/generate-setup-script";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";

const CLIENT_OPTIONS: { value: ClientFamily; label: string }[] = [
  { value: "geth", label: "Geth" },
  { value: "reth", label: "Reth" },
  { value: "nethermind", label: "Nethermind" },
  { value: "besu", label: "Besu" },
  { value: "erigon", label: "Erigon" },
  { value: "op-geth", label: "OP Geth (OP Stack)" },
  { value: "nitro-node", label: "Nitro Node (Arbitrum)" },
  { value: "ethrex", label: "Ethrex" },
  { value: "other", label: "기타 (자동 감지)" },
];

const AI_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: "none", label: "없음 (나중에 설정)" },
  { value: "qwen", label: "Qwen (DashScope)" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
];

// ── Navbar ──────────────────────────────────────────────────────────────────

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <ShieldCheck className="h-4 w-4 text-white" />
          </div>
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-lg font-bold text-transparent">
            SentinAI
          </span>
        </a>
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
          <a href="/docs" className="transition-colors hover:text-slate-100">
            Docs
          </a>
        </nav>
      </div>
    </header>
  );
}

// ── Code Block ───────────────────────────────────────────────────────────────

function CodeBlock({ content, disabled }: { content: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (disabled) return;
    navigator.clipboard.writeText(content).catch(() => {
      const el = document.createElement("textarea");
      el.value = content;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-2 font-mono text-xs text-slate-400">setup.sh</span>
        </div>
        <button
          onClick={handleCopy}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">복사됨</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              복사
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-slate-200 whitespace-pre">
        {content}
      </pre>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [clientFamily, setClientFamily] = useState<ClientFamily>("geth");
  const [rpcUrl, setRpcUrl] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("none");
  const [aiApiKey, setAiApiKey] = useState("");

  const config: SetupConfig = { clientFamily, rpcUrl, networkName, aiProvider, aiApiKey };
  const script = generateSetupScript(config);
  const isReady = rpcUrl.trim().length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Back link */}
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          랜딩으로
        </a>

        {/* Header */}
        <div className="mb-10">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <Terminal className="h-5 w-5 text-emerald-400" />
          </div>
          <h1 className="mb-2 text-3xl font-bold text-slate-100">
            30초 배포
          </h1>
          <p className="text-slate-400">
            노드 정보를 입력하면 실행 가능한 설치 스크립트를 생성합니다.
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Left: Form */}
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-400">
                ① 노드 설정
              </h2>

              {/* Client Family */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  EVM 클라이언트
                </label>
                <div className="relative">
                  <select
                    value={clientFamily}
                    onChange={(e) => setClientFamily(e.target.value as ClientFamily)}
                    className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 pr-8 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    {CLIENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {/* RPC URL */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  RPC URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={rpcUrl}
                  onChange={(e) => setRpcUrl(e.target.value)}
                  placeholder="http://localhost:8545"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Network Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  네트워크 이름 <span className="text-slate-500">(선택)</span>
                </label>
                <input
                  type="text"
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  placeholder="My Network"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* AI Provider */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-400">
                AI 제공자 <span className="font-normal normal-case text-slate-500">(선택)</span>
              </h2>

              <div className="mb-4">
                <div className="relative">
                  <select
                    value={aiProvider}
                    onChange={(e) => {
                      setAiProvider(e.target.value as AiProvider);
                      setAiApiKey("");
                    }}
                    className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 pr-8 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    {AI_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {aiProvider !== "none" && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    스크립트에만 포함되며 서버로 전송되지 않습니다.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Script output */}
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-400">
                ② 터미널에 붙여넣기
              </h2>
              {!isReady && (
                <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                  RPC URL을 입력하면 스크립트가 활성화됩니다.
                </p>
              )}
              <CodeBlock content={script} disabled={!isReady} />
            </div>

            {/* What happens next */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h3 className="mb-3 text-sm font-semibold text-slate-300">실행 후</h3>
              <ol className="space-y-2 text-sm text-slate-400">
                {[
                  "sentinai/ 폴더 생성 및 이동",
                  "docker-compose.yml 다운로드 (GitHub)",
                  ".env.local 파일 생성",
                  "docker compose up -d 실행",
                  "http://localhost:3002 에서 대시보드 열기",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-medium text-slate-400">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Start website dev server and manually test**

```bash
cd website && npm run dev
```

Open http://localhost:3000/setup in browser.
- Select "Ethrex" client, enter `http://localhost:18546`, name "Ethrex Dev"
- Verify script updates in real-time
- Verify Copy button disabled when RPC URL empty, enabled when filled
- Verify Copy button shows "복사됨" for ~2 seconds

**Step 4: Commit**

```bash
git add website/src/app/setup/page.tsx
git commit -m "feat(website): add /setup self-host wizard page"
```

---

## Task 3: Landing Page Entry Points

**Files:**
- Modify: `website/src/app/page.tsx`

**Step 1: Add "Deploy" nav link**

In the `Navbar` function, add a link between "Docs" and the CTA button:

```tsx
<a href="/setup" className="transition-colors hover:text-slate-100">
  Deploy
</a>
```

**Step 2: Add CTA button to Deployment section**

In the `Deployment` function, find the Docker Compose card (the `<div>` that contains `"docker compose up -d"`). Add a CTA button after the `<ul>` list:

```tsx
<a
  href="/setup"
  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition-opacity hover:opacity-90"
>
  <Terminal className="h-4 w-4" />
  설치 스크립트 생성
</a>
```

**Step 3: Verify pages render**

```bash
cd website && npm run dev
```

- Check http://localhost:3000 — "Deploy" link in navbar, CTA button on Docker Compose card
- Click "Deploy" → navigates to /setup
- Click "설치 스크립트 생성" → navigates to /setup

**Step 4: Verify TypeScript and build**

```bash
cd website && npx tsc --noEmit && npm run build
```

Expected: no errors, build succeeds.

**Step 5: Commit**

```bash
git add website/src/app/page.tsx
git commit -m "feat(website): add /setup entry points in navbar and deployment section"
```

---

## Done

All three tasks complete. The `/setup` page is live on `website/` (Vercel) at `/setup`, accessible from the landing page navbar and the Docker Compose deployment card.
