"use client";

import { useState, useRef, useEffect } from "react";
import {
  ShieldCheck,
  Github,
  Terminal,
  Copy,
  Check,
  ArrowLeft,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  generateSetupScript,
  type SetupConfig,
  type ClientFamily,
  type AiProvider,
  type CustomProfile,
} from "@/lib/generate-setup-script";

interface DetectResult {
  family: string;
  txpoolNamespace: "txpool" | "parity" | null;
  supportsL2SyncStatus: boolean;
  l2SyncMethod: string | null;
  clientVersion: string | null;
}

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

// ── Custom Client Section ────────────────────────────────────────────────────

interface CustomClientSectionProps {
  rpcUrl: string;
  customName: string;
  onCustomNameChange: (v: string) => void;
  detectResult: DetectResult | null;
  onDetectResult: (r: DetectResult | null) => void;
}

function CustomClientSection({
  rpcUrl,
  customName,
  onCustomNameChange,
  detectResult,
  onDetectResult,
}: CustomClientSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDetect() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v2/client-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpcUrl }),
      });
      const json = (await res.json()) as
        | { data: DetectResult }
        | { error: string; detail?: string };
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "감지 실패";
        setError(msg);
        onDetectResult(null);
      } else {
        onDetectResult(json.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류");
      onDetectResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
      <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-amber-400">
        커스텀 클라이언트 설정
      </h2>

      {/* Client name */}
      <div className="mb-4">
        <label
          htmlFor="custom-name"
          className="mb-1.5 block text-sm font-medium text-slate-300"
        >
          클라이언트 이름
        </label>
        <input
          id="custom-name"
          type="text"
          value={customName}
          onChange={(e) => onCustomNameChange(e.target.value)}
          placeholder="예: ethrex"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
        />
      </div>

      {/* Auto-detect button */}
      <button
        onClick={handleDetect}
        disabled={!rpcUrl.trim() || loading}
        className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "🔍"
        )}
        자동 감지
      </button>

      {/* Error */}
      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
          {error}
        </p>
      )}

      {/* Detection result */}
      {detectResult && (
        <div className="mt-4 space-y-2 rounded-lg border border-slate-700 bg-slate-800/60 p-4">
          <p className="text-xs font-medium text-slate-300">감지 결과</p>
          <dl className="space-y-1 text-xs text-slate-400">
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-slate-500">클라이언트:</dt>
              <dd className="font-mono text-slate-200">{detectResult.clientVersion ?? "알 수 없음"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-slate-500">TxPool 네임스페이스:</dt>
              <dd className="font-mono text-slate-200">{detectResult.txpoolNamespace ?? "없음"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-slate-500">L2 Sync 지원:</dt>
              <dd className="font-mono text-slate-200">
                {detectResult.supportsL2SyncStatus
                  ? `✓ ${detectResult.l2SyncMethod ?? ""}`
                  : "✗ 미지원"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleCopy() {
    if (disabled) return;

    const fallback = (): boolean => {
      try {
        const el = document.createElement("textarea");
        el.value = content;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        return ok;
      } catch {
        return false;
      }
    };

    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        if (fallback()) {
          setCopied(true);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 2000);
        }
      });
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
  const [customName, setCustomName] = useState("");
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);

  const customProfile: CustomProfile | undefined =
    clientFamily === "other" && customName.trim() && detectResult
      ? {
          clientFamily: customName.trim(),
          detectPattern: customName.trim(),
          txPoolMethod: detectResult.txpoolNamespace
            ? detectResult.txpoolNamespace === "txpool"
              ? "txpool_status"
              : "parity_pendingTransactions"
            : null,
          l2SyncMethod: detectResult.l2SyncMethod,
        }
      : undefined;

  const config: SetupConfig = { clientFamily, rpcUrl, networkName, aiProvider, aiApiKey, customProfile };
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
                <label htmlFor="client-family" className="mb-1.5 block text-sm font-medium text-slate-300">
                  EVM 클라이언트
                </label>
                <div className="relative">
                  <select
                    id="client-family"
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
                <label htmlFor="rpc-url" className="mb-1.5 block text-sm font-medium text-slate-300">
                  RPC URL <span className="text-rose-400">*</span>
                </label>
                <input
                  id="rpc-url"
                  type="text"
                  value={rpcUrl}
                  onChange={(e) => setRpcUrl(e.target.value)}
                  placeholder="http://localhost:8545"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Network Name */}
              <div>
                <label htmlFor="network-name" className="mb-1.5 block text-sm font-medium text-slate-300">
                  네트워크 이름 <span className="text-slate-500">(선택)</span>
                </label>
                <input
                  id="network-name"
                  type="text"
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  placeholder="My Network"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Custom client section — only when "other" is selected */}
            {clientFamily === "other" && (
              <CustomClientSection
                rpcUrl={rpcUrl}
                customName={customName}
                onCustomNameChange={setCustomName}
                detectResult={detectResult}
                onDetectResult={setDetectResult}
              />
            )}

            {/* AI Provider */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-400">
                AI 제공자 <span className="font-normal normal-case text-slate-500">(선택)</span>
              </h2>

              <div className="mb-4">
                <label htmlFor="ai-provider" className="sr-only">
                  AI 제공자
                </label>
                <div className="relative">
                  <select
                    id="ai-provider"
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
                  <label htmlFor="ai-api-key" className="mb-1.5 block text-sm font-medium text-slate-300">
                    API Key
                  </label>
                  <input
                    id="ai-api-key"
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
