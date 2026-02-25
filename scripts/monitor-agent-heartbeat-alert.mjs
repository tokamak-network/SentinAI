#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { tsConsole } from './console-with-timestamp.mjs';

const EXIT_STALE = 2;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

function loadEnvLocalIfPresent() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

function getWebhookUrl() {
  const override = process.env.AGENT_HEARTBEAT_ALERT_WEBHOOK_URL;
  if (override && override.trim().length > 0) return override.trim();

  const fallback = process.env.ALERT_WEBHOOK_URL;
  if (fallback && fallback.trim().length > 0) return fallback.trim();

  return null;
}

function maskWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const masked = [...parts.slice(0, -2), '***', '***'].join('/');
      return `${parsed.origin}/${masked}`;
    }
    return `${parsed.origin}/***`;
  } catch {
    return '<invalid-webhook-url>';
  }
}

function buildAlertText(detail) {
  const lines = [
    ':rotating_light: SentinAI agent heartbeat stale',
    `host: ${process.env.HOSTNAME || os.hostname()}`,
    `time: ${new Date().toISOString()}`,
    `detail: ${detail || 'heartbeat check returned stale status'}`,
  ];
  return lines.join('\n');
}

async function sendWebhookAlert(webhookUrl, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`webhook responded ${response.status}: ${body || 'empty response body'}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function runHeartbeatCheck() {
  const checkScriptPath = path.resolve(process.cwd(), 'scripts/check-agent-heartbeat.mjs');
  return spawnSync(process.execPath, [checkScriptPath], {
    encoding: 'utf8',
    env: process.env,
  });
}

async function main() {
  loadEnvLocalIfPresent();

  const result = runHeartbeatCheck();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const status = Number.isInteger(result.status) ? result.status : 1;
  if (status !== EXIT_STALE) {
    process.exit(status);
  }

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    tsConsole.error('[agent-heartbeat-alert] ALERT_WEBHOOK_URL is not configured; skipped notification.');
    process.exit(status);
  }

  const detail = (result.stderr || result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-1)[0];

  const text = buildAlertText(detail);

  try {
    await sendWebhookAlert(webhookUrl, text);
    tsConsole.log(`[agent-heartbeat-alert] Notification sent via ${maskWebhookUrl(webhookUrl)}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tsConsole.error(`[agent-heartbeat-alert] Failed to send notification: ${message}`);
  }

  process.exit(status);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  tsConsole.error(`[agent-heartbeat-alert] Unexpected failure: ${message}`);
  process.exit(1);
});
