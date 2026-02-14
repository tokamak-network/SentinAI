#!/usr/bin/env node

/**
 * SentinAI Setup Wizard v2
 * Step-by-step interactive CLI wizard with real-time validation.
 * Zero external dependencies — pure Node.js.
 *
 * Usage: npm run setup
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, '.env.local');

// ============================================================
// Terminal Colors
// ============================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const ok = (msg) => `${c.green}✓${c.reset} ${msg}`;
const fail = (msg) => `${c.red}✗${c.reset} ${msg}`;
const skip = (msg) => `${c.yellow}○${c.reset} ${msg}`;
const info = (msg) => `${c.cyan}ℹ${c.reset} ${msg}`;
const heading = (msg) => `\n${c.bold}${c.cyan}${msg}${c.reset}`;

// ============================================================
// Readline
// ============================================================

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise((res) => rl.question(prompt, (a) => res(a.trim())));
}

async function askRequired(prompt, validate) {
  while (true) {
    const answer = await ask(prompt);
    if (!answer) { console.log(`  ${c.red}This field is required.${c.reset}`); continue; }
    if (validate) {
      const err = validate(answer);
      if (err) { console.log(`  ${c.red}${err}${c.reset}`); continue; }
    }
    return answer;
  }
}

async function askOptional(prompt, defaultVal) {
  const suffix = defaultVal ? ` ${c.dim}[${defaultVal}]${c.reset}` : '';
  const answer = await ask(`${prompt}${suffix}: `);
  return answer || defaultVal || '';
}

async function askYesNo(prompt, defaultNo = true) {
  const suffix = defaultNo ? ` ${c.dim}(y/N)${c.reset}` : ` ${c.dim}(Y/n)${c.reset}`;
  const answer = (await ask(`${prompt}${suffix}: `)).toLowerCase();
  if (!answer) return !defaultNo;
  return answer === 'y' || answer === 'yes';
}

async function askChoice(prompt, options) {
  console.log(`\n  ${prompt}`);
  options.forEach((opt, i) => console.log(`  ${c.cyan}${i + 1}.${c.reset} ${opt.label}`));
  console.log('');
  while (true) {
    const answer = await ask(`  ▸ Choice (1-${options.length}): `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    console.log(`  ${c.red}Enter a number between 1 and ${options.length}${c.reset}`);
  }
}

function maskSecret(value) {
  if (!value || value.length < 8) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

// ============================================================
// HTTP Helpers
// ============================================================

function httpPost(url, body, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: timeoutMs,
    };
    const req = reqFn(opts, (res) => {
      let buf = '';
      res.on('data', (chunk) => (buf += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ============================================================
// Validators
// ============================================================

function validateUrl(v) {
  if (!/^https?:\/\/.+/.test(v)) return 'Must start with http:// or https://';
  return null;
}

function validateApiKey(v) {
  if (v.length < 10) return 'API key seems too short';
  return null;
}

function validateEthAddress(v) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return 'Must be a valid Ethereum address (0x + 40 hex chars)';
  return null;
}

// ============================================================
// Live Validation Functions
// ============================================================

async function testRpcConnection(url) {
  try {
    const start = Date.now();
    const res = await httpPost(url, { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 });
    const latency = Date.now() - start;
    if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` };
    const json = JSON.parse(res.body);
    if (json.error) return { ok: false, error: json.error.message };
    const chainId = parseInt(json.result, 16);

    // Get block number
    const res2 = await httpPost(url, { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 2 });
    const json2 = JSON.parse(res2.body);
    const blockNumber = parseInt(json2.result, 16);

    return { ok: true, chainId, blockNumber, latency };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testAnthropicKey(apiKey, gatewayUrl) {
  try {
    const baseUrl = gatewayUrl || 'https://api.anthropic.com';
    const res = await httpPost(
      `${baseUrl}/v1/messages`,
      { model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    );
    return { ok: res.status === 200, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testOpenAIKey(apiKey, gatewayUrl) {
  try {
    const baseUrl = gatewayUrl || 'https://api.openai.com';
    const res = await httpPost(
      `${baseUrl}/v1/chat/completions`,
      { model: 'gpt-4.1-mini', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
      { Authorization: `Bearer ${apiKey}` }
    );
    return { ok: res.status === 200, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testGeminiKey(apiKey) {
  try {
    const res = await httpPost(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: 'hi' }] }] }
    );
    return { ok: res.status === 200, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testQwenKey(apiKey) {
  try {
    const res = await httpPost(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      { model: 'qwen-turbo-latest', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
      { Authorization: `Bearer ${apiKey}` }
    );
    return { ok: res.status === 200, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testK8sCluster(clusterName) {
  try {
    const output = execFileSync('aws', ['eks', 'describe-cluster', '--name', clusterName, '--output', 'json'], {
      encoding: 'utf-8',
      timeout: 15000,
    });
    const data = JSON.parse(output);
    const cluster = data.cluster;
    return {
      ok: true,
      region: cluster.arn.split(':')[3],
      endpoint: cluster.endpoint,
      status: cluster.status,
    };
  } catch (e) {
    return { ok: false, error: e.stderr?.trim() || e.message };
  }
}

async function testWebhook(url) {
  try {
    const res = await httpPost(url, {
      text: '🧪 SentinAI Setup Wizard — test alert. If you see this, webhook is working!',
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// Env File Helpers
// ============================================================

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

function generateEnvFile(config) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [
    '# ==========================================',
    '# SentinAI Configuration',
    `# Generated by setup wizard on ${date}`,
    '# Docs: docs/guide/ENV_GUIDE.md',
    '# ==========================================',
    '',
  ];

  const section = (title) => { lines.push(`# === ${title} ===`); };
  const val = (key, value) => { if (value) lines.push(`${key}=${value}`); };
  const comment = (text) => { lines.push(`# ${text}`); };
  const blank = () => { lines.push(''); };

  // Required
  section('Required');
  val('L2_RPC_URL', config.L2_RPC_URL);
  blank();

  // AI Provider
  section('AI Provider');
  if (config.AI_PROVIDER === 'anthropic') val('ANTHROPIC_API_KEY', config.ANTHROPIC_API_KEY);
  else if (config.AI_PROVIDER === 'openai') val('OPENAI_API_KEY', config.OPENAI_API_KEY);
  else if (config.AI_PROVIDER === 'gemini') val('GEMINI_API_KEY', config.GEMINI_API_KEY);
  else if (config.AI_PROVIDER === 'qwen') val('QWEN_API_KEY', config.QWEN_API_KEY);
  if (config.AI_GATEWAY_URL) val('AI_GATEWAY_URL', config.AI_GATEWAY_URL);
  blank();

  // K8s
  section('K8s Monitoring');
  if (config.AWS_CLUSTER_NAME) {
    val('AWS_CLUSTER_NAME', config.AWS_CLUSTER_NAME);
    if (config.K8S_NAMESPACE && config.K8S_NAMESPACE !== 'default') val('K8S_NAMESPACE', config.K8S_NAMESPACE);
    if (config.K8S_APP_PREFIX && config.K8S_APP_PREFIX !== 'op') val('K8S_APP_PREFIX', config.K8S_APP_PREFIX);
    if (config.AWS_REGION) val('AWS_REGION', config.AWS_REGION);
  } else {
    comment('Not configured. Run `npm run setup` to add.');
  }
  blank();

  // L1 RPC
  section('L1 RPC (Spare URLs for 429 Failover)');
  if (config.L1_RPC_URLS) {
    val('L1_RPC_URLS', config.L1_RPC_URLS);
  } else {
    comment('Using default (publicnode.com). Run `npm run setup` to customize.');
  }
  blank();

  // L1 Proxyd
  if (config.L1_PROXYD_ENABLED) {
    section('L1 Proxyd');
    val('L1_PROXYD_ENABLED', 'true');
    if (config.L1_PROXYD_CONFIGMAP_NAME) val('L1_PROXYD_CONFIGMAP_NAME', config.L1_PROXYD_CONFIGMAP_NAME);
    if (config.L1_PROXYD_DATA_KEY) val('L1_PROXYD_DATA_KEY', config.L1_PROXYD_DATA_KEY);
    if (config.L1_PROXYD_UPSTREAM_GROUP) val('L1_PROXYD_UPSTREAM_GROUP', config.L1_PROXYD_UPSTREAM_GROUP);
    blank();
  }

  // EOA
  section('EOA Balance Monitoring');
  if (config.BATCHER_EOA_ADDRESS || config.BATCHER_PRIVATE_KEY || config.PROPOSER_EOA_ADDRESS || config.PROPOSER_PRIVATE_KEY) {
    if (config.BATCHER_EOA_ADDRESS) val('BATCHER_EOA_ADDRESS', config.BATCHER_EOA_ADDRESS);
    if (config.PROPOSER_EOA_ADDRESS) val('PROPOSER_EOA_ADDRESS', config.PROPOSER_EOA_ADDRESS);
    if (config.BATCHER_PRIVATE_KEY) val('BATCHER_PRIVATE_KEY', config.BATCHER_PRIVATE_KEY);
    if (config.PROPOSER_PRIVATE_KEY) val('PROPOSER_PRIVATE_KEY', config.PROPOSER_PRIVATE_KEY);
    if (config.TREASURY_PRIVATE_KEY) val('TREASURY_PRIVATE_KEY', config.TREASURY_PRIVATE_KEY);
    if (config.EOA_BALANCE_WARNING_ETH) val('EOA_BALANCE_WARNING_ETH', config.EOA_BALANCE_WARNING_ETH);
    if (config.EOA_BALANCE_CRITICAL_ETH) val('EOA_BALANCE_CRITICAL_ETH', config.EOA_BALANCE_CRITICAL_ETH);
  } else {
    comment('Not configured. Run `npm run setup` to add.');
  }
  blank();

  // Alerts
  section('Alerts');
  if (config.ALERT_WEBHOOK_URL) {
    val('ALERT_WEBHOOK_URL', config.ALERT_WEBHOOK_URL);
  } else {
    comment('Not configured. Run `npm run setup` to add.');
  }
  blank();

  // Advanced
  if (config.REDIS_URL || config.CLOUDFLARE_TUNNEL_TOKEN || config._hasAdvanced) {
    section('Advanced');
    if (config.REDIS_URL) val('REDIS_URL', config.REDIS_URL);
    if (config.COST_TRACKING_ENABLED === 'false') val('COST_TRACKING_ENABLED', 'false');
    if (config.AGENT_LOOP_ENABLED === 'false') val('AGENT_LOOP_ENABLED', 'false');
    if (config.AUTO_REMEDIATION_ENABLED === 'true') val('AUTO_REMEDIATION_ENABLED', 'true');
    if (config.ANOMALY_DETECTION_ENABLED === 'false') val('ANOMALY_DETECTION_ENABLED', 'false');
    if (config.SCALING_SIMULATION_MODE) val('SCALING_SIMULATION_MODE', config.SCALING_SIMULATION_MODE);
    if (config.CLOUDFLARE_TUNNEL_TOKEN) val('CLOUDFLARE_TUNNEL_TOKEN', config.CLOUDFLARE_TUNNEL_TOKEN);
    blank();
  }

  // Preserve unknown vars from existing .env.local
  if (config._preservedLines && config._preservedLines.length > 0) {
    section('Preserved (from previous config)');
    config._preservedLines.forEach((l) => lines.push(l));
    blank();
  }

  return lines.join('\n') + '\n';
}

// Known wizard keys
const WIZARD_KEYS = new Set([
  'L2_RPC_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'QWEN_API_KEY',
  'AI_GATEWAY_URL', 'AWS_CLUSTER_NAME', 'K8S_NAMESPACE', 'K8S_APP_PREFIX', 'AWS_REGION',
  'L1_RPC_URLS', 'L1_RPC_URL', 'L1_PROXYD_ENABLED', 'L1_PROXYD_CONFIGMAP_NAME',
  'L1_PROXYD_DATA_KEY', 'L1_PROXYD_UPSTREAM_GROUP', 'L1_PROXYD_UPDATE_MODE', 'L1_PROXYD_SPARE_URLS',
  'BATCHER_EOA_ADDRESS', 'PROPOSER_EOA_ADDRESS', 'BATCHER_PRIVATE_KEY', 'PROPOSER_PRIVATE_KEY',
  'TREASURY_PRIVATE_KEY', 'EOA_BALANCE_WARNING_ETH', 'EOA_BALANCE_CRITICAL_ETH',
  'ALERT_WEBHOOK_URL', 'REDIS_URL', 'COST_TRACKING_ENABLED', 'AGENT_LOOP_ENABLED',
  'AUTO_REMEDIATION_ENABLED', 'ANOMALY_DETECTION_ENABLED', 'SCALING_SIMULATION_MODE',
  'CLOUDFLARE_TUNNEL_TOKEN',
]);

function getPreservedLines(envPath) {
  if (!existsSync(envPath)) return [];
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  const preserved = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!WIZARD_KEYS.has(key)) {
      preserved.push(trimmed);
    }
  }
  return preserved;
}

// ============================================================
// Wizard Steps
// ============================================================

async function stepL2Rpc(config) {
  console.log(heading('Step 1/7: L2 Chain RPC (Required)'));
  console.log('  The RPC endpoint for your Optimism-based L2 network.\n');

  const url = await askRequired('  ▸ L2_RPC_URL: ', validateUrl);
  process.stdout.write(`  Testing connection... `);
  const result = await testRpcConnection(url);
  if (result.ok) {
    console.log(ok(`Chain ID: ${result.chainId}, Block: #${result.blockNumber.toLocaleString()}, ${result.latency}ms`));
  } else {
    console.log(fail(`${result.error}`));
    console.log(info('Continuing anyway — you can fix this later.'));
  }
  config.L2_RPC_URL = url;
}

async function stepAIProvider(config) {
  console.log(heading('Step 2/7: AI Provider (Required for AI Features)'));

  const provider = await askChoice('Pick an AI provider:', [
    { label: `${c.bold}Anthropic${c.reset} (Claude) — recommended`, value: 'anthropic' },
    { label: 'OpenAI (GPT)', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'Qwen (DashScope)', value: 'qwen' },
    { label: `${c.dim}Skip — no AI features${c.reset}`, value: 'skip' },
  ]);

  if (provider === 'skip') {
    console.log(skip('AI provider skipped. AI analysis features will be disabled.'));
    return;
  }

  config.AI_PROVIDER = provider;

  const keyPrompt = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    qwen: 'QWEN_API_KEY',
  }[provider];

  const apiKey = await askRequired(`  ▸ ${keyPrompt}: `, validateApiKey);
  config[keyPrompt] = apiKey;

  // Test API key
  process.stdout.write('  Testing API key... ');
  const testFn = { anthropic: testAnthropicKey, openai: testOpenAIKey, gemini: testGeminiKey, qwen: testQwenKey }[provider];
  const result = await testFn(apiKey);
  if (result.ok) {
    console.log(ok(`${provider} API key valid`));
  } else {
    console.log(fail(`HTTP ${result.status || result.error}`));
    console.log(info('Continuing anyway — check the key and try again later.'));
  }

  // AI Gateway
  const useGateway = await askYesNo('\n  Route requests through an AI gateway/proxy?');
  if (useGateway) {
    const gwUrl = await askRequired('  ▸ AI_GATEWAY_URL: ', validateUrl);
    config.AI_GATEWAY_URL = gwUrl;

    // Re-test through gateway
    if (provider === 'anthropic' || provider === 'openai') {
      process.stdout.write('  Testing via gateway... ');
      const gwResult = provider === 'anthropic'
        ? await testAnthropicKey(apiKey, gwUrl)
        : await testOpenAIKey(apiKey, gwUrl);
      if (gwResult.ok) console.log(ok('Gateway reachable'));
      else console.log(fail(`${gwResult.error || `HTTP ${gwResult.status}`}`));
    }
  }
}

async function stepK8s(config) {
  console.log(heading('Step 3/7: K8s Monitoring (Optional)'));

  const enable = await askYesNo('  Do you have an AWS EKS cluster to monitor?');
  if (!enable) {
    console.log(skip('K8s monitoring skipped.'));
    return;
  }

  const clusterName = await askRequired('  ▸ AWS_CLUSTER_NAME: ');
  config.AWS_CLUSTER_NAME = clusterName;

  process.stdout.write('  Validating cluster... ');
  const result = await testK8sCluster(clusterName);
  if (result.ok) {
    console.log(ok(`Region: ${result.region}, Status: ${result.status}`));
    config.AWS_REGION = result.region;
  } else {
    console.log(fail(result.error));
    console.log(info('Continuing — make sure AWS credentials are configured.'));
  }

  const ns = await askOptional('  ▸ K8S_NAMESPACE', 'default');
  if (ns !== 'default') config.K8S_NAMESPACE = ns;

  const prefix = await askOptional('  ▸ K8S_APP_PREFIX', 'op');
  if (prefix !== 'op') config.K8S_APP_PREFIX = prefix;
}

async function stepL1Rpc(config) {
  console.log(heading('Step 4/7: L1 RPC & Proxyd (Optional)'));
  console.log('  Spare L1 RPC endpoints used when L2 nodes hit 429 errors 10x consecutively.');
  console.log(`  ${c.dim}Default: publicnode.com fallback (no config needed)${c.reset}\n`);

  const enable = await askYesNo('  Configure spare L1 RPC endpoints?');
  if (!enable) {
    console.log(skip('Using default public endpoints.'));

    const enableProxyd = await askYesNo('\n  Enable L1 Proxyd integration?');
    if (enableProxyd) await configureProxyd(config);
    return;
  }

  const urls = await askRequired('  ▸ L1_RPC_URLS (comma-separated): ', (v) => {
    const parts = v.split(',').map((u) => u.trim()).filter(Boolean);
    if (parts.length === 0) return 'Enter at least one URL';
    for (const u of parts) { if (validateUrl(u)) return `Invalid URL: ${u}`; }
    return null;
  });
  config.L1_RPC_URLS = urls;

  // Test each endpoint
  const urlList = urls.split(',').map((u) => u.trim()).filter(Boolean);
  for (const url of urlList) {
    process.stdout.write(`  Testing ${url.slice(0, 50)}... `);
    const result = await testRpcConnection(url);
    if (result.ok) console.log(ok(`Block #${result.blockNumber.toLocaleString()}, ${result.latency}ms`));
    else console.log(fail(result.error));
  }

  const enableProxyd = await askYesNo('\n  Enable L1 Proxyd integration?');
  if (enableProxyd) await configureProxyd(config);
}

async function configureProxyd(config) {
  config.L1_PROXYD_ENABLED = true;
  const cmName = await askOptional('  ▸ L1_PROXYD_CONFIGMAP_NAME', 'proxyd-config');
  if (cmName !== 'proxyd-config') config.L1_PROXYD_CONFIGMAP_NAME = cmName;
  const dataKey = await askOptional('  ▸ L1_PROXYD_DATA_KEY', 'proxyd.toml');
  if (dataKey !== 'proxyd.toml') config.L1_PROXYD_DATA_KEY = dataKey;
  const group = await askOptional('  ▸ L1_PROXYD_UPSTREAM_GROUP', 'main');
  if (group !== 'main') config.L1_PROXYD_UPSTREAM_GROUP = group;
  console.log(ok('Proxyd integration configured.'));
}

async function stepEOA(config) {
  console.log(heading('Step 5/7: EOA Balance Monitoring (Optional)'));
  console.log('  Monitor batcher/proposer L1 ETH balances. Auto-refill when low.\n');

  const enable = await askYesNo('  Monitor EOA balances?');
  if (!enable) {
    console.log(skip('EOA monitoring skipped.'));
    return;
  }

  const method = await askChoice('How to identify EOA addresses?', [
    { label: 'Enter addresses directly', value: 'address' },
    { label: 'Derive from private keys', value: 'privkey' },
    { label: 'Auto-detect from L1 transactions', value: 'auto' },
  ]);

  if (method === 'address') {
    const batcher = await askOptional('  ▸ BATCHER_EOA_ADDRESS (0x...)', '');
    if (batcher) { const err = validateEthAddress(batcher); if (err) console.log(`  ${c.red}${err}${c.reset}`); else config.BATCHER_EOA_ADDRESS = batcher; }
    const proposer = await askOptional('  ▸ PROPOSER_EOA_ADDRESS (0x...)', '');
    if (proposer) { const err = validateEthAddress(proposer); if (err) console.log(`  ${c.red}${err}${c.reset}`); else config.PROPOSER_EOA_ADDRESS = proposer; }
  } else if (method === 'privkey') {
    const batcherKey = await askOptional('  ▸ BATCHER_PRIVATE_KEY (0x...)', '');
    if (batcherKey) config.BATCHER_PRIVATE_KEY = batcherKey;
    const proposerKey = await askOptional('  ▸ PROPOSER_PRIVATE_KEY (0x...)', '');
    if (proposerKey) config.PROPOSER_PRIVATE_KEY = proposerKey;
  } else {
    console.log(info('Will auto-detect EOA addresses from L1 transaction analysis at runtime.'));
  }

  // Thresholds
  const warning = await askOptional('  ▸ Warning threshold (ETH)', '0.5');
  if (warning !== '0.5') config.EOA_BALANCE_WARNING_ETH = warning;
  const critical = await askOptional('  ▸ Critical threshold (ETH)', '0.1');
  if (critical !== '0.1') config.EOA_BALANCE_CRITICAL_ETH = critical;

  // Treasury
  const enableRefill = await askYesNo('\n  Enable auto-refill from treasury wallet?');
  if (enableRefill) {
    const treasuryKey = await askRequired('  ▸ TREASURY_PRIVATE_KEY (0x...): ');
    config.TREASURY_PRIVATE_KEY = treasuryKey;
    console.log(ok('Auto-refill enabled. Defaults: 1.0 ETH per refill, 5.0 ETH daily cap.'));
    console.log(info('Fine-tune in docs/guide/ENV_GUIDE.md → Section 5.'));
  }
}

async function stepAlerts(config) {
  console.log(heading('Step 6/7: Alerts (Optional)'));

  const enable = await askYesNo('  Set up webhook alerts for anomaly detection?');
  if (!enable) {
    console.log(skip('Alerts skipped.'));
    return;
  }

  const url = await askRequired('  ▸ ALERT_WEBHOOK_URL: ', validateUrl);
  config.ALERT_WEBHOOK_URL = url;

  const sendTest = await askYesNo('  Send a test alert?');
  if (sendTest) {
    process.stdout.write('  Sending test... ');
    const result = await testWebhook(url);
    if (result.ok) console.log(ok('Test alert sent!'));
    else console.log(fail(`HTTP ${result.status || result.error}`));
  }
}

async function stepSummaryAndWrite(config) {
  console.log(heading('Step 7/7: Summary'));

  // Advanced settings option
  const advanced = await askYesNo('\n  Configure advanced settings? (Redis, Cost Tracking, etc.)');
  if (advanced) {
    config._hasAdvanced = true;
    const redis = await askOptional('  ▸ REDIS_URL', '');
    if (redis) config.REDIS_URL = redis;

    const costTracking = await askYesNo('  Enable cost tracking?', false);
    if (!costTracking) config.COST_TRACKING_ENABLED = 'false';

    const autoRemediation = await askYesNo('  Enable auto-remediation?');
    if (autoRemediation) config.AUTO_REMEDIATION_ENABLED = 'true';

    const cf = await askOptional('  ▸ CLOUDFLARE_TUNNEL_TOKEN', '');
    if (cf) config.CLOUDFLARE_TUNNEL_TOKEN = cf;
  }

  // Display summary
  console.log(heading('Configuration Summary'));
  console.log('');

  const show = (label, value, mask = false) => {
    if (!value) return;
    const display = mask ? maskSecret(value) : value;
    console.log(`  ${c.dim}${label.padEnd(28)}${c.reset} ${display}`);
  };

  show('L2_RPC_URL', config.L2_RPC_URL);
  show('AI Provider', config.AI_PROVIDER);
  if (config.ANTHROPIC_API_KEY) show('ANTHROPIC_API_KEY', config.ANTHROPIC_API_KEY, true);
  if (config.OPENAI_API_KEY) show('OPENAI_API_KEY', config.OPENAI_API_KEY, true);
  if (config.GEMINI_API_KEY) show('GEMINI_API_KEY', config.GEMINI_API_KEY, true);
  if (config.QWEN_API_KEY) show('QWEN_API_KEY', config.QWEN_API_KEY, true);
  if (config.AI_GATEWAY_URL) show('AI_GATEWAY_URL', config.AI_GATEWAY_URL);
  if (config.AWS_CLUSTER_NAME) {
    show('AWS_CLUSTER_NAME', config.AWS_CLUSTER_NAME);
    show('AWS_REGION', config.AWS_REGION || 'auto-detected');
    show('K8S_NAMESPACE', config.K8S_NAMESPACE || 'default');
    show('K8S_APP_PREFIX', config.K8S_APP_PREFIX || 'op');
  }
  if (config.L1_RPC_URLS) show('L1_RPC_URLS', config.L1_RPC_URLS);
  if (config.L1_PROXYD_ENABLED) show('L1_PROXYD_ENABLED', 'true');
  if (config.BATCHER_EOA_ADDRESS) show('BATCHER_EOA_ADDRESS', config.BATCHER_EOA_ADDRESS);
  if (config.PROPOSER_EOA_ADDRESS) show('PROPOSER_EOA_ADDRESS', config.PROPOSER_EOA_ADDRESS);
  if (config.TREASURY_PRIVATE_KEY) show('TREASURY_PRIVATE_KEY', config.TREASURY_PRIVATE_KEY, true);
  if (config.ALERT_WEBHOOK_URL) show('ALERT_WEBHOOK_URL', config.ALERT_WEBHOOK_URL);
  if (config.REDIS_URL) show('REDIS_URL', config.REDIS_URL);

  console.log('');

  // Confirm and write
  const confirm = await askYesNo('  Write to .env.local?', false);
  if (!confirm) {
    console.log(`\n  ${c.yellow}Cancelled.${c.reset} No changes made.\n`);
    return false;
  }

  // Backup existing
  if (existsSync(ENV_PATH)) {
    const backupPath = `${ENV_PATH}.backup.${Date.now()}`;
    copyFileSync(ENV_PATH, backupPath);
    console.log(info(`Backed up existing config → ${backupPath}`));
  }

  // Preserve unknown vars
  config._preservedLines = getPreservedLines(ENV_PATH);

  const content = generateEnvFile(config);
  writeFileSync(ENV_PATH, content, 'utf-8');
  console.log(ok(`.env.local written successfully!`));
  console.log(`\n  Run ${c.cyan}npm run dev${c.reset} to start SentinAI.\n`);
  return true;
}

// ============================================================
// Validate Mode
// ============================================================

async function validateMode() {
  console.log(heading('Validating .env.local'));

  if (!existsSync(ENV_PATH)) {
    console.log(fail('.env.local not found. Run setup to create one.'));
    return;
  }

  const env = parseEnvFile(ENV_PATH);
  console.log('');

  // L2 RPC
  if (env.L2_RPC_URL) {
    process.stdout.write('  L2_RPC_URL'.padEnd(30));
    const r = await testRpcConnection(env.L2_RPC_URL);
    if (r.ok) console.log(ok(`Chain ${r.chainId}, Block #${r.blockNumber.toLocaleString()}, ${r.latency}ms`));
    else console.log(fail(r.error));
  } else {
    console.log(fail('L2_RPC_URL'.padEnd(28) + 'not set (required)'));
  }

  // AI Provider
  const aiProviders = [
    { key: 'ANTHROPIC_API_KEY', test: (k) => testAnthropicKey(k, env.AI_GATEWAY_URL), name: 'Anthropic' },
    { key: 'OPENAI_API_KEY', test: (k) => testOpenAIKey(k, env.AI_GATEWAY_URL), name: 'OpenAI' },
    { key: 'GEMINI_API_KEY', test: testGeminiKey, name: 'Gemini' },
    { key: 'QWEN_API_KEY', test: testQwenKey, name: 'Qwen' },
  ];
  let aiFound = false;
  for (const { key, test, name } of aiProviders) {
    if (env[key]) {
      aiFound = true;
      process.stdout.write(`  ${key}`.padEnd(30));
      const r = await test(env[key]);
      if (r.ok) console.log(ok(`${name} valid`));
      else console.log(fail(`HTTP ${r.status || r.error}`));
    }
  }
  if (!aiFound) console.log(skip('AI Provider'.padEnd(28) + 'not configured (optional)'));

  if (env.AI_GATEWAY_URL) {
    console.log(info(`AI_GATEWAY_URL`.padEnd(28) + env.AI_GATEWAY_URL));
  }

  // K8s
  if (env.AWS_CLUSTER_NAME) {
    process.stdout.write('  AWS_CLUSTER_NAME'.padEnd(30));
    const r = await testK8sCluster(env.AWS_CLUSTER_NAME);
    if (r.ok) console.log(ok(`${r.region}, ${r.status}`));
    else console.log(fail(r.error));
  } else {
    console.log(skip('K8s'.padEnd(28) + 'not configured (optional)'));
  }

  // L1 RPC
  if (env.L1_RPC_URLS) {
    const urls = env.L1_RPC_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    for (const url of urls) {
      process.stdout.write(`  L1 ${url.slice(0, 40)}`.padEnd(30));
      const r = await testRpcConnection(url);
      if (r.ok) console.log(ok(`${r.latency}ms`));
      else console.log(fail(r.error));
    }
  } else {
    console.log(skip('L1_RPC_URLS'.padEnd(28) + 'not configured (using publicnode.com)'));
  }

  // EOA
  if (env.BATCHER_EOA_ADDRESS || env.PROPOSER_EOA_ADDRESS) {
    if (env.BATCHER_EOA_ADDRESS) console.log(ok('BATCHER_EOA_ADDRESS'.padEnd(28) + env.BATCHER_EOA_ADDRESS));
    if (env.PROPOSER_EOA_ADDRESS) console.log(ok('PROPOSER_EOA_ADDRESS'.padEnd(28) + env.PROPOSER_EOA_ADDRESS));
  } else {
    console.log(skip('EOA addresses'.padEnd(28) + 'not configured (optional)'));
  }

  // Alerts
  if (env.ALERT_WEBHOOK_URL) {
    process.stdout.write('  ALERT_WEBHOOK_URL'.padEnd(30));
    const r = await testWebhook(env.ALERT_WEBHOOK_URL);
    if (r.ok) console.log(ok('reachable'));
    else console.log(fail(`HTTP ${r.status || r.error}`));
  } else {
    console.log(skip('ALERT_WEBHOOK_URL'.padEnd(28) + 'not configured (optional)'));
  }

  console.log('');
}

// ============================================================
// Modify Mode
// ============================================================

async function modifyMode() {
  const env = parseEnvFile(ENV_PATH);
  const config = { ...env };

  const section = await askChoice('What would you like to configure?', [
    { label: 'L2 RPC', value: 'l2' },
    { label: 'AI Provider', value: 'ai' },
    { label: 'K8s Monitoring', value: 'k8s' },
    { label: 'L1 RPC & Proxyd', value: 'l1' },
    { label: 'EOA Monitoring', value: 'eoa' },
    { label: 'Alerts', value: 'alerts' },
    { label: 'Advanced (Redis, Cost Tracking, etc.)', value: 'advanced' },
  ]);

  const stepMap = {
    l2: stepL2Rpc,
    ai: stepAIProvider,
    k8s: stepK8s,
    l1: stepL1Rpc,
    eoa: stepEOA,
    alerts: stepAlerts,
    advanced: async (cfg) => {
      cfg._hasAdvanced = true;
      const redis = await askOptional('  ▸ REDIS_URL', cfg.REDIS_URL || '');
      if (redis) cfg.REDIS_URL = redis;
      const costTracking = await askYesNo('  Enable cost tracking?', false);
      if (!costTracking) cfg.COST_TRACKING_ENABLED = 'false';
      const autoRemediation = await askYesNo('  Enable auto-remediation?');
      if (autoRemediation) cfg.AUTO_REMEDIATION_ENABLED = 'true';
      const cf = await askOptional('  ▸ CLOUDFLARE_TUNNEL_TOKEN', cfg.CLOUDFLARE_TUNNEL_TOKEN || '');
      if (cf) cfg.CLOUDFLARE_TUNNEL_TOKEN = cf;
    },
  };

  await stepMap[section](config);
  await stepSummaryAndWrite(config);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('');
  console.log(`${c.bold}${c.cyan}  ╔════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ║   SentinAI Setup Wizard v2    ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ╚════════════════════════════════╝${c.reset}`);
  console.log('');

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(`\n\n  ${c.yellow}Setup cancelled. No changes made.${c.reset}\n`);
    process.exit(0);
  });

  if (existsSync(ENV_PATH)) {
    console.log(info(`.env.local found at ${ENV_PATH}`));
    const mode = await askChoice('What would you like to do?', [
      { label: 'Reconfigure from scratch', value: 'fresh' },
      { label: 'Modify specific section', value: 'modify' },
      { label: 'Validate current config', value: 'validate' },
    ]);

    if (mode === 'validate') {
      await validateMode();
      rl.close();
      return;
    }
    if (mode === 'modify') {
      await modifyMode();
      rl.close();
      return;
    }
    // fresh — fall through
  }

  // Fresh setup
  const config = {};

  await stepL2Rpc(config);
  await stepAIProvider(config);
  await stepK8s(config);
  await stepL1Rpc(config);
  await stepEOA(config);
  await stepAlerts(config);
  await stepSummaryAndWrite(config);

  rl.close();
}

main().catch((err) => {
  console.error(`\n${c.red}Error: ${err.message}${c.reset}\n`);
  process.exit(1);
});
