import { randomBytes } from 'node:crypto';
import { getAddress } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { canonicalizeResource } from '@/lib/marketplace/facilitator/typed-data';
import type { FacilitatorNetwork, PaymentAuthorization } from '@/lib/marketplace/facilitator/types';

const DEFAULT_BASE_URL = 'http://localhost:3002';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface FacilitatorSmokeConfig {
  baseUrl: string;
  buyerPrivateKey: `0x${string}`;
  merchantId: string;
  merchantAddress: `0x${string}`;
  resource: string;
  amount: bigint;
  internalAuthSecret: string;
  waitForFinalization: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function readOptionalEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function readBooleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (!value || !value.trim()) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

function readIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name];
  if (!value || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer environment variable: ${name}`);
  }

  return parsed;
}

function normalizeHexKey(value: string, envName: string): `0x${string}` {
  const normalized = value.startsWith('0x') ? value : `0x${value}`;
  if (normalized.length !== 66) {
    throw new Error(`Invalid private key length for ${envName}`);
  }
  return normalized as `0x${string}`;
}

function normalizeAddress(value: string, envName: string): `0x${string}` {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid address in ${envName}`);
  }
}

export function loadFacilitatorSmokeConfig(env: NodeJS.ProcessEnv): FacilitatorSmokeConfig {
  const buyerPrivateKey = normalizeHexKey(
    readRequiredEnv(env, 'TON_FACILITATOR_SMOKE_BUYER_KEY'),
    'TON_FACILITATOR_SMOKE_BUYER_KEY'
  );

  // Validate key material early so the script fails before any network call.
  privateKeyToAddress(buyerPrivateKey);

  return {
    baseUrl: readOptionalEnv(env, 'SENTINAI_BASE_URL', DEFAULT_BASE_URL),
    buyerPrivateKey,
    merchantId: readRequiredEnv(env, 'TON_FACILITATOR_SMOKE_MERCHANT_ID'),
    merchantAddress: normalizeAddress(
      readRequiredEnv(env, 'TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS'),
      'TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS'
    ),
    resource: canonicalizeResource(readRequiredEnv(env, 'TON_FACILITATOR_SMOKE_RESOURCE')),
    amount: BigInt(readRequiredEnv(env, 'TON_FACILITATOR_SMOKE_AMOUNT')),
    internalAuthSecret: readRequiredEnv(env, 'TON_FACILITATOR_INTERNAL_AUTH_SECRET'),
    waitForFinalization: readBooleanEnv(env, 'TON_FACILITATOR_SMOKE_WAIT_FOR_FINAL', true),
    pollIntervalMs: readIntegerEnv(env, 'TON_FACILITATOR_SMOKE_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    timeoutMs: readIntegerEnv(env, 'TON_FACILITATOR_SMOKE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
  };
}

export function createSmokeAuthorization(params: {
  buyer: `0x${string}`;
  merchant: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  resource: string;
  now?: number;
  validForSeconds?: number;
}): PaymentAuthorization {
  const issuedAt = BigInt(params.now ?? Math.floor(Date.now() / 1000));
  const validForSeconds = BigInt(params.validForSeconds ?? 300);

  return {
    buyer: getAddress(params.buyer),
    merchant: getAddress(params.merchant),
    asset: getAddress(params.asset),
    amount: params.amount,
    resource: canonicalizeResource(params.resource),
    nonce: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
    validAfter: issuedAt - BigInt(30),
    validBefore: issuedAt + validForSeconds,
  };
}

export function buildSmokePaymentHeader(input: {
  network: FacilitatorNetwork;
  authorization: PaymentAuthorization;
  signature: `0x${string}`;
}): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: 'exact',
      network: input.network,
      payload: {
        authorization: {
          buyer: input.authorization.buyer,
          merchant: input.authorization.merchant,
          asset: input.authorization.asset,
          amount: input.authorization.amount.toString(),
          resource: input.authorization.resource,
          nonce: input.authorization.nonce,
          validAfter: input.authorization.validAfter.toString(),
          validBefore: input.authorization.validBefore.toString(),
        },
        signature: input.signature,
      },
    })
  ).toString('base64');
}
