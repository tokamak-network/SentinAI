#!/usr/bin/env node

import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
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
    provider === 'anthropic' ? 'https://api.anthropic.com' :
    provider === 'openai' ? 'https://api.openai.com' :
    'https://generativelanguage.googleapis.com'
  );

  try {
    if (provider === 'anthropic') {
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

  // 2. AI Gateway 사용 여부
  console.log("");
  console.log("  === AI Configuration ===");
  console.log("  모델 우선순위: Claude > GPT > Gemini");
  console.log("");
  const useGateway = await askYesNo("▸ AI Gateway 서버 사용?", true);

  if (useGateway) {
    // Gateway URL 입력
    env.AI_GATEWAY_URL = await askRequired("▸ Gateway URL: ", (v) => {
      if (!isValidUrl(v)) {
        console.log("  URL must start with http:// or https://.");
        return false;
      }
      return true;
    });
    console.log("  ℹ️  Gateway 사용 시에도 API Key가 필요합니다.");
  }

  // 3. API Key 입력 (우선순위 순서대로 시도)
  console.log("");
  console.log("  API Key를 입력하세요 (우선순위: Claude > GPT > Gemini)");
  console.log("  하나만 입력해도 됩니다.");
  console.log("");

  // Claude (1순위)
  const anthropicKey = await askOptional("▸ Anthropic API Key (Claude)");
  if (anthropicKey) {
    process.stdout.write("  🔄 연결 테스트 중...");
    const ok = await testAIConnection(anthropicKey, 'anthropic', env.AI_GATEWAY_URL);
    if (ok) {
      console.log(" ✅ 성공!");
      env.ANTHROPIC_API_KEY = anthropicKey;
    } else {
      console.log(" ❌ 실패 - 키를 확인하세요.");
    }
  }

  // GPT (2순위) - Claude 없을 때만 필수
  if (!env.ANTHROPIC_API_KEY) {
    const openaiKey = await askOptional("▸ OpenAI API Key (GPT)");
    if (openaiKey) {
      process.stdout.write("  🔄 연결 테스트 중...");
      const ok = await testAIConnection(openaiKey, 'openai', env.AI_GATEWAY_URL);
      if (ok) {
        console.log(" ✅ 성공!");
        env.OPENAI_API_KEY = openaiKey;
      } else {
        console.log(" ❌ 실패 - 키를 확인하세요.");
      }
    }
  }

  // Gemini (3순위) - 위 둘 다 없을 때만 필수
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    const geminiKey = await askOptional("▸ Gemini API Key");
    if (geminiKey) {
      process.stdout.write("  🔄 연결 테스트 중...");
      const ok = await testAIConnection(geminiKey, 'gemini', env.AI_GATEWAY_URL);
      if (ok) {
        console.log(" ✅ 성공!");
        env.GEMINI_API_KEY = geminiKey;
      } else {
        console.log(" ❌ 실패 - 키를 확인하세요.");
      }
    }
  }

  // 최소 하나의 API 키 필요
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    console.log("");
    console.log("  ⚠️  최소 하나의 유효한 API Key가 필요합니다.");
    console.log("  다시 시도하세요.");
    return quickSetup();  // 재시도
  }

  // 4. K8s Monitoring (optional)
  console.log("");
  const setupK8s = await askYesNo("▸ Setup K8s monitoring?", true);
  if (setupK8s) {
    const cluster = await askOptional("▸ EKS Cluster Name");
    if (cluster && cluster.trim()) {
      env.AWS_CLUSTER_NAME = cluster;
      env.K8S_NAMESPACE = await askOptional("▸ K8s Namespace", "default");
      env.K8S_APP_PREFIX = await askOptional("▸ K8s App Prefix", "op");
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
  console.log("  Priority: Module Override > Gateway > Anthropic > OpenAI > Gemini");
  console.log("");
  const primaryChoice = await askOptional("▸ Primary AI Provider (anthropic/openai/gemini)", "anthropic");
  const primary = primaryChoice.toLowerCase().trim();

  if (primary === "anthropic" || primary === "claude") {
    env.ANTHROPIC_API_KEY = await askRequired("▸ Anthropic API Key: ");
  } else if (primary === "openai" || primary === "gpt") {
    env.OPENAI_API_KEY = await askRequired("▸ OpenAI API Key: ");
  } else if (primary === "gemini") {
    env.GEMINI_API_KEY = await askRequired("▸ Gemini API Key: ");
  } else {
    env.ANTHROPIC_API_KEY = await askRequired("▸ Anthropic API Key: ");
  }

  // 2.2 Additional providers (optional)
  console.log("");
  const wantMultiple = await askYesNo("▸ Add multiple providers for fallback?", true);
  if (wantMultiple) {
    const providers = [];
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
      const key = await askRequired(`▸ ${p.charAt(0).toUpperCase() + p.slice(1)} API Key: `);
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
      const override = await askOptional(`  ▸ ${m.desc} provider (anthropic/openai/gemini/litellm)`);
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
      env.K8S_NAMESPACE = await askOptional("  K8s Namespace", "default");
      env.K8S_APP_PREFIX = await askOptional("  K8s App Prefix", "op");
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
    lines.push("# (Fallback: Anthropic > OpenAI > Gemini)");
  } else {
    lines.push("# (Priority: Module Override > Gateway > Anthropic > OpenAI > Gemini)");
  }

  if (env.AI_GATEWAY_URL) {
    lines.push(`AI_GATEWAY_URL=${env.AI_GATEWAY_URL}`);
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
