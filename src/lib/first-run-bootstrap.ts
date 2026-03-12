import type { ConnectionConfig, NodeType } from '@/core/types';
import { createInstance, listInstances, updateInstance } from '@/core/instance-registry';
import { validateRpcConnection } from '@/core/collectors/connection-validator';
import { getCoreRedis } from '@/core/redis';
import { detectClient } from '@/lib/client-detector';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';
import { registerAgentMarketplaceIdentity } from '@/lib/agent-marketplace/agent-registry';

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

function normalizeForMatch(value?: string): string | undefined {
  const normalized = normalizeUrl(value);
  if (!normalized) return undefined;
  return normalized.replace(/\/+$/, '').toLowerCase();
}

function envConnectionConfig(): { protocolId: NodeType; connectionConfig: ConnectionConfig } | null {
  const l2Rpc = normalizeUrl(process.env.L2_RPC_URL) ?? normalizeUrl(process.env.SENTINAI_L2_RPC_URL);
  const l1Rpc = normalizeUrl(process.env.SENTINAI_L1_RPC_URL) ?? normalizeUrl(process.env.L1_RPC_URL);
  // L2 first
  if (l2Rpc) {
    return { protocolId: 'opstack-l2', connectionConfig: { rpcUrl: l2Rpc } };
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
      error: 'No connection environment variables found. Set L2_RPC_URL or SENTINAI_L1_RPC_URL.',
    };
  }

  const { protocolId, connectionConfig } = env;

  async function maybeRegisterMarketplaceIdentity(): Promise<void> {
    if (process.env.MARKETPLACE_ENABLED !== 'true') {
      return;
    }

    const agentUriBase = normalizeUrl(process.env.MARKETPLACE_AGENT_URI_BASE);
    const walletKey = normalizeUrl(process.env.MARKETPLACE_WALLET_KEY);
    const registryAddress = normalizeUrl(process.env.ERC8004_REGISTRY_ADDRESS);

    if (!agentUriBase || !walletKey || !registryAddress) {
      warnings.push('marketplace registration skipped: missing MARKETPLACE_AGENT_URI_BASE, MARKETPLACE_WALLET_KEY, or ERC8004_REGISTRY_ADDRESS');
      return;
    }

    const registration = await registerAgentMarketplaceIdentity({
      agentUriBase,
      walletKey,
      registryAddress,
    });

    if (!registration.ok) {
      warnings.push(`marketplace registration failed: ${registration.error}`);
    }
  }

  // Validate
  const validation = await validateRpcConnection(connectionConfig);

  if (!validation.valid) {
    return { ok: false, protocolId, error: validation.error ?? 'Connection validation failed.' };
  }

  // Idempotent instance create by protocol + endpoint
  const all = await listInstances(operatorId).catch(() => []);
  const endpoint = normalizeForMatch(connectionConfig.rpcUrl) ?? normalizeForMatch(connectionConfig.beaconApiUrl);
  const existing = all.find((instance) => {
    if (instance.protocolId !== protocolId) return false;
    const existingEndpoint = normalizeForMatch(instance.connectionConfig.rpcUrl)
      ?? normalizeForMatch(instance.connectionConfig.beaconApiUrl);
    return !!endpoint && existingEndpoint === endpoint;
  });

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

    await maybeRegisterMarketplaceIdentity().catch((error) => {
      warnings.push(`marketplace registration failed: ${String(error)}`);
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
    await maybeRegisterMarketplaceIdentity().catch((error) => {
      warnings.push(`marketplace registration failed: ${String(error)}`);
    });
    return {
      ok: true,
      instanceId,
      protocolId,
      dashboardUrl: '/v2',
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
