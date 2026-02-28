import type { ConnectionConfig, NodeType } from '@/core/types';
import { createInstance, listInstances, updateInstance } from '@/core/instance-registry';
import { validateBeaconConnection, validateRpcConnection } from '@/core/collectors/connection-validator';
import { getCoreRedis } from '@/core/redis';
import { detectClient } from '@/lib/client-detector';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';

export interface FirstRunBootstrapResult {
  ok: boolean;
  instanceId?: string;
  protocolId?: NodeType;
  dashboardUrl?: string;
  detectedClient?: unknown;
  detectedCapabilities?: unknown;
  warnings?: string[];
  error?: string;
}

function normalizeUrl(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function envConnectionConfig(): { protocolId: NodeType; connectionConfig: ConnectionConfig } | null {
  const l2Rpc = normalizeUrl(process.env.L2_RPC_URL);
  const l1Rpc = normalizeUrl(process.env.SENTINAI_L1_RPC_URL);
  const cl = normalizeUrl(process.env.CL_BEACON_URL) ?? normalizeUrl(process.env.SENTINAI_L1_BEACON_URL);

  // Prefer CL-only when explicitly provided
  if (cl) {
    return { protocolId: 'ethereum-cl', connectionConfig: { rpcUrl: cl, beaconApiUrl: cl } };
  }

  // L2 first
  if (l2Rpc) {
    return { protocolId: 'opstack-l2', connectionConfig: { rpcUrl: l2Rpc, ...(l1Rpc ? { chainId: undefined } : {}) } };
  }

  if (l1Rpc) {
    return { protocolId: 'ethereum-el', connectionConfig: { rpcUrl: l1Rpc } };
  }

  return null;
}

export async function firstRunBootstrap(options?: {
  operatorId?: string;
  label?: string;
}): Promise<FirstRunBootstrapResult> {
  const operatorId = options?.operatorId ?? 'default';
  const label = options?.label;
  const warnings: string[] = [];

  const env = envConnectionConfig();
  if (!env) {
    return {
      ok: false,
      error: 'No connection environment variables found. Set L2_RPC_URL or SENTINAI_L1_RPC_URL or CL_BEACON_URL.',
    };
  }

  const { protocolId, connectionConfig } = env;

  // Validate
  const validation = protocolId === 'ethereum-cl'
    ? await validateBeaconConnection(connectionConfig)
    : await validateRpcConnection(connectionConfig);

  if (!validation.valid) {
    return { ok: false, protocolId, error: validation.error ?? 'Connection validation failed.' };
  }

  // Idempotent instance create by rpcUrl
  const all = await listInstances(operatorId).catch(() => []);
  const existing = all.find((i) => i.connectionConfig.rpcUrl === connectionConfig.rpcUrl);

  const instanceId = existing?.instanceId ?? (
    await createInstance({
      operatorId,
      protocolId,
      displayName: label ?? `Node (${protocolId})`,
      connectionConfig,
    })
  ).instanceId;

  // Detect + map
  try {
    const detected = await detectClient(connectionConfig, { protocolIdHint: protocolId });
    const mapped = mapDetectedClientToCapabilities(detected, protocolId);

    const redis = getCoreRedis();
    if (redis) {
      await redis.set(
        `inst:${instanceId}:capabilities`,
        JSON.stringify({
          detectedAt: new Date().toISOString(),
          detectedClient: detected,
          mapped,
          clientVersion: validation.clientVersion,
          chainId: validation.chainId,
        })
      );
    }

    await updateInstance(instanceId, { status: 'active' }).catch((e) => {
      warnings.push(`Failed to set instance active: ${String(e)}`);
    });

    return {
      ok: true,
      instanceId,
      protocolId,
      dashboardUrl: '/v2',
      detectedClient: detected,
      detectedCapabilities: mapped,
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (e) {
    warnings.push(`Detection/mapping failed: ${String(e)}`);
    return {
      ok: true,
      instanceId,
      protocolId,
      dashboardUrl: '/v2',
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
