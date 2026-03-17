#!/usr/bin/env npx tsx
/**
 * ERC8004 Registry Registration Script
 *
 * Registers the SentinAI agent.json URI to the Sepolia ERC8004 registry.
 *
 * Usage:
 *   WALLET_KEY=0x... npx tsx scripts/register-erc8004.ts
 *
 * Optional env:
 *   AGENT_URI_BASE  — Override base URL (default: https://sentinai.tokamak.network/thanos-sepolia)
 *   L1_RPC_URL      — Override Sepolia RPC
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const ERC8004_REGISTRY = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const;

const ABI = [
  { type: 'function', name: 'register', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'latestAgentIdOf', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'agentUriOf', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
  { type: 'event', name: 'AgentRegistered', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'agent', type: 'address', indexed: true }, { name: 'agentURI', type: 'string', indexed: false }] },
] as const;

async function main() {
  const walletKey = process.env.WALLET_KEY?.trim();
  if (!walletKey) {
    console.error('ERROR: WALLET_KEY env var is required');
    console.error('Usage: WALLET_KEY=0x... npx tsx scripts/register-erc8004.ts');
    process.exit(1);
  }

  const agentUriBase = (
    process.env.AGENT_URI_BASE?.trim() ||
    'https://sentinai.tokamak.network/thanos-sepolia'
  ).replace(/\/+$/, '');

  const agentUri = `${agentUriBase}/api/agent-marketplace/agent.json`;

  const l1RpcUrl =
    process.env.L1_RPC_URL?.trim() ||
    process.env.SENTINAI_L1_RPC_URL?.trim() ||
    (process.env.L1_RPC_URLS?.split(',')[0]?.trim()) ||
    undefined;

  if (!l1RpcUrl) {
    console.error('ERROR: No Sepolia RPC URL found. Set L1_RPC_URL env var.');
    process.exit(1);
  }

  const account = privateKeyToAccount(walletKey as `0x${string}`);
  const transport = http(l1RpcUrl, { timeout: 30_000 });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  console.log('=== ERC8004 Registry Registration ===');
  console.log(`Registry:  ${ERC8004_REGISTRY}`);
  console.log(`Network:   Sepolia (11155111)`);
  console.log(`Signer:    ${account.address}`);
  console.log(`URI:       ${agentUri}`);
  console.log('');

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:   ${formatEther(balance)} ETH`);
  if (balance === BigInt(0)) {
    console.error('ERROR: Wallet has 0 ETH. Fund it with Sepolia ETH first.');
    process.exit(1);
  }

  // Check existing registration
  const existingId = await publicClient.readContract({
    address: ERC8004_REGISTRY,
    abi: ABI,
    functionName: 'latestAgentIdOf',
    args: [account.address],
  });

  if (existingId > BigInt(0)) {
    const existingUri = await publicClient.readContract({
      address: ERC8004_REGISTRY,
      abi: ABI,
      functionName: 'agentUriOf',
      args: [existingId],
    });
    console.log(`\nExisting registration found:`);
    console.log(`  Agent ID: #${existingId}`);
    console.log(`  URI:      ${existingUri}`);
    console.log(`\nProceeding with new registration (append-only)...`);
  }

  // Send registration tx
  console.log('\nSending register() transaction...');
  const txHash = await walletClient.writeContract({
    address: ERC8004_REGISTRY,
    abi: ABI,
    functionName: 'register',
    args: [agentUri],
  });
  console.log(`TX Hash:   ${txHash}`);
  console.log(`Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);

  // Wait for receipt
  console.log('\nWaiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    console.error(`\nERROR: Transaction reverted (status: ${receipt.status})`);
    process.exit(1);
  }

  // Parse AgentRegistered event
  const logs = parseEventLogs({
    abi: ABI,
    logs: receipt.logs,
    eventName: 'AgentRegistered',
    strict: false,
  });

  const agentId = logs[0]?.args?.agentId;
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  console.log('\n=== Registration Successful ===');
  console.log(`Agent ID:      #${agentId ?? 'unknown'}`);
  console.log(`TX Hash:       ${txHash}`);
  console.log(`Block:         ${receipt.blockNumber}`);
  console.log(`Timestamp:     ${new Date(Number(block.timestamp) * 1000).toUTCString()}`);
  console.log(`Gas Used:      ${receipt.gasUsed}`);
  console.log(`Etherscan:     https://sepolia.etherscan.io/tx/${txHash}`);
  console.log(`\nRegistered URI: ${agentUri}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
