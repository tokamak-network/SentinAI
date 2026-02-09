#!/usr/bin/env node

import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

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

function execCmd(cmd, timeoutMs = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout?.trim() || "", stderr: stderr?.trim() || "" });
    });
  });
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
// AWS Auto-Detection Helpers
// ============================================================

async function checkAwsCli() {
  const { error } = await execCmd("aws --version");
  return !error;
}

async function getAwsRegion() {
  // Try: aws configure get region
  const { stdout } = await execCmd("aws configure get region");
  return stdout || null;
}

async function listEksClusters(region) {
  const regionFlag = region ? ` --region ${region}` : "";
  const { error, stdout } = await execCmd(`aws eks list-clusters${regionFlag} --output json`);
  if (error || !stdout) return [];
  try {
    return JSON.parse(stdout).clusters || [];
  } catch {
    return [];
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("");
  console.log("  ⚙️  SentinAI Setup");
  console.log("");

  // Check existing .env.local
  if (existsSync(ENV_PATH)) {
    const overwrite = await askYesNo("? .env.local already exists. Overwrite?");
    if (!overwrite) {
      console.log("  Cancelled.");
      rl.close();
      return;
    }
    console.log("");
  }

  const env = {};

  // --- 1. L2 RPC (Required) ---
  env.L2_RPC_URL = await askRequired("? L2 RPC URL: ", (v) => {
    if (!isValidUrl(v)) {
      console.log("  URL must start with http:// or https://.");
      return false;
    }
    return true;
  });

  // --- 2. AI Provider (Simple Selection) ---
  console.log("");
  console.log("  AI Providers: anthropic (Claude) | openai (GPT) | gemini | gateway");
  const providerChoice = await askOptional("? AI Provider", "anthropic");
  console.log("");

  const provider = providerChoice.toLowerCase().trim();
  if (provider === "anthropic" || provider === "claude") {
    env.ANTHROPIC_API_KEY = await askRequired("? Anthropic API Key: ");
  } else if (provider === "openai" || provider === "gpt") {
    env.OPENAI_API_KEY = await askRequired("? OpenAI API Key: ");
  } else if (provider === "gemini") {
    env.GEMINI_API_KEY = await askRequired("? Gemini API Key: ");
  } else if (provider === "gateway") {
    env.AI_GATEWAY_URL = await askRequired(
      "? Gateway URL",
      isValidUrl
    );
    env.ANTHROPIC_API_KEY = await askRequired("? API Key (for Gateway): ");
  }

  // --- 3. Optional: K8s (Simple) ---
  const setupK8s = await askYesNo("? Setup K8s monitoring?", true);
  if (setupK8s) {
    const cluster = await askOptional("? EKS Cluster Name");
    if (cluster) {
      env.AWS_CLUSTER_NAME = cluster;
    }
    env.K8S_NAMESPACE = await askOptional("? K8s Namespace", "default");
    env.K8S_APP_PREFIX = await askOptional("? K8s App Prefix", "op");
  }

  // --- 4. Optional: Features ---
  const webhook = await askOptionalUrl("? Alert Webhook URL (optional)");
  if (webhook) {
    env.ALERT_WEBHOOK_URL = webhook;
  }

  // Build .env.local
  const lines = [
    "# SentinAI Config",
    `L2_RPC_URL=${env.L2_RPC_URL}`,
    "",
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

  if (env.AWS_CLUSTER_NAME) {
    lines.push("");
    lines.push(`AWS_CLUSTER_NAME=${env.AWS_CLUSTER_NAME}`);
    lines.push(`K8S_NAMESPACE=${env.K8S_NAMESPACE}`);
    lines.push(`K8S_APP_PREFIX=${env.K8S_APP_PREFIX}`);
  }

  if (env.ALERT_WEBHOOK_URL) {
    lines.push(`ALERT_WEBHOOK_URL=${env.ALERT_WEBHOOK_URL}`);
  }

  lines.push("");
  lines.push("COST_TRACKING_ENABLED=true");
  lines.push("SCALING_SIMULATION_MODE=true");

  writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");

  console.log("  ✓ .env.local created");
  console.log("  Run: npm run dev");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error("Setup error:", err.message);
  rl.close();
  process.exit(1);
});
