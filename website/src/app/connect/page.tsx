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
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Info,
  Plug,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";
const DOCKER_IMAGE = "ghcr.io/tokamak-network/sentinai:latest";

// ============================================================================
// Types
// ============================================================================

type NodeType = "ethereum-el" | "opstack-l2" | "arbitrum-nitro";
type AiProvider = "none" | "qwen" | "anthropic" | "openai" | "gemini";

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
    label: "L1 Execution Client",
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
    label: "L2 Sequencer (OP Stack)",
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
    label: "L2 Sequencer (Arbitrum Nitro)",
    clients: "Arbitrum Nitro · Arbitrum Orbit",
    Icon: Activity,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-arbitrum-node.io",
    supportsAuthToken: true,
  },
];

const AI_OPTIONS: { value: AiProvider; label: string; keyVar: string; placeholder: string }[] = [
  { value: "none", label: "None (Set Later)", keyVar: "", placeholder: "" },
  { value: "qwen", label: "Qwen (DashScope)", keyVar: "QWEN_API_KEY", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic (Claude)", keyVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
  { value: "openai", label: "OpenAI", keyVar: "OPENAI_API_KEY", placeholder: "sk-..." },
  { value: "gemini", label: "Google Gemini", keyVar: "GEMINI_API_KEY", placeholder: "AIza..." },
];

// ============================================================================
// Output generators
// ============================================================================

const ENV_MAP: Record<NodeType, { primary: string; optional?: string }> = {
  "ethereum-el": { primary: "SENTINAI_L1_RPC_URL" },
  "opstack-l2": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
  "arbitrum-nitro": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
};

interface BuildConfig {
  nodeType: NodeType;
  url: string;
  authToken: string;
  networkName: string;
  aiProvider: AiProvider;
  aiApiKey: string;
  awsClusterName: string;
  alertWebhookUrl: string;
}

function buildDockerRun(cfg: BuildConfig): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const u = cfg.url.trim() || "<your-url>";
  const lines: string[] = [];

  if (cfg.networkName.trim())
    lines.push(`  -e NEXT_PUBLIC_NETWORK_NAME="${cfg.networkName.trim()}" \\\n`);
  lines.push(`  -e ${primary}=${u} \\\n`);
  if (optional) lines.push(`  -e ${optional}=<optional-l1-rpc-url> \\\n`);
  if (cfg.authToken.trim())
    lines.push(`  -e SENTINAI_RPC_AUTH_TOKEN=${cfg.authToken.trim()} \\\n`);

  const aiOpt = AI_OPTIONS.find((o) => o.value === cfg.aiProvider);
  if (aiOpt && aiOpt.keyVar) {
    const key = cfg.aiApiKey.trim() || `<your-${cfg.aiProvider}-key>`;
    lines.push(`  -e ${aiOpt.keyVar}=${key} \\\n`);
  } else {
    lines.push(`  -e ANTHROPIC_API_KEY=<your-anthropic-key> \\\n`);
  }

  if (cfg.awsClusterName.trim())
    lines.push(`  -e AWS_CLUSTER_NAME=${cfg.awsClusterName.trim()} \\\n`);
  if (cfg.alertWebhookUrl.trim())
    lines.push(`  -e ALERT_WEBHOOK_URL=${cfg.alertWebhookUrl.trim()} \\\n`);

  lines.push(`  -p 3002:3002 \\\n`);
  lines.push(`  ${DOCKER_IMAGE}`);

  return `docker run \\\n${lines.join("")}`.trimEnd();
}

function buildEnvLocal(cfg: BuildConfig): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const u = cfg.url.trim() || "<your-url>";
  const lines: string[] = [];

  if (cfg.networkName.trim())
    lines.push(`NEXT_PUBLIC_NETWORK_NAME=${cfg.networkName.trim()}`);
  lines.push(`${primary}=${u}`);
  if (optional) lines.push(`${optional}=<optional-l1-rpc-url>`);
  if (cfg.authToken.trim())
    lines.push(`SENTINAI_RPC_AUTH_TOKEN=${cfg.authToken.trim()}`);

  const aiOpt = AI_OPTIONS.find((o) => o.value === cfg.aiProvider);
  if (aiOpt && aiOpt.keyVar) {
    const key = cfg.aiApiKey.trim() || `<your-${cfg.aiProvider}-key>`;
    lines.push(`${aiOpt.keyVar}=${key}`);
  } else {
    lines.push(`ANTHROPIC_API_KEY=<your-anthropic-key>`);
  }

  if (cfg.awsClusterName.trim())
    lines.push(`AWS_CLUSTER_NAME=${cfg.awsClusterName.trim()}`);
  if (cfg.alertWebhookUrl.trim())
    lines.push(`ALERT_WEBHOOK_URL=${cfg.alertWebhookUrl.trim()}`);

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
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
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
  const [networkName, setNetworkName] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("none");
  const [aiApiKey, setAiApiKey] = useState("");
  const [awsClusterName, setAwsClusterName] = useState("");
  const [alertWebhookUrl, setAlertWebhookUrl] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [generated, setGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OnboardingResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const currentConfig = NODE_CONFIGS.find((c) => c.type === nodeType)!;
  const selectedAi = AI_OPTIONS.find((o) => o.value === aiProvider)!;

  const buildCfg: BuildConfig = {
    nodeType, url, authToken, networkName, aiProvider, aiApiKey, awsClusterName, alertWebhookUrl,
  };

  const dockerCommand = useMemo(() => buildDockerRun(buildCfg), [
    nodeType, url, authToken, networkName, aiProvider, aiApiKey, awsClusterName, alertWebhookUrl,
  ]);
  const envLocal = useMemo(() => buildEnvLocal(buildCfg), [
    nodeType, url, authToken, networkName, aiProvider, aiApiKey, awsClusterName, alertWebhookUrl,
  ]);

  useEffect(() => {
    if (!testResult?.data?.dashboardUrl) return;
    const t = window.setTimeout(() => {
      window.location.assign(testResult.data!.dashboardUrl!);
    }, 900);
    return () => window.clearTimeout(t);
  }, [testResult?.data?.dashboardUrl]);

  function resetOutput() {
    setGenerated(false);
    setTestResult(null);
    setTestError(null);
  }

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
    setGenerated(false);

    try {
      const connectionConfig: Record<string, unknown> = {
        rpcUrl: url.trim(),
        ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
      };

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("syntaxerror") || msg.toLowerCase().includes("not valid json")) {
        setTestError("Cannot connect to server. Check the RPC URL or verify the SentinAI backend is running.");
      } else {
        setTestError(msg);
      }
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
          Home
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
            Enter your node details to generate a ready-to-run{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">docker run</code>{" "}
            /{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">.env.local</code>{" "}
            configuration.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          {/* ── Left: Form ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Node settings */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-6 font-semibold text-slate-100">① Node Settings</h2>

              {/* Node type */}
              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Node Type
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
                          resetOutput();
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
                            <p className={`text-sm font-medium ${isSelected ? "text-slate-100" : "text-slate-300"}`}>
                              {config.label}
                            </p>
                            <p className="truncate text-xs text-slate-500">{config.clients}</p>
                          </div>
                          {isSelected && <Check className="ml-auto h-4 w-4 shrink-0 text-cyan-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* RPC URL */}
              <div className="mb-4">
                <label htmlFor="node-url" className="mb-2 block text-sm font-medium text-slate-300">
                  {currentConfig.urlLabel}
                </label>
                <input
                  id="node-url"
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); resetOutput(); }}
                  placeholder={currentConfig.urlPlaceholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Sent to server only during connection test.
                </p>
              </div>

              {/* Network name */}
              <div className="mb-4">
                <label htmlFor="network-name" className="mb-2 block text-sm font-medium text-slate-300">
                  Network Name <span className="text-slate-500">(Optional)</span>
                </label>
                <input
                  id="network-name"
                  type="text"
                  value={networkName}
                  onChange={(e) => { setNetworkName(e.target.value); resetOutput(); }}
                  placeholder="e.g. Thanos Sepolia"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Shown in the dashboard header (<code className="font-mono">NEXT_PUBLIC_NETWORK_NAME</code>).
                </p>
              </div>

              {/* Auth Token */}
              {currentConfig.supportsAuthToken && (
                <div className="mb-5">
                  <label htmlFor="auth-token" className="mb-2 block text-sm font-medium text-slate-300">
                    Auth Token <span className="text-slate-500">(Optional)</span>
                  </label>
                  <input
                    id="auth-token"
                    type="password"
                    value={authToken}
                    onChange={(e) => { setAuthToken(e.target.value); resetOutput(); }}
                    placeholder="Bearer token or Basic credentials"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              )}
            </div>

            {/* AI settings */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-5 font-semibold text-slate-100">
                ② AI Provider{" "}
                <span className="text-sm font-normal text-rose-400">*Required</span>
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Required for anomaly detection, NLOps, RCA, and predictive scaling.
              </p>

              {/* Provider select */}
              <div className="mb-4">
                <label htmlFor="ai-provider" className="mb-2 block text-sm font-medium text-slate-300">
                  Provider
                </label>
                <div className="relative">
                  <select
                    id="ai-provider"
                    value={aiProvider}
                    onChange={(e) => {
                      setAiProvider(e.target.value as AiProvider);
                      setAiApiKey("");
                      resetOutput();
                    }}
                    className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 pr-8 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    {AI_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {/* API Key */}
              {aiProvider !== "none" && (
                <div>
                  <label htmlFor="ai-api-key" className="mb-2 block text-sm font-medium text-slate-300">
                    API Key
                  </label>
                  <input
                    id="ai-api-key"
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => { setAiApiKey(e.target.value); resetOutput(); }}
                    placeholder={selectedAi.placeholder}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Included in script only — never sent to any server.
                  </p>
                </div>
              )}
            </div>

            {/* Advanced settings (collapsible) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center justify-between px-6 py-4 text-sm font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                <span>③ Advanced Settings (Optional)</span>
                {advancedOpen
                  ? <ChevronUp className="h-4 w-4" />
                  : <ChevronDown className="h-4 w-4" />}
              </button>

              {advancedOpen && (
                <div className="border-t border-slate-800 px-6 pb-6 pt-4 space-y-4">
                  {/* AWS Cluster Name */}
                  <div>
                    <label htmlFor="aws-cluster" className="mb-2 block text-sm font-medium text-slate-300">
                      AWS Cluster Name
                    </label>
                    <input
                      id="aws-cluster"
                      type="text"
                      value={awsClusterName}
                      onChange={(e) => { setAwsClusterName(e.target.value); resetOutput(); }}
                      placeholder="my-eks-cluster"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <p className="mt-1.5 text-xs text-slate-500">
                      Required for K8s auto-scaling and pod monitoring (<code className="font-mono">AWS_CLUSTER_NAME</code>).
                    </p>
                  </div>

                  {/* Alert Webhook */}
                  <div>
                    <label htmlFor="alert-webhook" className="mb-2 block text-sm font-medium text-slate-300">
                      Alert Webhook URL
                    </label>
                    <input
                      id="alert-webhook"
                      type="url"
                      value={alertWebhookUrl}
                      onChange={(e) => { setAlertWebhookUrl(e.target.value); resetOutput(); }}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <p className="mt-1.5 text-xs text-slate-500">
                      Slack/Webhook alert on anomaly detection (<code className="font-mono">ALERT_WEBHOOK_URL</code>).
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || !url.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                Test Connection
              </button>

              <button
                type="button"
                onClick={handleGenerate}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-opacity hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" />
                Generate Config
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Connection test calls{" "}
                <code className="font-mono">/api/v2/onboarding/complete</code>,
                which creates (or reuses) an instance and stores auto-detected results on success.
              </p>
            </div>
          </div>

          {/* ── Right: Output ── */}
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
                  Connection successful — instanceId:{" "}
                  <span className="font-mono">{testResult.data.instanceId}</span>
                </div>
                {testResult.data.warnings?.length ? (
                  <ul className="mt-3 list-disc pl-5 text-xs text-amber-200">
                    {testResult.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
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

                {testResult.data.dashboardUrl && (
                  <div className="mt-4">
                    <a
                      href={testResult.data.dashboardUrl}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Go to Dashboard
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {!generated ? (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20">
                <div className="text-center">
                  <Terminal className="mx-auto mb-3 h-8 w-8 text-slate-700" />
                  <p className="text-sm text-slate-600">
                    Enter node type and URL, then run
                    <br />
                    <span className="text-slate-500">Test Connection</span> or{" "}
                    <span className="text-slate-500">Generate Config</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <Check className="h-4 w-4" />
                  Configuration generated
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
