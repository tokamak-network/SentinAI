#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Redis from 'ioredis';

const DEFAULT_STALE_SECONDS = 120;
const DEFAULT_KEY_PREFIX = 'sentinai:';
const EXIT_OK = 0;
const EXIT_STALE = 2;
const EXIT_CONFIG_ERROR = 3;

function normalizePrefix(prefix) {
  if (!prefix) return DEFAULT_KEY_PREFIX;
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

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

function fail(message, code = EXIT_STALE) {
  console.error(`[agent-heartbeat] CRITICAL: ${message}`);
  process.exit(code);
}

function ok(message) {
  console.log(`[agent-heartbeat] OK: ${message}`);
  process.exit(EXIT_OK);
}

async function main() {
  loadEnvLocalIfPresent();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    fail('REDIS_URL is not configured. Set REDIS_URL or provide .env.local.', EXIT_CONFIG_ERROR);
  }

  const staleThresholdSeconds = parsePositiveInt(
    process.env.AGENT_HEARTBEAT_STALE_SECONDS,
    DEFAULT_STALE_SECONDS
  );
  const keyPrefix = normalizePrefix(process.env.REDIS_KEY_PREFIX);
  const heartbeatKey = `${keyPrefix}agent:last_heartbeat`;

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const heartbeatAt = await redis.get(heartbeatKey);
    if (!heartbeatAt) {
      fail(`missing heartbeat key "${heartbeatKey}"`);
    }

    const heartbeatMs = new Date(heartbeatAt).getTime();
    if (!Number.isFinite(heartbeatMs)) {
      fail(`invalid heartbeat timestamp "${heartbeatAt}"`);
    }

    const lagSec = Math.max(0, Math.floor((Date.now() - heartbeatMs) / 1000));
    if (lagSec > staleThresholdSeconds) {
      fail(`heartbeat stale (${lagSec}s > ${staleThresholdSeconds}s) at ${heartbeatAt}`);
    }

    ok(`heartbeat fresh (${lagSec}s <= ${staleThresholdSeconds}s) at ${heartbeatAt}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`check failed: ${message}`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`unhandled failure: ${message}`);
});
