import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  getClientFamilyFromEnv,
  buildClientProfileFromEnv,
  parseCustomMetricsFromEnv,
  parseTopologyFromEnv,
  parseK8sLabelsFromEnv,
} from '@/lib/client-profile';
import { BUILTIN_PROFILES } from '@/lib/client-profile';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── US-04: getClientFamilyFromEnv ──────────────────────────────────────────

describe('getClientFamilyFromEnv', () => {
  it('returns null when SENTINAI_CLIENT_FAMILY is not set', () => {
    expect(getClientFamilyFromEnv()).toBeNull();
  });

  it('returns the value when SENTINAI_CLIENT_FAMILY is set', () => {
    vi.stubEnv('SENTINAI_CLIENT_FAMILY', 'nethermind');
    expect(getClientFamilyFromEnv()).toBe('nethermind');
  });
});

// ─── US-04: buildClientProfileFromEnv ───────────────────────────────────────

describe('buildClientProfileFromEnv — method overrides', () => {
  it('overrides txPool.method via SENTINAI_OVERRIDE_TXPOOL_METHOD', () => {
    vi.stubEnv('SENTINAI_OVERRIDE_TXPOOL_METHOD', 'parity_pendingTransactions');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.methods.txPool?.method).toBe('parity_pendingTransactions');
  });

  it('overrides syncStatus.method via SENTINAI_OVERRIDE_SYNC_STATUS_METHOD', () => {
    vi.stubEnv('SENTINAI_OVERRIDE_SYNC_STATUS_METHOD', 'custom_syncing');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.methods.syncStatus.method).toBe('custom_syncing');
  });

  it('sets custom sync parser type with paths', () => {
    vi.stubEnv('SENTINAI_OVERRIDE_SYNC_STATUS_PARSER', 'custom');
    vi.stubEnv('SENTINAI_OVERRIDE_SYNC_CURRENT_BLOCK_PATH', 'result.current');
    vi.stubEnv('SENTINAI_OVERRIDE_SYNC_HIGHEST_BLOCK_PATH', 'result.highest');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.parsers.syncStatus.type).toBe('custom');
    expect(profile.parsers.syncStatus.currentBlockPath).toBe('result.current');
    expect(profile.parsers.syncStatus.highestBlockPath).toBe('result.highest');
  });

  it('sets l2SyncStatus method via SENTINAI_OVERRIDE_L2_SYNC_METHOD', () => {
    vi.stubEnv('SENTINAI_OVERRIDE_L2_SYNC_METHOD', 'my_l2_sync');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.methods.l2SyncStatus?.method).toBe('my_l2_sync');
  });

  it('does not mutate the base built-in profile', () => {
    vi.stubEnv('SENTINAI_OVERRIDE_TXPOOL_METHOD', 'parity_pendingTransactions');
    buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(BUILTIN_PROFILES['geth'].methods.txPool?.method).toBe('txpool_status');
  });
});

describe('buildClientProfileFromEnv — capability overrides', () => {
  it('SENTINAI_CAPABILITY_TXPOOL=false sets supportsTxPool=false', () => {
    vi.stubEnv('SENTINAI_CAPABILITY_TXPOOL', 'false');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.capabilities.supportsTxPool).toBe(false);
  });

  it('SENTINAI_CAPABILITY_L2_SYNC=true sets supportsL2SyncStatus=true', () => {
    vi.stubEnv('SENTINAI_CAPABILITY_L2_SYNC', 'true');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.capabilities.supportsL2SyncStatus).toBe(true);
  });

  it('SENTINAI_CAPABILITY_DEBUG_NAMESPACE=true sets supportsDebugNamespace=true', () => {
    vi.stubEnv('SENTINAI_CAPABILITY_DEBUG_NAMESPACE', 'true');
    const profile = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    expect(profile.capabilities.supportsDebugNamespace).toBe(true);
  });
});

describe('buildClientProfileFromEnv — no base profile', () => {
  it('creates a custom profile from scratch with env family', () => {
    vi.stubEnv('SENTINAI_CLIENT_FAMILY', 'mychain');
    vi.stubEnv('SENTINAI_OVERRIDE_TXPOOL_METHOD', 'mychain_txpool');
    const profile = buildClientProfileFromEnv();
    expect(profile.clientFamily).toBe('mychain');
    expect(profile.methods.txPool?.method).toBe('mychain_txpool');
  });
});

// ─── US-05: parseCustomMetricsFromEnv ───────────────────────────────────────

describe('parseCustomMetricsFromEnv', () => {
  it('returns [] when no SENTINAI_CUSTOM_METRIC env vars are set', () => {
    expect(parseCustomMetricsFromEnv()).toEqual([]);
  });

  it('parses 2 custom metrics with all fields', () => {
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_NAME', 'sequencerQueueDepth');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_DISPLAY', 'Sequencer Queue');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_METHOD', 'sequencer_queueDepth');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_PARAMS', '["arg1"]');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_PATH', 'result.depth');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_UNIT', 'txs');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_2_NAME', 'batchLatency');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_2_METHOD', 'batcher_latency');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_2_PATH', 'result.latencyMs');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_2_UNIT', 'ms');

    const metrics = parseCustomMetricsFromEnv();
    expect(metrics).toHaveLength(2);
    expect(metrics[0].name).toBe('sequencerQueueDepth');
    expect(metrics[0].displayName).toBe('Sequencer Queue');
    expect(metrics[0].method).toBe('sequencer_queueDepth');
    expect(metrics[0].params).toEqual(['arg1']);
    expect(metrics[0].responsePath).toBe('result.depth');
    expect(metrics[0].unit).toBe('txs');
    expect(metrics[1].name).toBe('batchLatency');
    expect(metrics[1].unit).toBe('ms');
  });

  it('skips entry without _METHOD', () => {
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_NAME', 'onlyName');
    // no METHOD set
    expect(parseCustomMetricsFromEnv()).toEqual([]);
  });

  it('skips entry without _NAME', () => {
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_METHOD', 'some_method');
    // no NAME set
    expect(parseCustomMetricsFromEnv()).toEqual([]);
  });

  it('defaults params to [] when _PARAMS is absent', () => {
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_NAME', 'noParams');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_METHOD', 'some_method');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_PATH', 'result');
    const metrics = parseCustomMetricsFromEnv();
    expect(metrics[0].params).toEqual([]);
  });

  it('defaults params to [] when _PARAMS is invalid JSON', () => {
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_NAME', 'badParams');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_METHOD', 'some_method');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_PATH', 'result');
    vi.stubEnv('SENTINAI_CUSTOM_METRIC_1_PARAMS', 'not-json');
    const metrics = parseCustomMetricsFromEnv();
    expect(metrics[0].params).toEqual([]);
  });
});

// ─── US-06: parseTopologyFromEnv ────────────────────────────────────────────

describe('parseTopologyFromEnv', () => {
  it('returns null when neither env var is set', () => {
    expect(parseTopologyFromEnv()).toBeNull();
  });

  it('parses SENTINAI_COMPONENTS into components array', () => {
    vi.stubEnv('SENTINAI_COMPONENTS', 'execution,batcher,proposer');
    const result = parseTopologyFromEnv();
    expect(result).not.toBeNull();
    expect(result!.components).toEqual(['execution', 'batcher', 'proposer']);
  });

  it('parses valid SENTINAI_COMPONENT_DEPS JSON into dependencyGraph', () => {
    vi.stubEnv('SENTINAI_COMPONENTS', 'execution,batcher');
    vi.stubEnv(
      'SENTINAI_COMPONENT_DEPS',
      JSON.stringify({
        execution: { dependsOn: ['l1'], feeds: ['batcher'] },
        batcher: { dependsOn: ['execution'], feeds: ['l1'] },
      })
    );
    const result = parseTopologyFromEnv();
    expect(result!.dependencyGraph.execution.feeds).toEqual(['batcher']);
    expect(result!.dependencyGraph.batcher.dependsOn).toEqual(['execution']);
  });

  it('returns null for invalid SENTINAI_COMPONENT_DEPS JSON without throwing', () => {
    vi.stubEnv('SENTINAI_COMPONENT_DEPS', '{not-valid-json}');
    expect(() => parseTopologyFromEnv()).not.toThrow();
    expect(parseTopologyFromEnv()).toBeNull();
  });
});

// ─── US-06: parseK8sLabelsFromEnv ───────────────────────────────────────────

describe('parseK8sLabelsFromEnv', () => {
  it('returns empty map when no SENTINAI_K8S_LABEL_* vars are set', () => {
    expect(parseK8sLabelsFromEnv()).toEqual({});
  });

  it('parses component label selectors into lowercase map', () => {
    vi.stubEnv('SENTINAI_K8S_LABEL_EXECUTION', 'app=op-geth');
    vi.stubEnv('SENTINAI_K8S_LABEL_BATCHER', 'app=op-batcher');
    const labels = parseK8sLabelsFromEnv();
    expect(labels['execution']).toBe('app=op-geth');
    expect(labels['batcher']).toBe('app=op-batcher');
  });
});
