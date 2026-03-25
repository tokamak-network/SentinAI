/**
 * End-to-end x402 payment flow test
 * Simulates: buyer signs EIP-712 → builds X-PAYMENT header → server verifies
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const FACILITATOR = '0xe3Dd67941371fdC08685f3f93408DaB55b1E7581' as const;
const TON_TOKEN = '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044' as const;
const MERCHANT = '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9' as const;
const AMOUNT = '100000000000000000'; // 0.1 TON
const RESOURCE = '/api/agent-marketplace/sequencer-health';

// Use a test private key (not a real wallet)
const BUYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const EIP712_TYPES = {
  PaymentAuthorization: [
    { name: 'buyer', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
} as const;

const EIP712_DOMAIN = {
  name: 'SentinAI x402 TON Facilitator',
  version: '1',
  chainId: sepolia.id,
  verifyingContract: FACILITATOR,
} as const;

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

async function main() {
  console.log('=== x402 Full Flow Test ===\n');

  const buyerAccount = privateKeyToAccount(BUYER_KEY);
  console.log(`Buyer:       ${buyerAccount.address}`);
  console.log(`Merchant:    ${MERCHANT}`);
  console.log(`Facilitator: ${FACILITATOR}`);
  console.log(`TON Token:   ${TON_TOKEN}`);
  console.log(`Amount:      ${AMOUNT} (0.1 TON)`);
  console.log(`Resource:    ${RESOURCE}\n`);

  // Step 1: Build EIP-712 message
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const message = {
    buyer: buyerAccount.address,
    merchant: MERCHANT,
    asset: TON_TOKEN,
    amount: BigInt(AMOUNT),
    resource: RESOURCE,
    nonce: nonce,
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + 300),
  };

  console.log('Step 1: EIP-712 message built');
  console.log(`  nonce: ${nonce}`);
  console.log(`  validAfter: ${message.validAfter} (${new Date(Number(message.validAfter) * 1000).toISOString()})`);
  console.log(`  validBefore: ${message.validBefore} (${new Date(Number(message.validBefore) * 1000).toISOString()})\n`);

  // Step 2: Sign with buyer's key
  const walletClient = createWalletClient({
    account: buyerAccount,
    chain: sepolia,
    transport: http(),
  });

  const signature = await walletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: 'PaymentAuthorization',
    message,
  });

  console.log(`Step 2: EIP-712 signature generated`);
  console.log(`  signature: ${signature.slice(0, 20)}...${signature.slice(-10)}\n`);

  // Step 3: Build X-PAYMENT header (base64 JSON)
  const payload = {
    x402Version: 2,
    scheme: 'exact',
    network: `eip155:${sepolia.id}`,
    payload: {
      buyer: buyerAccount.address,
      merchant: MERCHANT,
      asset: TON_TOKEN,
      amount: AMOUNT,
      resource: RESOURCE,
      nonce: nonce,
      validAfter: String(message.validAfter),
      validBefore: String(message.validBefore),
      signature: signature,
    },
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(payload)).toString('base64');
  console.log(`Step 3: X-PAYMENT header built`);
  console.log(`  length: ${xPaymentHeader.length} chars\n`);

  // Step 4: Verify signature server-side (import verifier)
  const { verifyTypedData } = await import('viem');

  const isValid = await verifyTypedData({
    address: buyerAccount.address,
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: 'PaymentAuthorization',
    message,
    signature,
  });

  console.log(`Step 4: Server-side signature verification`);
  console.log(`  valid: ${isValid}`);
  console.log(`  signer matches buyer: ${isValid}\n`);

  // Step 5: Check on-chain contract state
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
  });

  const FACILITATOR_ABI = parseAbi([
    'function usedNonces(bytes32) external view returns (bool)',
    'function tonToken() external view returns (address)',
    'function owner() external view returns (address)',
    'function DOMAIN_SEPARATOR() external view returns (bytes32)',
  ]);

  try {
    const [tonAddr, owner, domainSep, nonceUsed] = await Promise.all([
      publicClient.readContract({ address: FACILITATOR, abi: FACILITATOR_ABI, functionName: 'tonToken' }),
      publicClient.readContract({ address: FACILITATOR, abi: FACILITATOR_ABI, functionName: 'owner' }),
      publicClient.readContract({ address: FACILITATOR, abi: FACILITATOR_ABI, functionName: 'DOMAIN_SEPARATOR' }),
      publicClient.readContract({ address: FACILITATOR, abi: FACILITATOR_ABI, functionName: 'usedNonces', args: [nonce] }),
    ]);

    console.log(`Step 5: On-chain contract verification`);
    console.log(`  tonToken:         ${tonAddr}`);
    console.log(`  tonToken matches: ${(tonAddr as string).toLowerCase() === TON_TOKEN.toLowerCase()}`);
    console.log(`  owner:            ${owner}`);
    console.log(`  DOMAIN_SEPARATOR: ${(domainSep as string).slice(0, 20)}...`);
    console.log(`  nonce used:       ${nonceUsed}\n`);
  } catch (err) {
    console.log(`Step 5: On-chain verification failed: ${(err as Error).message}\n`);
  }

  // Step 6: Settlement readiness
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (relayerKey) {
    const relayerAccount = privateKeyToAccount(relayerKey as `0x${string}`);
    const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
    console.log(`Step 6: Settlement readiness`);
    console.log(`  relayer address: ${relayerAccount.address}`);
    console.log(`  relayer ETH:     ${Number(relayerBalance) / 1e18} ETH`);
    console.log(`  ready to settle: ${relayerBalance > BigInt(0)}\n`);
  } else {
    console.log(`Step 6: Settlement readiness`);
    console.log(`  RELAYER_PRIVATE_KEY not set — settlement will be skipped\n`);
  }

  // Summary
  console.log('=== Test Summary ===');
  console.log(`  ✅ EIP-712 signing:     PASS`);
  console.log(`  ✅ X-PAYMENT header:    PASS`);
  console.log(`  ${isValid ? '✅' : '❌'} Signature verification: ${isValid ? 'PASS' : 'FAIL'}`);
  console.log(`  ${relayerKey ? '✅' : '⚠️'} Settlement relayer:   ${relayerKey ? 'READY' : 'NOT CONFIGURED'}`);
}

main().catch(console.error);
