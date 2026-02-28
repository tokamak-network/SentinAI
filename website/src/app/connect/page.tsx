"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Github,
  Terminal,
  Copy,
  Check,
  Server,
  Activity,
  Cpu,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Info,
  Plug,
  Loader2,
} from "lucide-react";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";
const DOCKER_IMAGE = "ghcr.io/tokamak-network/sentinai:latest";

// ============================================================================
// Types
// ============================================================================

type NodeType = "ethereum-el" | "opstack-l2" | "arbitrum-nitro" | "ethereum-cl";

interface NodeConfig {
  type: NodeType;
  label: string;
  clients: string;
  Icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  urlLabel: string;
  urlPlaceholder: string;
  supportsAuthToken: boolean;
}

type OnboardingResponse = {
  data?: {
    instanceId: string;
    dashboardUrl?: string;
    detectedClient?: unknown;
    mappedCapabilities?: unknown;
    warnings?: string[];
  };
  error?: string;
  code?: string;
};

// ============================================================================
// Node type config
// ============================================================================

const NODE_CONFIGS: NodeConfig[] = [
  {
    type: "ethereum-el",
    label: "L1 실행 클라이언트",
    clients: "Geth · Reth · Nethermind · Besu",
    Icon: Server,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/10",
    urlLabel: "Execution Client RPC URL",
    urlPlaceholder: "http://localhost:8545",
    supportsAuthToken: true,
  },
  {
    type: "opstack-l2",
    label: "L2 시퀀서 (OP Stack)",
    clients: "OP Stack · Optimism · Thanos",
    Icon: Activity,
    iconColor: "text-cyan-400",
    iconBg: "bg-cyan-500/10",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-l2-network.io",
    supportsAuthToken: true,
  },
  {
    type: "arbitrum-nitro",
    label: "L2 시퀀서 (Arbitrum Nitro)",
    clients: "Arbitrum Nitro · Arbitrum Orbit",
    Icon: Activity,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-arbitrum-node.io",
    supportsAuthToken: true,
  },
  {
    type: "ethereum-cl",
    label: "L1 합의 클라이언트",
    clients: "Lighthouse · Prysm · Teku",
    Icon: Cpu,
    iconColor: "text-violet-400",
    iconBg: "bg-violet-500/10",
    urlLabel: "Beacon API URL",
    urlPlaceholder: "http://localhost:5052",
    supportsAuthToken: false,
  },
];

// ============================================================================
// Output generators
// ============================================================================

const ENV_MAP: Record<NodeType, { primary: string; optional?: string }> = {
  "ethereum-el": { primary: "SENTINAI_L1_RPC_URL" },
  "opstack-l2": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
  "arbitrum-nitro": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
  "ethereum-cl": { primary: "CL_BEACON_URL" },
};

function buildDockerRun(nodeType: NodeType, url: string, authToken?: string): string {
  const { primary, optional } = ENV_MAP[nodeType];
  const u = url.trim() || "<your-url>";
  const lines: string[] = [];

  lines.push(`  -e ${primary}=${u} \\\n`);
  if (optional) lines.push(`  -e ${optional}=<optional-l1-rpc-url> \\\n`);
  if (authToken?.trim()) lines.push(`  -e SENTINAI_RPC_AUTH_TOKEN=${authToken.trim()} \\\n`);

  lines.push(`  -e ANTHROPIC_API_KEY=<your-anthropic-key> \\\n`);
  lines.push(`  -p 3002:3002 \\\n`);
  lines.push(`  ${DOCKER_IMAGE}`);

  return `docker run \\\n${lines.join("")}`.trimEnd();
}

function buildEnvLocal(nodeType: NodeType, url: string, authToken?: string): string {
  const { primary, optional } = ENV_MAP[nodeType];
  const u = url.trim() || "<your-url>";
  const lines: string[] = [];

  lines.push(`${primary}=${u}`);
  if (optional) lines.push(`${optional}=<optional-l1-rpc-url>`);
  if (authToken?.trim()) lines.push(`SENTINAI_RPC_AUTH_TOKEN=${authToken.trim()}`);
  lines.push(`ANTHROPIC_API_KEY=<your-anthropic-key>`);

  return lines.join("\n");
}

// ============================================================================
// Navbar
// ============================================================================

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

// ============================================================================
// Code block
// ============================================================================

function CodeBlock({
  title,
  content,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  content: string;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const isCopied = copiedId === copyId;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-2 font-mono text-xs text-slate-400">{title}</span>
        </div>
        <button
          onClick={() => onCopy(content, copyId)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          {isCopied ? (
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

// ============================================================================
// Main page
// ============================================================================

export default function ConnectPage() {
  const [nodeType, setNodeType] = useState<NodeType>("ethereum-el");
  const [url, setUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [generated, setGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OnboardingResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const currentConfig = NODE_CONFIGS.find((c) => c.type === nodeType)!;

  const dockerCommand = useMemo(
    () => buildDockerRun(nodeType, url, authToken),
    [nodeType, url, authToken]
  );
  const envLocal = useMemo(
    () => buildEnvLocal(nodeType, url, authToken),
    [nodeType, url, authToken]
  );

  useEffect(() => {
    if (!testResult?.data?.dashboardUrl) return;
    const t = window.setTimeout(() => {
      window.location.assign(testResult.data!.dashboardUrl!);
    }, 900);
    return () => window.clearTimeout(t);
  }, [testResult?.data?.dashboardUrl]);

  function handleGenerate() {
    setGenerated(true);
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      const connectionConfig: Record<string, unknown> =
        nodeType === "ethereum-cl"
          ? { rpcUrl: url.trim(), beaconApiUrl: url.trim() }
          : { rpcUrl: url.trim(), ...(authToken.trim() ? { authToken: authToken.trim() } : {}) };

      const res = await fetch("/api/v2/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType,
          connectionConfig,
          label: "Connect UI",
          operatorId: "default",
        }),
      });

      const json = (await res.json()) as OnboardingResponse;
      if (!res.ok) {
        setTestError(json.error ?? `HTTP ${res.status}`);
        setTesting(false);
        return;
      }

      setTestResult(json);
      setGenerated(true);

      if (json.data?.dashboardUrl) {
        // Provide a quick redirect option
        // (Do not auto-navigate to avoid surprises)
      }
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          홈으로
        </a>

        <div className="mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-400">
            <Terminal className="h-3.5 w-3.5" />
            Connect Flow
          </div>
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            Connect Your Node
          </h1>
          <p className="max-w-2xl text-slate-400">
            URL(+옵션 Auth)을 입력하면 연결 테스트를 수행하고, 자동 감지 결과를 표시하며,
            바로 실행 가능한 <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">docker run</code> / <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">.env.local</code> 블록을 생성합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-6 font-semibold text-slate-100">노드 정보 입력</h2>

              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  노드 타입
                </label>
                <div className="space-y-2">
                  {NODE_CONFIGS.map((config) => {
                    const Icon = config.Icon;
                    const isSelected = nodeType === config.type;
                    return (
                      <button
                        key={config.type}
                        type="button"
                        onClick={() => {
                          setNodeType(config.type);
                          setGenerated(false);
                          setTestResult(null);
                          setTestError(null);
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition-all ${
                          isSelected
                            ? "border-cyan-500/50 bg-cyan-500/10"
                            : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              isSelected ? config.iconBg : "bg-slate-700/50"
                            }`}
                          >
                            <Icon
                              className={`h-4 w-4 ${
                                isSelected ? config.iconColor : "text-slate-400"
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <p
                              className={`text-sm font-medium ${
                                isSelected ? "text-slate-100" : "text-slate-300"
                              }`}
                            >
                              {config.label}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {config.clients}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="ml-auto h-4 w-4 shrink-0 text-cyan-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <label
                  htmlFor="node-url"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  {currentConfig.urlLabel}
                </label>
                <input
                  id="node-url"
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setGenerated(false);
                    setTestResult(null);
                    setTestError(null);
                  }}
                  placeholder={currentConfig.urlPlaceholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  테스트 시에만 서버로 전송됩니다.
                </p>
              </div>

              {currentConfig.supportsAuthToken && (
                <div className="mb-6">
                  <label
                    htmlFor="auth-token"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Auth Token (optional)
                  </label>
                  <input
                    id="auth-token"
                    type="password"
                    value={authToken}
                    onChange={(e) => {
                      setAuthToken(e.target.value);
                      setGenerated(false);
                    }}
                    placeholder="Bearer 토큰 또는 Basic 자격증명"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || !url.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4" />
                  )}
                  연결 테스트
                </button>

                <button
                  type="button"
                  onClick={handleGenerate}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-opacity hover:opacity-90"
                >
                  <Sparkles className="h-4 w-4" />
                  설정 생성
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-500 leading-relaxed">
                연결 테스트는 <code className="font-mono">/api/v2/onboarding/complete</code> 를 호출하며,
                성공 시 인스턴스를 생성(또는 재사용)하고 자동 감지 결과를 저장합니다.
              </p>
            </div>
          </div>

          <div className="lg:col-span-3">
            {testError && (
              <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                {testError}
              </div>
            )}

            {testResult?.data && (
              <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <Check className="h-4 w-4" />
                  연결 성공 — instanceId: <span className="font-mono">{testResult.data.instanceId}</span>
                </div>
                {testResult.data.warnings?.length ? (
                  <ul className="mt-3 list-disc pl-5 text-xs text-amber-200">
                    {testResult.data.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CodeBlock
                    title="detectedClient"
                    content={JSON.stringify(testResult.data.detectedClient ?? {}, null, 2)}
                    copyId="detectedClient"
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                  <CodeBlock
                    title="mappedCapabilities"
                    content={JSON.stringify(testResult.data.mappedCapabilities ?? {}, null, 2)}
                    copyId="mappedCapabilities"
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                </div>

                {testResult.data.dashboardUrl ? (
                  <div className="mt-4">
                    <a
                      href={testResult.data.dashboardUrl}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      대시보드로 이동
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                ) : null}
              </div>
            )}

            {!generated ? (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20">
                <div className="text-center">
                  <Terminal className="mx-auto mb-3 h-8 w-8 text-slate-700" />
                  <p className="text-sm text-slate-600">
                    노드 타입과 URL을 입력하고
                    <br />
                    <span className="text-slate-500">연결 테스트</span> 또는 <span className="text-slate-500">설정 생성</span>을 실행하세요
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <Check className="h-4 w-4" />
                  설정이 생성되었습니다
                </div>

                <CodeBlock
                  title="docker run"
                  content={dockerCommand}
                  copyId="docker"
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />

                <CodeBlock
                  title=".env.local"
                  content={envLocal}
                  copyId="env"
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-16 border-t border-slate-800 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 text-sm text-slate-600 sm:px-6 lg:px-8">
          <span>SentinAI by Tokamak Network</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-slate-400"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
