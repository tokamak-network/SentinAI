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
// Main
// ============================================================

async function main() {
  console.log("");
  console.log("  ⚙️  SentinAI Setup (Hybrid AI Strategy)");
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
    // Default to Anthropic
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
      const key = await askRequired(`? ${p.charAt(0).toUpperCase() + p.slice(1)} API Key: `);
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
      const override = await askOptional(`  ${m.desc} provider (anthropic/openai/gemini/litellm)`);
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
    if (cluster) {
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

  // Build .env.local
  const lines = [
    "# SentinAI Configuration",
    "# Hybrid AI Strategy: Multiple providers for resilience & optimization",
    "",
    "# --- 1. L2 Chain RPC ---",
    `L2_RPC_URL=${env.L2_RPC_URL}`,
    "",
    "# --- 2. AI Configuration (Priority: Module Override > Gateway > Anthropic > OpenAI > Gemini) ---",
  ];

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
  lines.push("# Defaults");
  lines.push("COST_TRACKING_ENABLED=true");
  lines.push("SCALING_SIMULATION_MODE=true");
  lines.push("");

  writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");

  console.log("  ✓ .env.local created");
  console.log("  ✓ Hybrid strategy configured");
  console.log("  Run: npm run dev");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error("Setup error:", err.message);
  rl.close();
  process.exit(1);
});
