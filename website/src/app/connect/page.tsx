"use client";

import { useEffect, useMemo, useState } from "react";

// ============================================================================
// Constants
// ============================================================================

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const GITHUB_URL = "https://github.com/tokamak-network/SentinAI";
const DOCKER_IMAGE = "ghcr.io/tokamak-network/sentinai:latest";

const C = {
  bg: "#FFFFFF",
  fg: "#0A0A0A",
  border: "#D0D0D0",
  muted: "#707070",
  secondary: "#F7F7F7",
  primary: "#D40000",
  accent: "#0055AA",
  purple: "#7700AA",
};

// ============================================================================
// Types
// ============================================================================

type NodeType = "ethereum-el" | "opstack-l2" | "arbitrum-nitro" | "zkstack";
type AiProvider = "none" | "qwen" | "anthropic" | "openai" | "gemini";

interface NodeConfig {
  type: NodeType;
  label: string;
  clients: string;
  urlLabel: string;
  urlPlaceholder: string;
  supportsAuthToken: boolean;
  group: "l1-el" | "optimistic" | "zk";
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
    label: "Ethereum EL",
    clients: "Geth · Reth · Nethermind · Besu",
    urlLabel: "Execution Client RPC URL",
    urlPlaceholder: "http://localhost:8545",
    supportsAuthToken: true,
    group: "l1-el",
  },
  {
    type: "opstack-l2",
    label: "OP Stack",
    clients: "Optimism · Thanos · Base",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-l2-network.io",
    supportsAuthToken: true,
    group: "optimistic",
  },
  {
    type: "arbitrum-nitro",
    label: "Arbitrum Nitro",
    clients: "Arbitrum One · Nova · Orbit",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-arbitrum-node.io",
    supportsAuthToken: true,
    group: "optimistic",
  },
  {
    type: "zkstack",
    label: "ZK Stack",
    clients: "zkSync Era · ZKsync",
    urlLabel: "L2 RPC URL",
    urlPlaceholder: "https://rpc.your-zk-network.io",
    supportsAuthToken: true,
    group: "zk",
  },
];

const NODE_GROUPS: { id: NodeConfig["group"]; label: string; color: string }[] = [
  { id: "l1-el", label: "L1 EXECUTION", color: C.accent },
  { id: "optimistic", label: "L2 ROLLUP — OPTIMISTIC", color: C.primary },
  { id: "zk", label: "L2 ROLLUP — ZK", color: C.purple },
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
  "zkstack": { primary: "L2_RPC_URL", optional: "SENTINAI_L1_RPC_URL" },
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

  if (cfg.networkName.trim()) lines.push(`  -e NEXT_PUBLIC_NETWORK_NAME="${cfg.networkName.trim()}" \\\n`);
  lines.push(`  -e ${primary}=${u} \\\n`);
  if (optional) lines.push(`  -e ${optional}=<optional-l1-rpc-url> \\\n`);
  if (cfg.authToken.trim()) lines.push(`  -e SENTINAI_RPC_AUTH_TOKEN=${cfg.authToken.trim()} \\\n`);

  const aiOpt = AI_OPTIONS.find((o) => o.value === cfg.aiProvider);
  if (aiOpt?.keyVar) {
    const key = cfg.aiApiKey.trim() || `<your-${cfg.aiProvider}-key>`;
    lines.push(`  -e ${aiOpt.keyVar}=${key} \\\n`);
  } else {
    lines.push(`  -e ANTHROPIC_API_KEY=<your-anthropic-key> \\\n`);
  }

  if (cfg.awsClusterName.trim()) lines.push(`  -e AWS_CLUSTER_NAME=${cfg.awsClusterName.trim()} \\\n`);
  if (cfg.alertWebhookUrl.trim()) lines.push(`  -e ALERT_WEBHOOK_URL=${cfg.alertWebhookUrl.trim()} \\\n`);

  lines.push(`  -p 3002:3002 \\\n`);
  lines.push(`  ${DOCKER_IMAGE}`);

  return `docker run \\\n${lines.join("")}`.trimEnd();
}

function buildEnvLocal(cfg: BuildConfig): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const u = cfg.url.trim() || "<your-url>";
  const lines: string[] = [];

  if (cfg.networkName.trim()) lines.push(`NEXT_PUBLIC_NETWORK_NAME=${cfg.networkName.trim()}`);
  lines.push(`${primary}=${u}`);
  if (optional) lines.push(`${optional}=<optional-l1-rpc-url>`);
  if (cfg.authToken.trim()) lines.push(`SENTINAI_RPC_AUTH_TOKEN=${cfg.authToken.trim()}`);

  const aiOpt = AI_OPTIONS.find((o) => o.value === cfg.aiProvider);
  if (aiOpt?.keyVar) {
    const key = cfg.aiApiKey.trim() || `<your-${cfg.aiProvider}-key>`;
    lines.push(`${aiOpt.keyVar}=${key}`);
  } else {
    lines.push(`ANTHROPIC_API_KEY=<your-anthropic-key>`);
  }

  if (cfg.awsClusterName.trim()) lines.push(`AWS_CLUSTER_NAME=${cfg.awsClusterName.trim()}`);
  if (cfg.alertWebhookUrl.trim()) lines.push(`ALERT_WEBHOOK_URL=${cfg.alertWebhookUrl.trim()}`);

  return lines.join("\n");
}

// ============================================================================
// Navbar
// ============================================================================

function Navbar() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      borderBottom: `1px solid ${C.border}`,
      background: C.bg,
      fontFamily: FONT,
    }}>
      <div style={{
        maxWidth: 1100, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 48,
      }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 0, textDecoration: "none" }}>
          <span style={{
            background: C.primary, color: "#fff",
            fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
            padding: "4px 10px", display: "inline-block",
          }}>SENTINAI</span>
        </a>

        <nav style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {[
            { href: "/docs", label: "DOCS" },
            { href: "/setup", label: "DEPLOY" },
            { href: GITHUB_URL, label: "GITHUB", external: true },
          ].map(({ href, label, external }) => (
            <a
              key={label}
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.12em", color: C.fg, textDecoration: "none",
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

// ============================================================================
// Code block
// ============================================================================

function CodeBlock({
  title, content, copyId, copiedId, onCopy,
}: {
  title: string; content: string; copyId: string;
  copiedId: string | null; onCopy: (text: string, id: string) => void;
}) {
  const isCopied = copiedId === copyId;

  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.secondary }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 12px", borderBottom: `1px solid ${C.border}`,
        background: "#EFEFEF",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>
          {title.toUpperCase()}
        </span>
        <button
          onClick={() => onCopy(content, copyId)}
          style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
            color: isCopied ? "#007A00" : C.muted, background: "none", border: "none",
            cursor: "pointer", padding: "2px 6px",
          }}
        >
          {isCopied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre style={{
        fontFamily: FONT, fontSize: 11, lineHeight: 1.6,
        color: C.fg, padding: 16, margin: 0,
        overflowX: "auto", whiteSpace: "pre",
      }}>
        {content}
      </pre>
    </div>
  );
}

// ============================================================================
// Section label
// ============================================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em",
      color: "#fff", background: C.fg, padding: "4px 10px", display: "inline-block",
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function ConnectPage() {
  const [nodeType, setNodeType] = useState<NodeType>("opstack-l2");
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
        body: JSON.stringify({ nodeType, connectionConfig, label: "Connect UI", operatorId: "default" }),
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
        setTestError("Cannot reach server. Check the RPC URL or verify the SentinAI backend is running.");
      } else {
        setTestError(msg);
      }
    } finally {
      setTesting(false);
    }
  }

  const inputStyle = {
    fontFamily: FONT, fontSize: 12,
    width: "100%", boxSizing: "border-box" as const,
    border: `1px solid ${C.border}`, background: C.bg, color: C.fg,
    padding: "8px 12px", outline: "none",
  };

  const labelStyle = {
    fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
    color: C.muted, display: "block", marginBottom: 6, textTransform: "uppercase" as const,
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.fg, fontFamily: FONT }}>
      <Navbar />

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {/* Back */}
        <a href="/" style={{
          fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          color: C.muted, textDecoration: "none", display: "inline-flex",
          alignItems: "center", gap: 6, marginBottom: 24,
        }}>
          ← HOME
        </a>

        {/* Header */}
        <div style={{ marginBottom: 32, borderBottom: `1px solid ${C.border}`, paddingBottom: 24 }}>
          <SectionLabel>CONNECT NODE</SectionLabel>
          <h1 style={{
            fontFamily: FONT, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
            color: C.fg, margin: "0 0 8px",
          }}>
            Connect Your Node to SentinAI
          </h1>
          <p style={{ fontFamily: FONT, fontSize: 12, color: C.muted, margin: 0 }}>
            Enter your node details to generate a ready-to-run{" "}
            <code style={{ background: C.secondary, padding: "1px 5px", fontSize: 11 }}>docker run</code>
            {" "}or{" "}
            <code style={{ background: C.secondary, padding: "1px 5px", fontSize: 11 }}>.env.local</code>
            {" "}configuration.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
          {/* ── Left: Form ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* ① Node Type */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ① NODE TYPE
                </span>
              </div>
              <div style={{ padding: 16 }}>
                {NODE_GROUPS.map((group) => {
                  const groupConfigs = NODE_CONFIGS.filter((c) => c.group === group.id);
                  return (
                    <div key={group.id} style={{ marginBottom: 16 }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                        fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.15em",
                        color: group.color,
                      }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: group.color, display: "inline-block",
                        }} />
                        {group.label}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {groupConfigs.map((config) => {
                          const isSelected = nodeType === config.type;
                          return (
                            <button
                              key={config.type}
                              type="button"
                              onClick={() => { setNodeType(config.type); resetOutput(); }}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                padding: "10px 12px", textAlign: "left", cursor: "pointer",
                                background: isSelected ? `${group.color}08` : C.bg,
                                border: `1px solid ${isSelected ? group.color : C.border}`,
                                fontFamily: FONT,
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: C.fg, marginBottom: 2 }}>
                                  {config.label}
                                </div>
                                <div style={{ fontSize: 10, color: C.muted }}>{config.clients}</div>
                              </div>
                              {isSelected && (
                                <span style={{
                                  width: 8, height: 8, borderRadius: "50%",
                                  background: group.color, flexShrink: 0,
                                }} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ② Connection */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ② CONNECTION
                </span>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                {/* RPC URL */}
                <div>
                  <label style={labelStyle}>{currentConfig.urlLabel}</label>
                  <input
                    id="node-url"
                    type="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); resetOutput(); }}
                    placeholder={currentConfig.urlPlaceholder}
                    style={inputStyle}
                  />
                  <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                    Sent to server only during connection test.
                  </p>
                </div>

                {/* Network Name */}
                <div>
                  <label style={labelStyle}>Network Name <span style={{ fontWeight: 400 }}>(Optional)</span></label>
                  <input
                    id="network-name"
                    type="text"
                    value={networkName}
                    onChange={(e) => { setNetworkName(e.target.value); resetOutput(); }}
                    placeholder="e.g. Thanos Sepolia"
                    style={inputStyle}
                  />
                </div>

                {/* Auth Token */}
                {currentConfig.supportsAuthToken && (
                  <div>
                    <label style={labelStyle}>Auth Token <span style={{ fontWeight: 400 }}>(Optional)</span></label>
                    <input
                      id="auth-token"
                      type="password"
                      value={authToken}
                      onChange={(e) => { setAuthToken(e.target.value); resetOutput(); }}
                      placeholder="Bearer token or Basic credentials"
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ③ AI Provider */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ③ AI PROVIDER
                </span>
                <span style={{ fontFamily: FONT, fontSize: 9, color: C.primary, marginLeft: 8 }}>*Required</span>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontFamily: FONT, fontSize: 10, color: C.muted, margin: 0 }}>
                  Required for anomaly detection, NLOps, RCA, and predictive scaling.
                </p>
                <div>
                  <label style={labelStyle}>Provider</label>
                  <select
                    id="ai-provider"
                    value={aiProvider}
                    onChange={(e) => { setAiProvider(e.target.value as AiProvider); setAiApiKey(""); resetOutput(); }}
                    style={{ ...inputStyle, appearance: "none" as const }}
                  >
                    {AI_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {aiProvider !== "none" && (
                  <div>
                    <label style={labelStyle}>API Key</label>
                    <input
                      id="ai-api-key"
                      type="password"
                      value={aiApiKey}
                      onChange={(e) => { setAiApiKey(e.target.value); resetOutput(); }}
                      placeholder={selectedAi.placeholder}
                      style={inputStyle}
                    />
                    <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                      Included in generated script only — never sent to any server.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ④ Advanced (collapsible) */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                style={{
                  display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 16px", background: "#F7F7F7", border: "none", cursor: "pointer",
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg,
                }}
              >
                <span>④ ADVANCED SETTINGS (Optional)</span>
                <span style={{ fontSize: 12 }}>{advancedOpen ? "−" : "+"}</span>
              </button>

              {advancedOpen && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>AWS Cluster Name</label>
                    <input
                      id="aws-cluster"
                      type="text"
                      value={awsClusterName}
                      onChange={(e) => { setAwsClusterName(e.target.value); resetOutput(); }}
                      placeholder="my-eks-cluster"
                      style={inputStyle}
                    />
                    <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                      Required for K8s auto-scaling and pod monitoring (AWS_CLUSTER_NAME).
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Alert Webhook URL</label>
                    <input
                      id="alert-webhook"
                      type="url"
                      value={alertWebhookUrl}
                      onChange={(e) => { setAlertWebhookUrl(e.target.value); resetOutput(); }}
                      placeholder="https://hooks.slack.com/services/..."
                      style={inputStyle}
                    />
                    <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                      Slack/Webhook alert on anomaly detection (ALERT_WEBHOOK_URL).
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* CTA Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || !url.trim()}
                style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                  padding: "12px 20px", background: C.bg, color: C.fg,
                  border: `1px solid ${C.border}`, cursor: testing || !url.trim() ? "not-allowed" : "pointer",
                  opacity: testing || !url.trim() ? 0.5 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {testing ? "TESTING..." : "TEST CONNECTION"}
              </button>

              <button
                type="button"
                onClick={() => setGenerated(true)}
                style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                  padding: "12px 20px", background: C.primary, color: "#fff",
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                GENERATE CONFIG →
              </button>
            </div>
          </div>

          {/* ── Right: Output ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {testError && (
              <div style={{
                border: `1px solid ${C.primary}50`, background: `${C.primary}08`,
                padding: 16, fontFamily: FONT, fontSize: 11, color: C.primary,
              }}>
                {testError}
              </div>
            )}

            {testResult?.data && (
              <div style={{
                border: "1px solid #007A0050", background: "#007A0008", padding: 16,
              }}>
                <div style={{ fontFamily: FONT, fontSize: 11, color: "#007A00", marginBottom: 8 }}>
                  ● Connection successful — instanceId:{" "}
                  <span style={{ fontWeight: 700 }}>{testResult.data.instanceId}</span>
                </div>
                {testResult.data.warnings?.length ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontFamily: FONT, fontSize: 10, color: "#AA7000" }}>
                    {testResult.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                ) : null}
                {testResult.data.dashboardUrl && (
                  <a
                    href={testResult.data.dashboardUrl}
                    style={{
                      display: "inline-block", marginTop: 12,
                      fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                      background: "#007A00", color: "#fff", padding: "6px 12px",
                      textDecoration: "none",
                    }}
                  >
                    Go to Dashboard →
                  </a>
                )}
              </div>
            )}

            {testResult?.data && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            )}

            {!generated ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 320, border: `1px dashed ${C.border}`, background: C.secondary,
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em",
                    color: C.border, marginBottom: 8,
                  }}>
                    ▮ TERMINAL
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 11, color: C.muted, margin: 0 }}>
                    Enter node type and URL, then run<br />
                    <span style={{ color: C.fg }}>TEST CONNECTION</span> or{" "}
                    <span style={{ color: C.fg }}>GENERATE CONFIG</span>
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: FONT, fontSize: 10, color: "#007A00", fontWeight: 700 }}>
                  ● Configuration generated
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

      {/* Footer */}
      <footer style={{
        marginTop: 64, borderTop: `1px solid ${C.border}`,
        background: C.fg, padding: "16px 24px",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: FONT, fontSize: 10, color: "#707070", letterSpacing: "0.1em" }}>
            <span style={{ background: C.primary, color: "#fff", padding: "2px 6px", marginRight: 8 }}>SENTINAI</span>
            by Tokamak Network
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: FONT, fontSize: 10, color: "#707070", textDecoration: "none", letterSpacing: "0.1em" }}
          >
            GITHUB →
          </a>
        </div>
      </footer>
    </div>
  );
}
