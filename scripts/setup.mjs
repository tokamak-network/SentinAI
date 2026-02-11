#!/usr/bin/env node

import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise((res) => {
    rl.question(prompt, (answer) => res(answer));
  });
}

function isValidUrl(value) {
  return /^https?:\/\/.+/.test(value);
}

async function askRequired(prompt, validate) {
  while (true) {
    const answer = (await ask(prompt)).trim();
    if (!answer) {
      console.log("  This field is required. Please try again.");
      continue;
    }
    if (validate && !validate(answer)) {
      continue;
    }
    return answer;
  }
}

async function askOptional(prompt, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await ask(`${prompt}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function askOptionalUrl(prompt, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  while (true) {
    const answer = (await ask(`${prompt}${suffix}: `)).trim();
    if (!answer) return defaultValue || "";
    if (!isValidUrl(answer)) {
      console.log("  URL must start with http:// or https://.");
      continue;
    }
    return answer;
  }
}

async function askYesNo(prompt, defaultNo = true) {
  const suffix = defaultNo ? " (y/N)" : " (Y/n)";
  const answer = (await ask(`${prompt}${suffix}: `)).trim().toLowerCase();
  if (!answer) return !defaultNo;
  return answer === "y" || answer === "yes";
}

// ============================================================
// Setup Mode Selection
// ============================================================

async function selectSetupMode() {
  console.log("  Choose setup mode:");
  console.log("  1. Quick   - Essential settings only (~30 seconds)");
  console.log("  2. Advanced - Full configuration with hybrid AI strategy");
  console.log("");
  const mode = await askOptional("▸ Setup mode (1=quick, 2=advanced)", "1");
  return mode === "1" || mode.toLowerCase() === "quick";
}

// ============================================================
// AI Connection Test
// ============================================================

async function testAIConnection(apiKey, provider, gatewayUrl = null) {
  const baseUrl = gatewayUrl || (
    provider === 'qwen' ? (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode') :
    provider === 'anthropic' ? 'https://api.anthropic.com' :
    provider === 'openai' ? 'https://api.openai.com' :
    'https://generativelanguage.googleapis.com'
  );

  try {
    if (provider === 'qwen') {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen-turbo-latest',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    } else if (provider === 'anthropic') {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    } else if (provider === 'openai') {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    } else if (provider === 'gemini') {
      const response = await fetch(`${baseUrl}/v1beta/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash-lite',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    }
  } catch {
    return false;
  }
  return false;
}

// ============================================================
// AWS Profile Configuration
// ============================================================

async function configureNewAwsProfile() {
  const profileName = (await askRequired("  ▸ Profile name: ")).trim();
  const accessKeyId = (await askRequired("  ▸ AWS Access Key ID: ")).trim();
  const secretAccessKey = (await askRequired("  ▸ AWS Secret Access Key: ")).trim();
  const region = await askOptional("  ▸ AWS Region", "ap-northeast-2");

  try {
    const opts = { timeout: 5000 };
    execFileSync('aws', ['configure', 'set', 'aws_access_key_id', accessKeyId, '--profile', profileName], opts);
    execFileSync('aws', ['configure', 'set', 'aws_secret_access_key', secretAccessKey, '--profile', profileName], opts);
    execFileSync('aws', ['configure', 'set', 'region', region, '--profile', profileName], opts);
    execFileSync('aws', ['configure', 'set', 'output', 'json', '--profile', profileName], opts);

    process.stdout.write("  Verifying credentials...");
    execFileSync('aws', ['sts', 'get-caller-identity', '--profile', profileName], { timeout: 10000 });
    console.log(" OK");
    return profileName;
  } catch {
    console.log(" Failed - check your credentials.");
    return null;
  }
}

async function askAwsProfile() {
  const createNew = await askYesNo("▸ Configure new AWS profile?", true);
  if (createNew) {
    const profileName = await configureNewAwsProfile();
    if (profileName) return profileName;
    console.log("  Falling back to manual profile input.");
  }
  const existing = await askOptional("▸ AWS Profile (existing)");
  return existing && existing.trim() ? existing.trim() : null;
}

// ============================================================
// K8s Auto-Detection
// ============================================================

const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease'];
const OP_COMPONENTS = ['geth', 'node', 'batcher', 'proposer'];

function detectAppPrefix(podNames) {
  for (const pod of podNames) {
    for (const comp of OP_COMPONENTS) {
      // StatefulSet: <prefix>-<comp>-0, Deployment: <prefix>-<comp>-<hash>
      const pattern = `-${comp}-`;
      const idx = pod.indexOf(pattern);
      if (idx > 0) return pod.substring(0, idx);
    }
  }
  return null;
}

async function autoDetectK8sConfig(clusterName, profile) {
  const result = { namespace: null, appPrefix: null, namespaces: [] };

  try {
    // 1. Update kubeconfig for kubectl access
    const args = ['eks', 'update-kubeconfig', '--name', clusterName];
    if (profile) args.push('--profile', profile);
    process.stdout.write("  Connecting to cluster...");
    execFileSync('aws', args, { timeout: 15000, stdio: 'pipe' });
    console.log(" OK");
  } catch {
    console.log(" Failed");
    return result;
  }

  try {
    // 2. List namespaces
    const nsOutput = execFileSync(
      'kubectl', ['get', 'namespaces', '-o', 'jsonpath={.items[*].metadata.name}'],
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
    );
    const allNs = nsOutput.trim().split(/\s+/).filter(Boolean);
    result.namespaces = allNs.filter(ns => !SYSTEM_NAMESPACES.includes(ns));

    // Prefer non-default namespace (likely the workload namespace)
    const candidates = result.namespaces.filter(ns => ns !== 'default');
    if (candidates.length === 1) {
      result.namespace = candidates[0];
    } else if (candidates.length > 1) {
      // Heuristic: namespace matching cluster name
      const match = candidates.find(ns => clusterName.includes(ns) || ns.includes(clusterName));
      if (match) result.namespace = match;
    }
  } catch {
    // kubectl not available or no access
    return result;
  }

  try {
    // 3. Detect app prefix from pod names
    const targetNs = result.namespace || 'default';
    const podsOutput = execFileSync(
      'kubectl', ['get', 'pods', '-n', targetNs, '-o', 'jsonpath={.items[*].metadata.name}'],
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
    );
    const pods = podsOutput.trim().split(/\s+/).filter(Boolean);
    result.appPrefix = detectAppPrefix(pods);
  } catch {
    // No pods or no access to namespace
  }

  return result;
}

// ============================================================
// Quick Setup (Simplified AI Flow)
// ============================================================

async function quickSetup() {
  const env = {};

  // 1. L2 RPC URL
  env.L2_RPC_URL = await askRequired("▸ L2 RPC URL: ", (v) => {
    if (!isValidUrl(v)) {
      console.log("  URL must start with http:// or https://.");
      return false;
    }
    return true;
  });

  // 2. AI Gateway
  console.log("");
  console.log("  === AI Configuration ===");
  console.log("  Priority: Qwen > Claude > GPT > Gemini");
  console.log("");
  const useGateway = await askYesNo("▸ Use AI Gateway server?", true);

  if (useGateway) {
    env.AI_GATEWAY_URL = await askRequired("▸ Gateway URL: ", (v) => {
      if (!isValidUrl(v)) {
        console.log("  URL must start with http:// or https://.");
        return false;
      }
      return true;
    });
    console.log("  Note: API Key is still required when using Gateway.");
  }

  // 3. API Keys (try in priority order)
  console.log("");
  console.log("  Enter API Key (priority: Qwen > Claude > GPT > Gemini)");
  console.log("  At least one is required.");
  console.log("");

  // Qwen (primary)
  const qwenKey = await askOptional("▸ Qwen API Key");
  if (qwenKey) {
    process.stdout.write("  Testing connection...");
    const ok = await testAIConnection(qwenKey, 'qwen', env.AI_GATEWAY_URL);
    if (ok) {
      console.log(" OK");
      env.QWEN_API_KEY = qwenKey;
    } else {
      console.log(" Failed - check your key.");
    }
  }

  // Claude (secondary)
  if (!env.QWEN_API_KEY) {
    const anthropicKey = await askOptional("▸ Anthropic API Key (Claude)");
    if (anthropicKey) {
      process.stdout.write("  Testing connection...");
      const ok = await testAIConnection(anthropicKey, 'anthropic', env.AI_GATEWAY_URL);
      if (ok) {
        console.log(" OK");
        env.ANTHROPIC_API_KEY = anthropicKey;
      } else {
        console.log(" Failed - check your key.");
      }
    }
  }

  // GPT (tertiary)
  if (!env.QWEN_API_KEY && !env.ANTHROPIC_API_KEY) {
    const openaiKey = await askOptional("▸ OpenAI API Key (GPT)");
    if (openaiKey) {
      process.stdout.write("  Testing connection...");
      const ok = await testAIConnection(openaiKey, 'openai', env.AI_GATEWAY_URL);
      if (ok) {
        console.log(" OK");
        env.OPENAI_API_KEY = openaiKey;
      } else {
        console.log(" Failed - check your key.");
      }
    }
  }

  // Gemini (quaternary)
  if (!env.QWEN_API_KEY && !env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    const geminiKey = await askOptional("▸ Gemini API Key");
    if (geminiKey) {
      process.stdout.write("  Testing connection...");
      const ok = await testAIConnection(geminiKey, 'gemini', env.AI_GATEWAY_URL);
      if (ok) {
        console.log(" OK");
        env.GEMINI_API_KEY = geminiKey;
      } else {
        console.log(" Failed - check your key.");
      }
    }
  }

  // At least one valid API key required
  if (!env.QWEN_API_KEY && !env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    console.log("");
    console.log("  At least one valid API Key is required.");
    console.log("  Please try again.");
    return quickSetup();
  }

  // 4. K8s Monitoring (optional)
  console.log("");
  const setupK8s = await askYesNo("▸ Setup K8s monitoring?", true);
  if (setupK8s) {
    const cluster = await askOptional("▸ EKS Cluster Name");
    if (cluster && cluster.trim()) {
      env.AWS_CLUSTER_NAME = cluster;
      const profile = await askAwsProfile();
      if (profile) env.AWS_PROFILE = profile;

      // Auto-detect namespace and app prefix
      const detected = await autoDetectK8sConfig(cluster, profile);
      if (detected.namespaces.length > 0) {
        console.log(`  Namespaces: ${detected.namespaces.join(', ')}`);
      }
      env.K8S_NAMESPACE = await askOptional("▸ K8s Namespace", detected.namespace || "default");
      env.K8S_APP_PREFIX = await askOptional("▸ K8s App Prefix", detected.appPrefix || "op");
    }
  }

  // Defaults (no user input)
  env.COST_TRACKING_ENABLED = "true";
  env.SCALING_SIMULATION_MODE = "true";

  return env;
}

// ============================================================
// Advanced Setup (current implementation)
// ============================================================

async function advancedSetup() {
  const env = {};

  // --- 1. L2 RPC (Required) ---
  env.L2_RPC_URL = await askRequired("▸ L2 RPC URL: ", (v) => {
    if (!isValidUrl(v)) {
      console.log("  URL must start with http:// or https://.");
      return false;
    }
    return true;
  });

  // --- 2. AI Providers (Hybrid Strategy) ---
  console.log("");
  console.log("  === AI Configuration (Hybrid Strategy) ===");
  console.log("  Set multiple providers for fallback & module-specific optimization");
  console.log("");

  // 2.1 Primary provider (required)
  console.log("  Priority: Module Override > Gateway > Qwen > Anthropic > OpenAI > Gemini");
  console.log("");
  const primaryChoice = await askOptional("▸ Primary AI Provider (qwen/anthropic/openai/gemini)", "qwen");
  const primary = primaryChoice.toLowerCase().trim();

  if (primary === "qwen" || primary === "dashscope") {
    env.QWEN_API_KEY = await askRequired("▸ Qwen API Key: ");
  } else if (primary === "anthropic" || primary === "claude") {
    env.ANTHROPIC_API_KEY = await askRequired("▸ Anthropic API Key: ");
  } else if (primary === "openai" || primary === "gpt") {
    env.OPENAI_API_KEY = await askRequired("▸ OpenAI API Key: ");
  } else if (primary === "gemini") {
    env.GEMINI_API_KEY = await askRequired("▸ Gemini API Key: ");
  } else {
    env.QWEN_API_KEY = await askRequired("▸ Qwen API Key: ");
  }

  // 2.2 Additional providers (optional)
  console.log("");
  const wantMultiple = await askYesNo("▸ Add multiple providers for fallback?", true);
  if (wantMultiple) {
    const providers = [];
    if (!env.QWEN_API_KEY) {
      const add = await askYesNo("  Add Qwen?", false);
      if (add) providers.push("qwen");
    }
    if (!env.ANTHROPIC_API_KEY) {
      const add = await askYesNo("  Add Anthropic?", false);
      if (add) providers.push("anthropic");
    }
    if (!env.OPENAI_API_KEY) {
      const add = await askYesNo("  Add OpenAI?", false);
      if (add) providers.push("openai");
    }
    if (!env.GEMINI_API_KEY) {
      const add = await askYesNo("  Add Gemini?", false);
      if (add) providers.push("gemini");
    }

    for (const p of providers) {
      const displayName = p === 'qwen' ? 'Qwen' : p.charAt(0).toUpperCase() + p.slice(1);
      const key = await askRequired(`▸ ${displayName} API Key: `);
      env[`${p.toUpperCase()}_API_KEY`] = key;
    }
  }

  // 2.3 LiteLLM Gateway (optional)
  console.log("");
  const useGateway = await askYesNo("▸ Use LiteLLM Gateway?", false);
  if (useGateway) {
    env.AI_GATEWAY_URL = await askRequired("▸ Gateway URL: ", isValidUrl);
  }

  // 2.4 Module-level provider overrides (optional)
  console.log("");
  const wantOverrides = await askYesNo("▸ Configure module-specific AI providers?", false);
  if (wantOverrides) {
    console.log("  (Leave empty to use primary provider)");
    const modules = [
      { name: "ANOMALY", desc: "Anomaly Detection (Layer 2)" },
      { name: "COST", desc: "Cost Optimizer" },
      { name: "REPORT", desc: "Daily Report" },
      { name: "PREDICTOR", desc: "Predictive Scaler" },
    ];
    for (const m of modules) {
      const override = await askOptional(`  ▸ ${m.desc} provider (qwen/anthropic/openai/gemini/litellm)`);
      if (override && override.trim()) {
        env[`${m.name}_PROVIDER`] = override.toLowerCase().trim();
      }
    }
  }

  // --- 3. K8s Configuration (optional) ---
  console.log("");
  const setupK8s = await askYesNo("▸ Setup K8s monitoring?", false);
  if (setupK8s) {
    const cluster = await askOptional("▸ EKS Cluster Name");
    if (cluster && cluster.trim()) {
      env.AWS_CLUSTER_NAME = cluster;
      const profile = await askAwsProfile();
      if (profile) env.AWS_PROFILE = profile;

      // Auto-detect namespace and app prefix
      const detected = await autoDetectK8sConfig(cluster, profile);
      if (detected.namespaces.length > 0) {
        console.log(`  Namespaces: ${detected.namespaces.join(', ')}`);
      }
      env.K8S_NAMESPACE = await askOptional("  K8s Namespace", detected.namespace || "default");
      env.K8S_APP_PREFIX = await askOptional("  K8s App Prefix", detected.appPrefix || "op");
    }
  }

  // --- 4. Optional Features ---
  console.log("");
  const webhook = await askOptionalUrl("▸ Alert Webhook URL (optional)");
  if (webhook) {
    env.ALERT_WEBHOOK_URL = webhook;
  }

  // Defaults
  env.COST_TRACKING_ENABLED = "true";
  env.SCALING_SIMULATION_MODE = "true";

  return env;
}

// ============================================================
// Write .env.local
// ============================================================

function writeEnvFile(env, isQuickMode) {
  const lines = [
    "# SentinAI Configuration",
    isQuickMode ? "# Quick Setup Mode" : "# Advanced Setup Mode (Hybrid AI Strategy)",
    "",
    "# --- 1. L2 Chain RPC ---",
    `L2_RPC_URL=${env.L2_RPC_URL}`,
    "",
    "# --- 2. AI Configuration",
  ];

  if (isQuickMode) {
    lines.push("# (Fallback: Qwen > Anthropic > OpenAI > Gemini)");
  } else {
    lines.push("# (Priority: Module Override > Gateway > Qwen > Anthropic > OpenAI > Gemini)");
  }

  if (env.AI_GATEWAY_URL) {
    lines.push(`AI_GATEWAY_URL=${env.AI_GATEWAY_URL}`);
  }
  if (env.QWEN_API_KEY) {
    lines.push(`QWEN_API_KEY=${env.QWEN_API_KEY}`);
  }
  if (env.ANTHROPIC_API_KEY) {
    lines.push(`ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}`);
  }
  if (env.OPENAI_API_KEY) {
    lines.push(`OPENAI_API_KEY=${env.OPENAI_API_KEY}`);
  }
  if (env.GEMINI_API_KEY) {
    lines.push(`GEMINI_API_KEY=${env.GEMINI_API_KEY}`);
  }

  if (env.ANOMALY_PROVIDER || env.COST_PROVIDER || env.REPORT_PROVIDER || env.PREDICTOR_PROVIDER) {
    lines.push("");
    lines.push("# --- 3. Module-Level AI Provider Overrides (Hybrid Strategy) ---");
    if (env.ANOMALY_PROVIDER) {
      lines.push(`ANOMALY_PROVIDER=${env.ANOMALY_PROVIDER}`);
    }
    if (env.COST_PROVIDER) {
      lines.push(`COST_PROVIDER=${env.COST_PROVIDER}`);
    }
    if (env.REPORT_PROVIDER) {
      lines.push(`REPORT_PROVIDER=${env.REPORT_PROVIDER}`);
    }
    if (env.PREDICTOR_PROVIDER) {
      lines.push(`PREDICTOR_PROVIDER=${env.PREDICTOR_PROVIDER}`);
    }
  }

  if (env.AWS_CLUSTER_NAME) {
    lines.push("");
    lines.push("# --- 4. Kubernetes Monitoring ---");
    lines.push(`AWS_CLUSTER_NAME=${env.AWS_CLUSTER_NAME}`);
    if (env.AWS_PROFILE) {
      lines.push(`AWS_PROFILE=${env.AWS_PROFILE}`);
    }
    lines.push(`K8S_NAMESPACE=${env.K8S_NAMESPACE || "default"}`);
    lines.push(`K8S_APP_PREFIX=${env.K8S_APP_PREFIX || "op"}`);
  }

  if (env.ALERT_WEBHOOK_URL) {
    lines.push("");
    lines.push("# --- 5. Optional Features ---");
    lines.push(`ALERT_WEBHOOK_URL=${env.ALERT_WEBHOOK_URL}`);
  }

  lines.push("");
  lines.push("# --- Defaults ---");
  lines.push(`COST_TRACKING_ENABLED=${env.COST_TRACKING_ENABLED || "true"}`);
  lines.push(`SCALING_SIMULATION_MODE=${env.SCALING_SIMULATION_MODE || "true"}`);

  if (isQuickMode) {
    lines.push("");
    lines.push("# To add webhooks or hybrid AI settings:");
    lines.push("# Run: npm run setup (choose Advanced mode)");
    lines.push("# Or edit this file manually");
  }

  lines.push("");

  writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("");
  console.log("  ⚙️  SentinAI Setup");
  console.log("");

  // Select setup mode
  const isQuickMode = await selectSetupMode();
  console.log("");

  // Check existing .env.local
  if (existsSync(ENV_PATH)) {
    const overwrite = await askYesNo("▸ .env.local already exists. Overwrite?");
    if (!overwrite) {
      console.log("  Cancelled.");
      rl.close();
      return;
    }
    console.log("");
  }

  // Run setup
  const env = isQuickMode ? await quickSetup() : await advancedSetup();

  // Write .env.local
  writeEnvFile(env, isQuickMode);

  // Success message
  console.log("");
  console.log("  ✓ .env.local created");
  if (isQuickMode) {
    console.log("  ✓ Quick setup complete");
  } else {
    console.log("  ✓ Advanced setup with hybrid strategy");
  }
  console.log("  Run: npm run dev");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error("Setup error:", err.message);
  rl.close();
  process.exit(1);
});
