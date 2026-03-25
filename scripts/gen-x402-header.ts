import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const now = Math.floor(Date.now() / 1000);
const bytes = new Uint8Array(32);
crypto.getRandomValues(bytes);
const nonce = ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

const msg = {
  buyer: account.address,
  merchant: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9' as `0x${string}`,
  asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044' as `0x${string}`,
  amount: BigInt('100000000000000000'),
  resource: '/api/agent-marketplace/sequencer-health',
  nonce,
  validAfter: BigInt(now - 60),
  validBefore: BigInt(now + 300),
};

async function main() {
  const client = createWalletClient({ account, chain: sepolia, transport: http() });
  const sig = await client.signTypedData({
    domain: {
      name: 'SentinAI x402 TON Facilitator',
      version: '1',
      chainId: sepolia.id,
      verifyingContract: '0xe3Dd67941371fdC08685f3f93408DaB55b1E7581',
    },
    types: {
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
    },
    primaryType: 'PaymentAuthorization',
    message: msg,
  });

  const header = Buffer.from(JSON.stringify({
    x402Version: 2,
    scheme: 'exact',
    network: 'eip155:11155111',
    payload: {
      buyer: account.address,
      merchant: msg.merchant,
      asset: msg.asset,
      amount: '100000000000000000',
      resource: msg.resource,
      nonce,
      validAfter: String(msg.validAfter),
      validBefore: String(msg.validBefore),
      signature: sig,
    },
  })).toString('base64');

  process.stdout.write(header);
}

main().catch(e => { console.error(e); process.exit(1); });
