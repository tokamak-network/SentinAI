/**
 * Phase 4: Live RPC Detection Tests
 * Runs against a real EVM-compatible RPC endpoint (default: Anvil on 18545).
 *
 * Usage:
 *   npx tsx scripts/verify-client-profile-live.ts [--rpc-url <url>]
 *
 * Output lines (machine-parseable):
 *   PASS: <description>  [optional detail]
 *   FAIL: <description>  -- <reason>
 *   INFO: <message>
 *   SUMMARY: passed=N failed=M total=T
 */

import { detectExecutionClient } from '../src/lib/client-detector';
import { mapDetectedClientToCapabilities } from '../src/lib/capability-mapper';
import { resolveClientProfile, BUILTIN_PROFILES, buildClientProfileFromEnv } from '../src/lib/client-profile';

let passed = 0;
let failed = 0;

function pass(desc: string, detail = '') {
  passed++;
  console.log(`PASS: ${desc}${detail ? `  [${detail}]` : ''}`);
}

function fail(desc: string, reason: string) {
  failed++;
  console.log(`FAIL: ${desc}  -- ${reason}`);
}

function info(msg: string) {
  console.log(`INFO: ${msg}`);
}

const rpcArgIdx = process.argv.indexOf('--rpc-url');
const rpcUrl = rpcArgIdx !== -1 ? process.argv[rpcArgIdx + 1] : 'http://127.0.0.1:18545';

async function main() {
  info(`Target RPC: ${rpcUrl}`);

  // ─── Test 1: Basic execution client detection ─────────────
  info('Running detectExecutionClient...');
  const detected = await detectExecutionClient({ rpcUrl });
  info(`layer=${detected.layer} family=${detected.family} chainId=${detected.chainId} syncing=${detected.syncing} txpoolNamespace=${detected.txpoolNamespace} supportsL2SyncStatus=${detected.supportsL2SyncStatus}`);

  if (detected.layer === 'execution') {
    pass('layer = execution');
  } else {
    fail('layer = execution', `got '${detected.layer}'`);
  }

  if (detected.chainId !== undefined && detected.chainId !== null) {
    pass('chainId detected from eth_chainId probe', `chainId=${detected.chainId}`);
  } else {
    fail('chainId detected', 'chainId is undefined — eth_chainId probe failed');
  }

  if (typeof detected.syncing === 'boolean') {
    pass('eth_syncing probe responded', `syncing=${detected.syncing}`);
  } else {
    fail('eth_syncing probe responded', 'syncing is undefined — eth_syncing probe failed');
  }

  if (detected.supportsL2SyncStatus === false) {
    pass('supportsL2SyncStatus=false on standard node');
  } else {
    fail('supportsL2SyncStatus=false on standard node', `got ${detected.supportsL2SyncStatus}`);
  }

  if (detected.l2SyncMethod === null) {
    pass('l2SyncMethod=null on non-L2 node');
  } else {
    fail('l2SyncMethod=null', `got '${detected.l2SyncMethod}'`);
  }

  const probeCount = Object.keys(detected.probes).length;
  if (probeCount > 0) {
    pass('probes object populated', `${probeCount} probes: ${Object.keys(detected.probes).join(', ')}`);
  } else {
    fail('probes object populated', 'empty probes object');
  }

  // ─── Test 2: Capability mapping ────────────────────────────
  info('Mapping detected client to capabilities...');
  const mapped = mapDetectedClientToCapabilities(detected, 'ethereum-el');

  if (Array.isArray(mapped.capabilities) && mapped.capabilities.length > 0) {
    pass('capabilities mapped', mapped.capabilities.join(', '));
  } else {
    fail('capabilities mapped', 'empty capabilities array');
  }

  if (mapped.capabilities.includes('block-production')) {
    pass('block-production always included in capabilities');
  } else {
    fail('block-production always included', `capabilities=${mapped.capabilities.join(',')}`);
  }

  const validNs: Array<string | null> = [null, 'txpool', 'parity'];
  if (validNs.includes(mapped.txpoolNamespace)) {
    pass('txpoolNamespace is a valid value', `txpoolNamespace=${mapped.txpoolNamespace}`);
  } else {
    fail('txpoolNamespace is a valid value', `invalid: ${String(mapped.txpoolNamespace)}`);
  }

  // ─── Test 3: SENTINAI_CLIENT_FAMILY env var override ───────
  info('Testing SENTINAI_CLIENT_FAMILY env var override...');
  process.env.SENTINAI_CLIENT_FAMILY = 'nethermind';
  const overriddenProfile = resolveClientProfile();

  if (overriddenProfile.clientFamily === 'nethermind') {
    pass('SENTINAI_CLIENT_FAMILY=nethermind overrides auto-detection');
  } else {
    fail('SENTINAI_CLIENT_FAMILY=nethermind override', `got clientFamily='${overriddenProfile.clientFamily}'`);
  }

  if (overriddenProfile.methods.txPool?.method === 'parity_pendingTransactions') {
    pass('nethermind profile uses parity_pendingTransactions for txPool');
  } else {
    fail('nethermind txPool method', `got '${overriddenProfile.methods.txPool?.method}'`);
  }
  delete process.env.SENTINAI_CLIENT_FAMILY;

  // ─── Test 4: SENTINAI_OVERRIDE_* on top of detected profile
  info('Testing SENTINAI_OVERRIDE_* method overrides...');
  process.env.SENTINAI_OVERRIDE_L2_SYNC_METHOD = 'optimism_syncStatus';
  process.env.SENTINAI_CAPABILITY_L2_SYNC = 'true';

  const detectedFamily = detected.family !== 'unknown' ? detected.family : 'geth';
  const baseProfile = BUILTIN_PROFILES[detectedFamily] ?? BUILTIN_PROFILES['geth'];
  const withOverride = buildClientProfileFromEnv(baseProfile);

  if (withOverride.methods.l2SyncStatus?.method === 'optimism_syncStatus') {
    pass('SENTINAI_OVERRIDE_L2_SYNC_METHOD overrides l2SyncStatus.method');
  } else {
    fail('SENTINAI_OVERRIDE_L2_SYNC_METHOD', `got '${withOverride.methods.l2SyncStatus?.method}'`);
  }

  if (withOverride.capabilities.supportsL2SyncStatus === true) {
    pass('SENTINAI_CAPABILITY_L2_SYNC=true enables L2 sync capability');
  } else {
    fail('SENTINAI_CAPABILITY_L2_SYNC=true', `got ${withOverride.capabilities.supportsL2SyncStatus}`);
  }
  delete process.env.SENTINAI_OVERRIDE_L2_SYNC_METHOD;
  delete process.env.SENTINAI_CAPABILITY_L2_SYNC;

  // ─── Test 5: Immutability of built-in profiles ─────────────
  process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'custom_txpool';
  buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
  const originalTxPool = BUILTIN_PROFILES['geth'].methods.txPool?.method;

  if (originalTxPool === 'txpool_status') {
    pass('BUILTIN_PROFILES are not mutated by env overrides');
  } else {
    fail('BUILTIN_PROFILES immutability', `geth.methods.txPool.method was mutated to '${originalTxPool}'`);
  }
  delete process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD;

  // ─── Summary ───────────────────────────────────────────────
  console.log(`SUMMARY: passed=${passed} failed=${failed} total=${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
