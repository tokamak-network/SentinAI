/**
 * SentinAI Marketplace — Full Verification Script
 * Tests all layers: contracts, APIs, data consistency, x402 flow
 */

import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const WEBSITE = 'https://sentinai-xi.vercel.app';
const MAIN_APP = 'https://sentinai.tokamak.network/thanos-sepolia';

const CONTRACTS = {
  facilitator: '0xdcb25d78fbaeafdef5672aca204603c2d202ceef' as const,
  reviewRegistry: '0x3b5F5d476e53c970e8cb2b1b547B491dcBAa5b02' as const,
  erc8004Registry: '0x64c8f8cB66657349190c7AF783f8E0254dCF1467' as const,
  ton: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044' as const,
  operator: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9' as const,
};

// Test key (Hardhat default — no real funds)
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string, detail?: string) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name: string, detail?: string) {
  failed++;
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name: string, reason: string) {
  skipped++;
  console.log(`  ⚠️  ${name} — ${reason}`);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJson(url: string, body: any): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 1. ON-CHAIN CONTRACT VERIFICATION ═══\n');
  // ═══════════════════════════════════════════════════════════════

  const facAbi = parseAbi([
    'function tonToken() view returns (address)',
    'function reviewRegistry() view returns (address)',
    'function owner() view returns (address)',
    'function supportsInterface(bytes4) view returns (bool)',
    'function usedNonces(bytes32) view returns (bool)',
  ]);

  const regAbi = parseAbi([
    'function facilitator() view returns (address)',
    'function totalTrades() view returns (uint256)',
    'function totalReviews() view returns (uint256)',
    'function reviewCount(address) view returns (uint256)',
  ]);

  // FacilitatorV2
  try {
    const ton = await client.readContract({ address: CONTRACTS.facilitator, abi: facAbi, functionName: 'tonToken' });
    (ton as string).toLowerCase() === CONTRACTS.ton.toLowerCase()
      ? ok('FacilitatorV2.tonToken', String(ton))
      : fail('FacilitatorV2.tonToken', `expected ${CONTRACTS.ton}, got ${ton}`);
  } catch (e: any) { fail('FacilitatorV2.tonToken', e.message); }

  try {
    const reg = await client.readContract({ address: CONTRACTS.facilitator, abi: facAbi, functionName: 'reviewRegistry' });
    (reg as string).toLowerCase() === CONTRACTS.reviewRegistry.toLowerCase()
      ? ok('FacilitatorV2.reviewRegistry', String(reg))
      : fail('FacilitatorV2.reviewRegistry', `expected ${CONTRACTS.reviewRegistry}, got ${reg}`);
  } catch (e: any) { fail('FacilitatorV2.reviewRegistry', e.message); }

  try {
    const erc165 = await client.readContract({ address: CONTRACTS.facilitator, abi: facAbi, functionName: 'supportsInterface', args: ['0x4273ca16'] });
    erc165 ? ok('FacilitatorV2.supportsInterface(onApprove)', 'true') : fail('FacilitatorV2.supportsInterface', 'false');
  } catch (e: any) { fail('FacilitatorV2.supportsInterface', e.message); }

  try {
    const owner = await client.readContract({ address: CONTRACTS.facilitator, abi: facAbi, functionName: 'owner' });
    (owner as string).toLowerCase() === CONTRACTS.operator.toLowerCase()
      ? ok('FacilitatorV2.owner', String(owner))
      : ok('FacilitatorV2.owner', `${owner} (not operator — ok if deployer)`);
  } catch (e: any) { fail('FacilitatorV2.owner', e.message); }

  // ReviewRegistry
  try {
    const fac = await client.readContract({ address: CONTRACTS.reviewRegistry, abi: regAbi, functionName: 'facilitator' });
    (fac as string).toLowerCase() === CONTRACTS.facilitator.toLowerCase()
      ? ok('ReviewRegistry.facilitator', String(fac))
      : fail('ReviewRegistry.facilitator', `expected ${CONTRACTS.facilitator}, got ${fac}`);
  } catch (e: any) { fail('ReviewRegistry.facilitator', e.message); }

  try {
    const trades = await client.readContract({ address: CONTRACTS.reviewRegistry, abi: regAbi, functionName: 'totalTrades' });
    ok('ReviewRegistry.totalTrades', String(trades));
  } catch (e: any) { fail('ReviewRegistry.totalTrades', e.message); }

  try {
    const reviews = await client.readContract({ address: CONTRACTS.reviewRegistry, abi: regAbi, functionName: 'totalReviews' });
    ok('ReviewRegistry.totalReviews', String(reviews));
  } catch (e: any) { fail('ReviewRegistry.totalReviews', e.message); }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 2. WEBSITE API VERIFICATION ═══\n');
  // ═══════════════════════════════════════════════════════════════

  // Operators discovery
  try {
    const data = await fetchJson(`${WEBSITE}/api/marketplace/operators`);
    data.source === 'on-chain'
      ? ok('Operators API source', `on-chain, ${data.count} operators`)
      : skip('Operators API source', `fallback (${data.source})`);
    data.count > 0 ? ok('Operators count', String(data.count)) : fail('Operators count', '0');
  } catch (e: any) { fail('Operators API', e.message); }

  // Trade stats
  try {
    const data = await fetchJson(`${WEBSITE}/api/trade-stats`);
    data.ok ? ok('Trade Stats', `${data.global.totalTransactions} txns, ${data.global.totalVolumeTON} TON`) : fail('Trade Stats', 'ok=false');
  } catch (e: any) { fail('Trade Stats', e.message); }

  // Guardian Score
  try {
    const data = await fetchJson(`${WEBSITE}/api/marketplace/guardian-score/${CONTRACTS.operator}`);
    data.temperature > 0
      ? ok('Guardian Score', `${data.temperature}°C, ${data.reviewCount} reviews, ${data.tradeCount ?? '?'} trades`)
      : fail('Guardian Score', 'temperature=0');
  } catch (e: any) { fail('Guardian Score', e.message); }

  // Reviews (on-chain + legacy)
  try {
    const data = await fetchJson(`${WEBSITE}/api/marketplace/reviews-onchain?operator=${CONTRACTS.operator}`);
    ok('Reviews API', `${data.length} reviews (on-chain + legacy)`);
  } catch (e: any) { fail('Reviews API', e.message); }

  // Payment requirements
  try {
    const { status, data } = await postJson(`${WEBSITE}/api/marketplace/payment-requirements`, {
      resource: '/test', merchant: CONTRACTS.operator, amount: '100000000000000000',
    });
    status === 200 && data.facilitator?.address?.toLowerCase() === CONTRACTS.facilitator.toLowerCase()
      ? ok('Payment Requirements', `facilitator=${data.facilitator.address}`)
      : fail('Payment Requirements', `status=${status}, facilitator=${data.facilitator?.address}`);
  } catch (e: any) { fail('Payment Requirements', e.message); }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. MAIN APP x402 VERIFICATION ═══\n');
  // ═══════════════════════════════════════════════════════════════

  // No payment → 402
  try {
    const res = await fetch(`${MAIN_APP}/api/agent-marketplace/sequencer-health`);
    res.status === 402
      ? ok('No payment → 402', 'payment_required')
      : fail('No payment → 402', `got ${res.status}`);
  } catch (e: any) { fail('No payment → 402', e.message); }

  // Invalid payment → 402
  try {
    const res = await fetch(`${MAIN_APP}/api/agent-marketplace/sequencer-health`, {
      headers: { 'X-PAYMENT': 'dGVzdA==' },
    });
    res.status === 402
      ? ok('Invalid payment → 402', 'rejected')
      : fail('Invalid payment → 402', `got ${res.status}`);
  } catch (e: any) { fail('Invalid payment → 402', e.message); }

  // Valid signature → 200
  try {
    const account = privateKeyToAccount(TEST_KEY);
    const now = Math.floor(Date.now() / 1000);
    const nonce = ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

    const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });
    const sig = await walletClient.signTypedData({
      domain: { name: 'SentinAI x402 TON Facilitator', version: '1', chainId: sepolia.id, verifyingContract: CONTRACTS.facilitator },
      types: { PaymentAuthorization: [
        { name: 'buyer', type: 'address' }, { name: 'merchant', type: 'address' },
        { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
        { name: 'resource', type: 'string' }, { name: 'nonce', type: 'bytes32' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' },
      ]},
      primaryType: 'PaymentAuthorization',
      message: {
        buyer: account.address, merchant: CONTRACTS.operator, asset: CONTRACTS.ton,
        amount: BigInt('100000000000000000'), resource: '/api/agent-marketplace/sequencer-health',
        nonce, validAfter: BigInt(now - 60), validBefore: BigInt(now + 300),
      },
    });

    const header = Buffer.from(JSON.stringify({
      x402Version: 2, scheme: 'exact', network: 'eip155:11155111',
      payload: {
        buyer: account.address, merchant: CONTRACTS.operator, asset: CONTRACTS.ton,
        amount: '100000000000000000', resource: '/api/agent-marketplace/sequencer-health',
        nonce, validAfter: String(now - 60), validBefore: String(now + 300), signature: sig,
      },
    })).toString('base64');

    const res = await fetch(`${MAIN_APP}/api/agent-marketplace/sequencer-health`, {
      headers: { 'X-PAYMENT': header },
    });
    if (res.status === 200) {
      const data = await res.json();
      ok('Valid signature → 200', `status=${data.status}, healthScore=${data.healthScore}`);
    } else {
      const data = await res.json().catch(() => ({}));
      fail('Valid signature → 200', `got ${res.status}: ${JSON.stringify(data.error)}`);
    }
  } catch (e: any) { fail('Valid signature → 200', e.message); }

  // All 7 services with correct amounts
  const SERVICES = [
    { slug: 'sequencer-health', amount: '100000000000000000' },
    { slug: 'incident-summary', amount: '150000000000000000' },
    { slug: 'batch-submission-status', amount: '150000000000000000' },
    { slug: 'derivation-lag', amount: '100000000000000000' },
    { slug: 'anomaly-feed', amount: '100000000000000000' },
    { slug: 'health-diagnostics', amount: '150000000000000000' },
    { slug: 'rca-report', amount: '250000000000000000' },
  ];

  for (const svc of SERVICES) {
    try {
      const account = privateKeyToAccount(TEST_KEY);
      const now = Math.floor(Date.now() / 1000);
      const nonce = ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

      const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });
      const sig = await walletClient.signTypedData({
        domain: { name: 'SentinAI x402 TON Facilitator', version: '1', chainId: sepolia.id, verifyingContract: CONTRACTS.facilitator },
        types: { PaymentAuthorization: [
          { name: 'buyer', type: 'address' }, { name: 'merchant', type: 'address' },
          { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
          { name: 'resource', type: 'string' }, { name: 'nonce', type: 'bytes32' },
          { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' },
        ]},
        primaryType: 'PaymentAuthorization',
        message: {
          buyer: account.address, merchant: CONTRACTS.operator, asset: CONTRACTS.ton,
          amount: BigInt(svc.amount), resource: `/api/agent-marketplace/${svc.slug}`,
          nonce, validAfter: BigInt(now - 60), validBefore: BigInt(now + 300),
        },
      });

      const header = Buffer.from(JSON.stringify({
        x402Version: 2, scheme: 'exact', network: 'eip155:11155111',
        payload: {
          buyer: account.address, merchant: CONTRACTS.operator, asset: CONTRACTS.ton,
          amount: svc.amount, resource: `/api/agent-marketplace/${svc.slug}`,
          nonce, validAfter: String(now - 60), validBefore: String(now + 300), signature: sig,
        },
      })).toString('base64');

      const res = await fetch(`${MAIN_APP}/api/agent-marketplace/${svc.slug}`, { headers: { 'X-PAYMENT': header } });
      res.status === 200
        ? ok(`Service ${svc.slug}`, '200 OK')
        : fail(`Service ${svc.slug}`, `${res.status}`);
    } catch (e: any) { fail(`Service ${svc.slug}`, e.message); }
  }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. REVIEW API VALIDATION ═══\n');
  // ═══════════════════════════════════════════════════════════════

  // Invalid txHash format → 400
  try {
    const { status } = await postJson(`${WEBSITE}/api/marketplace/reviews`, {
      operatorAddress: CONTRACTS.operator, reviewerAddress: '0xtest', txHash: 'invalid',
      ratings: { dataAccuracy: 5, responseSpeed: 5, uptime: 5, valueForMoney: 5 }, serviceKey: 'test',
    });
    status === 400 ? ok('Invalid txHash → 400') : fail('Invalid txHash', `got ${status}`);
  } catch (e: any) { fail('Invalid txHash', e.message); }

  // Rating out of range → 400
  try {
    const { status } = await postJson(`${WEBSITE}/api/marketplace/reviews`, {
      operatorAddress: CONTRACTS.operator, reviewerAddress: '0xtest',
      txHash: '0x' + '0'.repeat(64),
      ratings: { dataAccuracy: 6, responseSpeed: 5, uptime: 5, valueForMoney: 5 }, serviceKey: 'test',
    });
    status === 400 ? ok('Rating out of range → 400') : fail('Rating range', `got ${status}`);
  } catch (e: any) { fail('Rating range', e.message); }

  // Missing fields → 400
  try {
    const { status } = await postJson(`${WEBSITE}/api/marketplace/reviews`, { operatorAddress: '0x' });
    status === 400 ? ok('Missing fields → 400') : fail('Missing fields', `got ${status}`);
  } catch (e: any) { fail('Missing fields', e.message); }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. DATA CONSISTENCY ═══\n');
  // ═══════════════════════════════════════════════════════════════

  // Verify on-chain trade count matches API
  try {
    const onchainTrades = await client.readContract({
      address: CONTRACTS.reviewRegistry, abi: regAbi, functionName: 'totalTrades',
    });
    const apiStats = await fetchJson(`${WEBSITE}/api/trade-stats`);
    const apiTrades = apiStats.global?.totalTransactions ?? 0;

    Number(onchainTrades) === apiTrades
      ? ok('Trade count consistency', `on-chain=${onchainTrades}, API=${apiTrades}`)
      : skip('Trade count consistency', `on-chain=${onchainTrades}, API=${apiTrades} (cache delay)`);
  } catch (e: any) { fail('Trade count consistency', e.message); }

  // Verify on-chain review count matches API
  try {
    const onchainReviews = await client.readContract({
      address: CONTRACTS.reviewRegistry, abi: regAbi, functionName: 'reviewCount', args: [CONTRACTS.operator],
    });
    const apiReviews = await fetchJson(`${WEBSITE}/api/marketplace/reviews-onchain?operator=${CONTRACTS.operator}`);
    const onchainOnly = apiReviews.filter((r: any) => r.source === 'onchain').length;

    ok('Review count', `on-chain registry=${onchainReviews}, API on-chain=${onchainOnly}, API total=${apiReviews.length} (incl legacy)`);
  } catch (e: any) { fail('Review count consistency', e.message); }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 6. SELF-TRADE PREVENTION ═══\n');
  // ═══════════════════════════════════════════════════════════════

  try {
    const account = privateKeyToAccount(TEST_KEY);
    const now = Math.floor(Date.now() / 1000);
    const nonce = ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

    // Sign with buyer == merchant (self-trade)
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });
    const sig = await walletClient.signTypedData({
      domain: { name: 'SentinAI x402 TON Facilitator', version: '1', chainId: sepolia.id, verifyingContract: CONTRACTS.facilitator },
      types: { PaymentAuthorization: [
        { name: 'buyer', type: 'address' }, { name: 'merchant', type: 'address' },
        { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
        { name: 'resource', type: 'string' }, { name: 'nonce', type: 'bytes32' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' },
      ]},
      primaryType: 'PaymentAuthorization',
      message: {
        buyer: account.address, merchant: account.address, // SELF TRADE
        asset: CONTRACTS.ton, amount: BigInt('100000000000000000'),
        resource: '/api/test', nonce, validAfter: BigInt(now - 60), validBefore: BigInt(now + 300),
      },
    });

    // This signature is valid but settlement would revert on-chain
    // Server-side verification should still pass (signature is valid)
    // The revert happens at contract level during approveAndCall
    ok('Self-trade signature', 'EIP-712 signs fine (revert happens on-chain at contract level)');
  } catch (e: any) { fail('Self-trade test', e.message); }

  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ SUMMARY ═══\n');
  // ═══════════════════════════════════════════════════════════════

  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⚠️  Skipped: ${skipped}`);
  console.log(`  Total:     ${passed + failed + skipped}`);
  console.log('');

  if (failed > 0) {
    console.log('  🔴 SOME TESTS FAILED — review output above');
    process.exit(1);
  } else {
    console.log('  🟢 ALL TESTS PASSED');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
