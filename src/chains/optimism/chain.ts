/**
 * Optimism Tutorial L2 Chain Definition
 * Chain metadata is configurable via environment variables from tutorial artifacts.
 */

import { defineChain } from 'viem';

const DEFAULT_L2_CHAIN_ID = 42069;
const DEFAULT_L2_CHAIN_NAME = 'Optimism Tutorial L2';
const DEFAULT_L2_NETWORK = 'optimism-tutorial-l2';
const DEFAULT_L2_EXPLORER = 'http://localhost:4000';
const DEFAULT_L2_RPC_URL = 'http://localhost:8545';

function parseChainId(value: string | undefined): number {
  if (!value) {
    return DEFAULT_L2_CHAIN_ID;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_L2_CHAIN_ID;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

export const optimismTutorialChain = defineChain({
  id: parseChainId(process.env.L2_CHAIN_ID),
  name: process.env.L2_CHAIN_NAME || DEFAULT_L2_CHAIN_NAME,
  network: process.env.L2_NETWORK_SLUG || DEFAULT_L2_NETWORK,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || DEFAULT_L2_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: process.env.L2_EXPLORER_URL || DEFAULT_L2_EXPLORER },
  },
  testnet: parseBoolean(process.env.L2_IS_TESTNET, true),
});
