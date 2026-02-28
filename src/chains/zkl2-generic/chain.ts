import { defineChain, type Chain } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

const DEFAULT_CHAIN_ID = 534352;
const DEFAULT_CHAIN_NAME = 'Generic ZK L2';
const DEFAULT_CHAIN_NETWORK = 'zkl2-generic';
const DEFAULT_RPC_URL = 'http://localhost:8545';

function parseChainId(value: string | undefined): number {
  if (!value) return DEFAULT_CHAIN_ID;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHAIN_ID;
  return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  return fallback;
}

export function getZkL2GenericL1Chain(): Chain {
  const configured = process.env.L1_CHAIN?.trim().toLowerCase();
  return configured === 'mainnet' ? mainnet : sepolia;
}

export const zkL2GenericChain = defineChain({
  id: parseChainId(process.env.L2_CHAIN_ID),
  name: process.env.L2_CHAIN_NAME || DEFAULT_CHAIN_NAME,
  network: process.env.L2_NETWORK_SLUG || DEFAULT_CHAIN_NETWORK,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || DEFAULT_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: process.env.L2_EXPLORER_URL || 'http://localhost:3000' },
  },
  testnet: parseBool(process.env.L2_IS_TESTNET, true),
});
