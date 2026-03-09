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
type AiProvider = "none" | "qwen" | "anthropic" | "openai" | "gemini" | "gateway";
type DeployTarget = "eks" | "docker";

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
  { value: "gateway", label: "LiteLLM Gateway", keyVar: "AI_GATEWAY_URL", placeholder: "" },
  { value: "qwen", label: "Qwen (DashScope)", keyVar: "QWEN_API_KEY", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic (Claude)", keyVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
  { value: "openai", label: "OpenAI", keyVar: "OPENAI_API_KEY", placeholder: "sk-..." },
  { value: "gemini", label: "Google Gemini", keyVar: "GEMINI_API_KEY", placeholder: "AIza..." },
];

// ============================================================================
// Optional feature snippets
// ============================================================================

interface FeatureDef {
  id: string;
  label: string;
  description: string;
  snippet: string;
  nodeTypes?: NodeType[];
  deployTargets?: DeployTarget[];
}

const OPTIONAL_FEATURES: FeatureDef[] = [
  {
    id: "l1-failover",
    label: "L1 RPC Failover",
    description: "Auto-switch to backup endpoints on quota exhaustion",
    snippet:
      "# Backup L1 RPC endpoints (comma-separated, priority order)\n" +
      "L1_RPC_URLS=https://rpc1.example.io,https://rpc2.example.io\n" +
      "SENTINAI_L1_RPC_URL=https://rpc1.example.io",
  },
  {
    id: "eoa-monitor",
    label: "EOA Balance Monitor",
    description: "Alert when batcher/proposer wallet balance runs low",
    nodeTypes: ["opstack-l2", "arbitrum-nitro"],
    snippet:
      "# EOA wallet addresses to monitor\n" +
      "BATCHER_EOA_ADDRESS=0x...\n" +
      "PROPOSER_EOA_ADDRESS=0x...\n\n" +
      "# Auto-refill (optional — requires treasury wallet)\n" +
      "# TREASURY_PRIVATE_KEY=0x...\n" +
      "# EOA_BALANCE_CRITICAL_ETH=0.1\n" +
      "# EOA_REFILL_AMOUNT_ETH=0.5",
  },
  {
    id: "redis",
    label: "Redis State",
    description: "Persist metrics and anomaly history across restarts",
    snippet:
      "# Redis connection (default: in-memory, resets on restart)\n" +
      "# docker compose: service name is 'redis'\n" +
      "REDIS_URL=redis://redis:6379",
  },
  {
    id: "mcp-auth",
    label: "MCP / API Auth",
    description: "Secure write endpoints with a shared API key",
    snippet:
      "# Shared secret for dashboard write operations\n" +
      "SENTINAI_API_KEY=your-secret-key\n" +
      "NEXT_PUBLIC_SENTINAI_API_KEY=your-secret-key",
  },
  {
    id: "auto-remediation",
    label: "Auto-Remediation",
    description: "Automatically execute playbooks on detected anomalies",
    snippet:
      "# Enable autonomous remediation engine\n" +
      "AUTO_REMEDIATION_ENABLED=true",
  },
  {
    id: "proxyd",
    label: "Proxyd Integration",
    description: "Update L2 node Proxyd config on L1 RPC failover",
    nodeTypes: ["opstack-l2"],
    deployTargets: ["eks"] as DeployTarget[],
    snippet:
      "# Update Proxyd ConfigMap when L1 RPC failover occurs\n" +
      "L1_PROXYD_ENABLED=true\n" +
      "L1_PROXYD_CONFIGMAP_NAME=proxyd-config\n" +
      "L1_PROXYD_DATA_KEY=proxyd.toml\n" +
      "L1_PROXYD_UPSTREAM_GROUP=main\n" +
      "L1_PROXYD_SPARE_URLS=https://spare1.io,https://spare2.io",
  },
  {
    id: "real-scaling",
    label: "Real K8s Scaling",
    description: "Apply actual pod resource changes (simulation off by default)",
    deployTargets: ["eks"] as DeployTarget[],
    snippet:
      "# Disable simulation — applies real K8s scaling actions\n" +
      "SCALING_SIMULATION_MODE=false",
  },
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
  gatewayUrl: string;
  gatewayApiKey: string;
}

function buildEnvLocal(cfg: BuildConfig, featureSnippets: string[] = []): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const u = cfg.url.trim() || "<your-url>";
  const lines: string[] = [];

  if (cfg.networkName.trim()) lines.push(`NEXT_PUBLIC_NETWORK_NAME=${cfg.networkName.trim()}`);
  lines.push(`${primary}=${u}`);
  if (optional) lines.push(`${optional}=<optional-l1-rpc-url>`);
  if (cfg.authToken.trim()) lines.push(`SENTINAI_RPC_AUTH_TOKEN=${cfg.authToken.trim()}`);

  if (cfg.aiProvider === "gateway") {
    lines.push(`AI_GATEWAY_URL=${cfg.gatewayUrl.trim() || "<your-gateway-url>"}`);
    if (cfg.gatewayApiKey.trim()) lines.push(`AI_GATEWAY_KEY=${cfg.gatewayApiKey.trim()}`);
  } else {
    const aiOpt = AI_OPTIONS.find((o) => o.value === cfg.aiProvider);
    if (aiOpt?.keyVar) {
      const key = cfg.aiApiKey.trim() || `<your-${cfg.aiProvider}-key>`;
      lines.push(`${aiOpt.keyVar}=${key}`);
    } else {
      lines.push(`ANTHROPIC_API_KEY=<your-anthropic-key>`);
    }
  }

  if (cfg.awsClusterName.trim()) lines.push(`AWS_CLUSTER_NAME=${cfg.awsClusterName.trim()}`);
  if (cfg.alertWebhookUrl.trim()) lines.push(`ALERT_WEBHOOK_URL=${cfg.alertWebhookUrl.trim()}`);

  if (featureSnippets.length > 0) {
    lines.push("");
    lines.push("# --- Optional Features ---");
    featureSnippets.forEach(snippet => {
      lines.push("");
      lines.push(snippet);
    });
  }

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
            { href: "/connect", label: "DEPLOY" },
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
// Deploy step
// ============================================================================

function DeployStep({
  number, title, font, colors, children, last,
}: {
  number: number; title: string; font: string;
  colors: typeof C; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 16, paddingBottom: last ? 0 : 24 }}>
      {/* Left: number + line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, background: colors.fg,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ fontFamily: font, fontSize: 11, fontWeight: 700, color: "#fff" }}>
            {number}
          </span>
        </div>
        {!last && (
          <div style={{ flex: 1, width: 1, background: colors.border, marginTop: 4 }} />
        )}
      </div>

      {/* Right: content */}
      <div style={{ flex: 1, paddingBottom: last ? 0 : 8 }}>
        <div style={{
          fontFamily: font, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em",
          color: colors.muted, marginBottom: 10, paddingTop: 6,
        }}>
          {title}
        </div>
        {children}
      </div>
    </div>
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
  const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null);
  const [url, setUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("none");
  const [aiApiKey, setAiApiKey] = useState("");
  const [awsClusterName, setAwsClusterName] = useState("");
  const [alertWebhookUrl, setAlertWebhookUrl] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [gatewayApiKey, setGatewayApiKey] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [enabledFeatures, setEnabledFeatures] = useState<Set<string>>(new Set(["redis", "auto-remediation"]));

  const [generated, setGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OnboardingResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const currentConfig = NODE_CONFIGS.find((c) => c.type === nodeType)!;
  const selectedAi = AI_OPTIONS.find((o) => o.value === aiProvider)!;

  const buildCfg: BuildConfig = {
    nodeType, url, authToken, networkName, aiProvider, aiApiKey,
    awsClusterName, alertWebhookUrl, gatewayUrl, gatewayApiKey,
  };

  const visibleFeatures = OPTIONAL_FEATURES.filter(
    f =>
      (!f.nodeTypes || f.nodeTypes.includes(nodeType)) &&
      (!f.deployTargets || !deployTarget || f.deployTargets.includes(deployTarget))
  );

  const envLocal = useMemo(() => {
    const featureSnippets = OPTIONAL_FEATURES
      .filter(f =>
        enabledFeatures.has(f.id) &&
        (!f.nodeTypes || f.nodeTypes.includes(nodeType)) &&
        (!f.deployTargets || !deployTarget || f.deployTargets.includes(deployTarget))
      )
      .map(f => f.snippet);
    return buildEnvLocal(buildCfg, featureSnippets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeType, url, authToken, networkName, aiProvider, aiApiKey, awsClusterName, alertWebhookUrl, gatewayUrl, gatewayApiKey, deployTarget, enabledFeatures]);

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
    setEnabledFeatures(new Set(["redis", "auto-remediation"]));
  }

  function toggleFeature(id: string) {
    setEnabledFeatures(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const isLocalUrl = /localhost|127\.0\.0\.1/.test(url);

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
            Enter your node details to generate a{" "}
            <code style={{ background: C.secondary, padding: "1px 5px", fontSize: 11 }}>.env.local</code>
            {" "}file and deploy with{" "}
            <code style={{ background: C.secondary, padding: "1px 5px", fontSize: 11 }}>docker compose</code>
            {" "}— includes Redis and Caddy by default.
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

            {/* ② Deployment Target */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ② DEPLOYMENT TARGET
                </span>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  {
                    value: "eks" as DeployTarget,
                    label: "AWS EKS / Kubernetes",
                    sub: "Full auto-scaling · pod monitoring · RCA · remediation",
                    badge: "FULL",
                    badgeColor: "#006600",
                  },
                  {
                    value: "docker" as DeployTarget,
                    label: "Docker / VM",
                    sub: "Monitoring · anomaly detection · NLOps · alerts",
                    badge: "MONITORING",
                    badgeColor: "#0055AA",
                  },
                ].map(({ value, label, sub, badge, badgeColor }) => {
                  const isSelected = deployTarget === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { setDeployTarget(value); if (value === "docker") { setAwsClusterName(""); } resetOutput(); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", textAlign: "left", cursor: "pointer",
                        background: isSelected ? `${badgeColor}08` : C.bg,
                        border: `1px solid ${isSelected ? badgeColor : C.border}`,
                        fontFamily: FONT,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.fg, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{
                          fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em",
                          background: badgeColor, color: "#fff", padding: "2px 6px",
                        }}>{badge}</span>
                        {isSelected && (
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: badgeColor }} />
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* EKS: cluster name + prerequisites */}
                {deployTarget === "eks" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
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
                        Used for K8s API auto-detection and token generation (AWS_CLUSTER_NAME).
                      </p>
                    </div>
                    <div style={{ background: "#FFFBEA", border: `1px solid #E0C800`, padding: "10px 12px" }}>
                      <p style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: "#7A6000", margin: "0 0 4px", letterSpacing: "0.1em" }}>
                        ⚠ CONTAINER PREREQUISITES
                      </p>
                      <ul style={{ fontFamily: FONT, fontSize: 9, color: "#5A4800", margin: "0 0 4px", paddingLeft: 14 }}>
                        <li><code style={{ background: "#FFF3A0", padding: "0 3px" }}>aws</code> CLI + IAM credentials (role, env vars, or profile)</li>
                        <li><code style={{ background: "#FFF3A0", padding: "0 3px" }}>kubectl</code> CLI installed in the container</li>
                      </ul>
                      <p style={{ fontFamily: FONT, fontSize: 9, color: "#5A4800", margin: 0 }}>
                        Alternative: set <code style={{ background: "#FFF3A0", padding: "0 3px" }}>K8S_API_URL</code> + <code style={{ background: "#FFF3A0", padding: "0 3px" }}>K8S_TOKEN</code> directly (Advanced).
                      </p>
                    </div>
                  </div>
                )}

                {/* Docker: monitoring-only notice */}
                {deployTarget === "docker" && (
                  <div style={{ background: "#EEF4FF", border: `1px solid #B0C8F0`, padding: "10px 12px", marginTop: 4 }}>
                    <p style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: "#003A8C", margin: "0 0 4px", letterSpacing: "0.1em" }}>
                      ℹ MONITORING MODE
                    </p>
                    <p style={{ fontFamily: FONT, fontSize: 9, color: "#002D6E", margin: 0 }}>
                      Auto-scaling requires Kubernetes. Anomaly detection, RCA, NLOps, and alerts are fully available.
                      To enable scaling later, add <code style={{ background: "#D0E4FF", padding: "0 3px" }}>AWS_CLUSTER_NAME</code> and redeploy.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ③ Connection */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ③ CONNECTION
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
                  {isLocalUrl && (
                    <div style={{ background: "#FFF0F0", border: `1px solid #E08080`, padding: "8px 10px", marginTop: 6 }}>
                      <p style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: "#8B0000", margin: "0 0 2px" }}>
                        ✕ LOCAL URL NOT SUPPORTED
                      </p>
                      <p style={{ fontFamily: FONT, fontSize: 9, color: "#6B0000", margin: 0 }}>
                        SentinAI runs inside Docker and cannot reach <code style={{ background: "#FFD0D0", padding: "0 3px" }}>localhost</code> on your machine.
                        Use a network-accessible IP or hostname instead.
                      </p>
                    </div>
                  )}
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

            {/* ④ AI Provider */}
            <div style={{ border: `1px solid ${C.border}` }}>
              <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", background: "#F7F7F7" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: C.fg }}>
                  ④ AI PROVIDER
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
                    onChange={(e) => {
                      setAiProvider(e.target.value as AiProvider);
                      setAiApiKey("");
                      setGatewayUrl("");
                      setGatewayApiKey("");
                      resetOutput();
                    }}
                    style={{ ...inputStyle, appearance: "none" as const }}
                  >
                    {AI_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {aiProvider === "gateway" && (
                  <>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <label style={{ ...labelStyle, marginBottom: 0 }}>Gateway URL</label>
                        <span style={{
                          fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em",
                          background: C.accent, color: "#fff", padding: "1px 6px",
                        }}>PRIORITY 0</span>
                      </div>
                      <input
                        id="gateway-url"
                        type="url"
                        value={gatewayUrl}
                        onChange={(e) => { setGatewayUrl(e.target.value); resetOutput(); }}
                        placeholder="http://localhost:4000"
                        style={inputStyle}
                      />
                      <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                        Overrides all other providers when set (AI_GATEWAY_URL).
                      </p>
                    </div>
                    <div>
                      <label style={labelStyle}>Gateway API Key <span style={{ fontWeight: 400 }}>(Optional)</span></label>
                      <input
                        id="gateway-api-key"
                        type="password"
                        value={gatewayApiKey}
                        onChange={(e) => { setGatewayApiKey(e.target.value); resetOutput(); }}
                        placeholder="sk-..."
                        style={inputStyle}
                      />
                      <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "4px 0 0" }}>
                        Required if your LiteLLM server has auth enabled (AI_GATEWAY_KEY).
                      </p>
                    </div>
                  </>
                )}

                {aiProvider !== "none" && aiProvider !== "gateway" && (
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

            {/* ⑤ Advanced (collapsible) */}
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
                <span>⑤ ADVANCED SETTINGS (Optional)</span>
                <span style={{ fontSize: 12 }}>{advancedOpen ? "−" : "+"}</span>
              </button>

              {advancedOpen && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

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
                GET SETUP GUIDE →
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
                    ▮ DEPLOY GUIDE
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 11, color: C.muted, margin: 0 }}>
                    Enter node type and URL, then run<br />
                    <span style={{ color: C.fg }}>TEST CONNECTION</span> or{" "}
                    <span style={{ color: C.fg }}>GET SETUP GUIDE</span>
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 10, color: "#007A00", fontWeight: 700, marginBottom: 16 }}>
                  ● Setup guide ready — follow the steps below
                </div>

                {/* Optional Features selector */}
                <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: `2px solid ${C.fg}` }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.15em",
                    color: C.fg, marginBottom: 10,
                  }}>
                    OPTIONAL FEATURES — included in .env.local below
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {visibleFeatures.map(f => {
                      const on = enabledFeatures.has(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => toggleFeature(f.id)}
                          style={{
                            fontFamily: FONT, textAlign: "left", cursor: "pointer",
                            padding: "8px 10px",
                            border: `1px solid ${on ? C.accent : C.border}`,
                            background: on ? `${C.accent}0A` : C.bg,
                            display: "flex", flexDirection: "column", gap: 2,
                          }}
                        >
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            color: on ? C.accent : C.fg,
                            display: "flex", alignItems: "center", gap: 6,
                          }}>
                            <span style={{
                              width: 12, height: 12, border: `1px solid ${on ? C.accent : C.border}`,
                              background: on ? C.accent : "transparent", flexShrink: 0,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {on && <span style={{ color: "#fff", fontSize: 8, lineHeight: 1 }}>✓</span>}
                            </span>
                            {f.label}
                          </span>
                          <span style={{ fontSize: 9, color: C.muted, paddingLeft: 18 }}>
                            {f.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 1 */}
                <DeployStep number={1} title="CLONE REPOSITORY" font={FONT} colors={C}>
                  <CodeBlock
                    title="terminal"
                    content={`git clone ${GITHUB_URL}.git\ncd SentinAI`}
                    copyId="clone"
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                  <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "8px 0 0" }}>
                    Clone the repository to get <code style={{ background: C.secondary, padding: "1px 4px" }}>docker-compose.yml</code>{" "}
                    and all required configuration files.
                  </p>
                </DeployStep>

                {/* Step 2 */}
                <DeployStep number={2} title="CREATE .ENV.LOCAL" font={FONT} colors={C}>
                  <CodeBlock
                    title=".env.local"
                    content={envLocal}
                    copyId="env"
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                  <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "8px 0 0" }}>
                    Save this as <code style={{ background: C.secondary, padding: "1px 4px" }}>.env.local</code>{" "}
                    in the same directory as your <code style={{ background: C.secondary, padding: "1px 4px" }}>docker-compose.yml</code>.
                  </p>
                </DeployStep>

                {/* Step 3 */}
                <DeployStep number={3} title="START WITH DOCKER COMPOSE" font={FONT} colors={C}>
                  <CodeBlock
                    title="terminal"
                    content={`docker compose up -d`}
                    copyId="compose"
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                  <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "8px 0 0" }}>
                    Starts SentinAI with Redis (state persistence) and Caddy (reverse proxy) by default.{" "}
                    <a
                      href={`${GITHUB_URL}/blob/main/docker-compose.yml`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: C.accent, textDecoration: "none", fontWeight: 700 }}
                    >
                      View docker-compose.yml →
                    </a>
                  </p>
                </DeployStep>

                {/* Step 4 */}
                <DeployStep number={4} title="OPEN DASHBOARD" font={FONT} colors={C} last>
                  <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}` }}>
                    <span style={{
                      flex: 1, fontFamily: FONT, fontSize: 11, color: C.accent,
                      padding: "10px 12px", background: C.secondary,
                    }}>
                      http://localhost:3002
                    </span>
                    <a
                      href="http://localhost:3002"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                        padding: "10px 16px", background: C.accent, color: "#fff",
                        textDecoration: "none", whiteSpace: "nowrap",
                      }}
                    >
                      OPEN →
                    </a>
                  </div>
                </DeployStep>

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
