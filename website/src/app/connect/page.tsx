"use client";

import { useState } from "react";
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
} from "lucide-react";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";
const DOCKER_IMAGE = "ghcr.io/tokamak-network/sentinai:latest";

// ============================================================================
// Types
// ============================================================================

type NodeType = "l2-opstack" | "l2-arbitrum" | "l1-el" | "l1-cl";

interface NodeConfig {
  type: NodeType;
  label: string;
  clients: string;
  Icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  urlLabel: string;
  urlPlaceholder: string;
}

// ============================================================================
// Node type config
// ============================================================================

const NODE_CONFIGS: NodeConfig[] = [
  {
    type: "l1-el",
    label: "L1 실행 클라이언트",
    clients: "Geth · Reth · Nethermind · Besu",
    Icon: Server,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/10",
    urlLabel: "Execution Client RPC URL",
    urlPlaceholder: "http://localhost:8545",
  },
  {
    type: "l2-opstack",
    label: "L2 시퀀서 (OP Stack)",
    clients: "OP Stack · Optimism · Thanos",
    Icon: Activity,
    iconColor: "text-cyan-400",
    iconBg: "bg-cyan-500/10",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-l2-network.io",
  },
  {
    type: "l2-arbitrum",
    label: "L2 시퀀서 (Arbitrum Nitro)",
    clients: "Arbitrum Nitro · Arbitrum Orbit",
    Icon: Activity,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-arbitrum-node.io",
  },
  {
    type: "l1-cl",
    label: "L1 합의 클라이언트",
    clients: "Lighthouse · Prysm · Teku",
    Icon: Cpu,
    iconColor: "text-violet-400",
    iconBg: "bg-violet-500/10",
    urlLabel: "Beacon API URL",
    urlPlaceholder: "http://localhost:5052",
  },
];

// ============================================================================
// Output generators
// ============================================================================

// ENV_MAP: node type → environment variable mapping
const ENV_MAP: Record<NodeType, { primary: string; optional?: string }> = {
  "l1-el": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
  "l2-opstack": { primary: "L2_RPC_URL" },
  "l2-arbitrum": { primary: "L2_RPC_URL" },
  "l1-cl": { primary: "CL_BEACON_URL" },
};

function buildDockerRun(nodeType: NodeType, rpcUrl: string): string {
  const url = rpcUrl.trim() || "<your-rpc-url>";
  const { primary, optional } = ENV_MAP[nodeType];
  const lines: string[] = [];

  lines.push(`  -e ${primary}=${url} \\`);
  if (optional) {
    lines.push(`  -e ${optional}=${url} \\`);
  }
  lines.push(`  -e ANTHROPIC_API_KEY=<your-anthropic-key> \\`);
  lines.push(`  -p 3002:3002 \\`);
  lines.push(`  ${DOCKER_IMAGE}`);

  return `docker run \\\n${lines.join("\n")}`;
}

function buildEnvLocal(nodeType: NodeType, rpcUrl: string): string {
  const url = rpcUrl.trim() || "<your-rpc-url>";
  const { primary, optional } = ENV_MAP[nodeType];
  const lines: string[] = [];

  lines.push(`${primary}=${url}`);
  if (optional) {
    lines.push(`${optional}=${url}`);
  }
  lines.push(`ANTHROPIC_API_KEY=<your-anthropic-key>`);
  lines.push(`# Optional: SENTINAI_L1_RPC_URL=https://eth-mainnet-rpc...`);

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
// Code block with copy button
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
      {/* Header */}
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

      {/* Code */}
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
  const [nodeType, setNodeType] = useState<NodeType>("l1-el");
  const [rpcUrl, setRpcUrl] = useState("");
  const [generated, setGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const currentConfig = NODE_CONFIGS.find((c) => c.type === nodeType)!;

  function handleGenerate() {
    setGenerated(true);
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for environments without clipboard API
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

  const dockerCommand = buildDockerRun(nodeType, rpcUrl);
  const envLocal = buildEnvLocal(nodeType, rpcUrl);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Back link */}
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          홈으로
        </a>

        {/* Page header */}
        <div className="mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-400">
            <Terminal className="h-3.5 w-3.5" />
            설정 생성기
          </div>
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            Connect Your Node
          </h1>
          <p className="max-w-xl text-slate-400">
            RPC URL을 입력하면 <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">docker run</code> 명령어를 즉시 생성합니다.
            브라우저에서 연결 테스트는 하지 않습니다 — 감지와 설정은 SentinAI가 첫 부팅 시 자동으로 처리합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          {/* Form */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-6 font-semibold text-slate-100">노드 정보 입력</h2>

              {/* Node type selector */}
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
                              className={`h-4 w-4 ${isSelected ? config.iconColor : "text-slate-400"}`}
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

              {/* RPC URL input */}
              <div className="mb-6">
                <label
                  htmlFor="rpc-url"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  {currentConfig.urlLabel}
                </label>
                <input
                  id="rpc-url"
                  type="url"
                  value={rpcUrl}
                  onChange={(e) => {
                    setRpcUrl(e.target.value);
                    setGenerated(false);
                  }}
                  placeholder={currentConfig.urlPlaceholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  입력값은 서버로 전송되지 않습니다.
                </p>
              </div>

              {/* Generate button */}
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

            {/* Note */}
            <div className="mt-4 flex gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-500 leading-relaxed">
                클라이언트 버전, 지원 메트릭, 이상 탐지 규칙은 SentinAI가 첫 번째 에이전트 사이클에서 자동으로 감지합니다.
              </p>
            </div>
          </div>

          {/* Output */}
          <div className="lg:col-span-3">
            {!generated ? (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20">
                <div className="text-center">
                  <Terminal className="mx-auto mb-3 h-8 w-8 text-slate-700" />
                  <p className="text-sm text-slate-600">
                    노드 타입과 RPC URL을 입력하고
                    <br />
                    <span className="text-slate-500">설정 생성</span> 버튼을 누르세요
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Generated header */}
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <Check className="h-4 w-4" />
                  설정이 생성되었습니다
                </div>

                {/* docker run */}
                <CodeBlock
                  title="docker run"
                  content={dockerCommand}
                  copyId="docker"
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />

                {/* .env.local */}
                <CodeBlock
                  title=".env.local"
                  content={envLocal}
                  copyId="env"
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />

                {/* Next steps */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-200">
                    실행 후 단계
                  </h3>
                  <ol className="space-y-3">
                    {[
                      {
                        step: "1",
                        text: "위 명령어를 실행합니다",
                        note: "ANTHROPIC_API_KEY는 실제 키로 교체하세요",
                        color: "border-cyan-500/50 text-cyan-400",
                      },
                      {
                        step: "2",
                        text: "http://localhost:3002 에서 대시보드 접속",
                        note: "SentinAI가 자동으로 클라이언트를 감지합니다",
                        color: "border-blue-500/50 text-blue-400",
                      },
                      {
                        step: "3",
                        text: "첫 에이전트 사이클 확인",
                        note: "30초 이내에 메트릭 수집 시작",
                        color: "border-violet-500/50 text-violet-400",
                      },
                    ].map(({ step, text, note, color }) => (
                      <li key={step} className="flex gap-3">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold ${color}`}
                        >
                          {step}
                        </span>
                        <div>
                          <p className="text-sm text-slate-200">{text}</p>
                          <p className="text-xs text-slate-500">{note}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Docs link */}
                <p className="text-center text-sm text-slate-500">
                  추가 환경변수 설정은{" "}
                  <a
                    href="/docs"
                    className="text-cyan-400 transition-colors hover:text-cyan-300"
                  >
                    문서
                  </a>
                  를 참고하세요
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
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
