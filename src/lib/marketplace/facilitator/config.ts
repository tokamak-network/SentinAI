import { getAddress } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import type {
  FacilitatorConfig,
  FacilitatorNetwork,
  FacilitatorProfile,
  FacilitatorProfileId,
  MerchantAllowlistEntry,
} from '@/lib/marketplace/facilitator/types';

const TON_MAINNET_ASSET = '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5';
const TON_SEPOLIA_ASSET = '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044';
const DEFAULT_RECONCILER_CRON = '*/15 * * * * *';

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function readBooleanEnv(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === 'true';
}

function normalizeHexKey(value: string, envName: string): `0x${string}` {
  const normalized = value.startsWith('0x') ? value : `0x${value}`;
  if (normalized.length !== 66) {
    throw new Error(`Invalid private key length for ${envName}`);
  }
  return normalized as `0x${string}`;
}

function normalizeAddress(value: string, envName: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid address in ${envName}`);
  }
}

function parseMerchantAllowlist(raw: string): MerchantAllowlistEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TON_FACILITATOR_MERCHANT_ALLOWLIST must be valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('TON_FACILITATOR_MERCHANT_ALLOWLIST must be a JSON array');
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Merchant allowlist entry ${index} must be an object`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.merchantId !== 'string' || !candidate.merchantId.trim()) {
      throw new Error(`Merchant allowlist entry ${index} must include merchantId`);
    }
    if (!Array.isArray(candidate.resources) || candidate.resources.some((value) => typeof value !== 'string')) {
      throw new Error(`Merchant allowlist entry ${index} must include string resources`);
    }
    if (!Array.isArray(candidate.networks) || candidate.networks.some((value) => value !== 'eip155:1' && value !== 'eip155:11155111')) {
      throw new Error(`Merchant allowlist entry ${index} must include supported networks`);
    }

    return {
      merchantId: candidate.merchantId.trim(),
      address: normalizeAddress(String(candidate.address), `TON_FACILITATOR_MERCHANT_ALLOWLIST[${index}].address`),
      resources: candidate.resources as string[],
      networks: candidate.networks as FacilitatorNetwork[],
    };
  });
}

function assertAllowlistMatchesFacilitatorProfiles(
  merchantAllowlist: MerchantAllowlistEntry[],
  profiles: Record<FacilitatorProfileId, FacilitatorProfile>
): void {
  for (const entry of merchantAllowlist) {
    for (const network of entry.networks) {
      const profile = Object.values(profiles).find((candidate) => candidate.network === network);
      if (!profile) {
        continue;
      }

      if (getAddress(entry.address) !== getAddress(profile.facilitatorAddress)) {
        throw new Error(
          `Merchant allowlist entry ${entry.merchantId} must match facilitator address for ${network}`
        );
      }
    }
  }
}

function buildProfile(id: FacilitatorProfileId): FacilitatorProfile {
  const upper = id.toUpperCase();
  const enabled = readBooleanEnv(`TON_FACILITATOR_${upper}_ENABLED`);
  const relayerPrivateKey = normalizeHexKey(
    readRequiredEnv(`TON_FACILITATOR_${upper}_RELAYER_KEY`),
    `TON_FACILITATOR_${upper}_RELAYER_KEY`
  );
  const facilitatorAddress = normalizeAddress(
    readRequiredEnv(`TON_FACILITATOR_${upper}_ADDRESS`),
    `TON_FACILITATOR_${upper}_ADDRESS`
  );

  // Ensure the env key is at least structurally valid for downstream wallet usage.
  privateKeyToAddress(relayerPrivateKey);

  return {
    id,
    enabled,
    chainId: id === 'mainnet' ? 1 : 11155111,
    network: id === 'mainnet' ? 'eip155:1' : 'eip155:11155111',
    rpcUrl: readRequiredEnv(`TON_FACILITATOR_${upper}_RPC_URL`),
    relayerPrivateKey,
    facilitatorAddress,
    tonAssetAddress: id === 'mainnet' ? TON_MAINNET_ASSET : TON_SEPOLIA_ASSET,
  };
}

export function loadFacilitatorConfig(): FacilitatorConfig {
  const merchantAllowlist = parseMerchantAllowlist(readRequiredEnv('TON_FACILITATOR_MERCHANT_ALLOWLIST'));
  const profiles = {
    mainnet: buildProfile('mainnet'),
    sepolia: buildProfile('sepolia'),
  } satisfies Record<FacilitatorProfileId, FacilitatorProfile>;

  assertAllowlistMatchesFacilitatorProfiles(merchantAllowlist, profiles);

  return {
    redisPrefix: readRequiredEnv('TON_FACILITATOR_REDIS_PREFIX'),
    internalAuthSecret: readRequiredEnv('TON_FACILITATOR_INTERNAL_AUTH_SECRET'),
    receiptSigningKey: normalizeHexKey(
      readRequiredEnv('TON_FACILITATOR_RECEIPT_SIGNING_KEY'),
      'TON_FACILITATOR_RECEIPT_SIGNING_KEY'
    ),
    merchantAllowlist,
    reconciler: {
      enabled: readBooleanEnv('TON_FACILITATOR_RECONCILER_ENABLED', true),
      cron: process.env.TON_FACILITATOR_RECONCILER_CRON?.trim() || DEFAULT_RECONCILER_CRON,
    },
    profiles,
  };
}
