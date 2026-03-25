import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeFunctionResult } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const TON = '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044' as const;
const FACILITATOR_V2 = '0xe36d346861d469ac78b441dd28cdd409b6bf1439' as const;
const BUYER = '0xf33827175e9414dfa1e4f0827f106359f6b52ab7' as const;
const MERCHANT = '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9' as const;

// Use test key to generate signature (won't match real buyer, just testing encoding)
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });

  // 1. Check buyer TON balance
  const balHex = await client.request({
    method: 'eth_call',
    params: [{ to: TON, data: ('0x70a08231' + BUYER.slice(2).padStart(64, '0')) as `0x${string}` }, 'latest'],
  });
  console.log('Buyer TON balance:', BigInt(balHex as string) / BigInt(10**18), 'TON');

  // 2. Check if TON has approveAndCall
  // Try calling with zero amounts to see if the function exists
  try {
    const result = await client.request({
      method: 'eth_call',
      params: [{
        from: BUYER,
        to: TON,
        data: ('0xcae9ca51' + // approveAndCall(address,uint256,bytes)
          FACILITATOR_V2.slice(2).padStart(64, '0') + // spender
          '0'.repeat(64) + // amount = 0
          '0000000000000000000000000000000000000000000000000000000000000060' + // offset to bytes
          '0000000000000000000000000000000000000000000000000000000000000000'   // bytes length = 0
        ) as `0x${string}`,
      }, 'latest'],
    });
    console.log('approveAndCall(0) result:', result);
  } catch (err: any) {
    console.log('approveAndCall(0) revert:', err.message?.slice(0, 200));
  }

  // 3. Check if FacilitatorV2 has onApprove by calling it directly
  // onApprove(address,address,uint256,bytes) selector
  try {
    const result = await client.request({
      method: 'eth_call',
      params: [{
        from: TON,
        to: FACILITATOR_V2,
        data: ('0xda3e3397' + // onApprove selector: keccak256("onApprove(address,address,uint256,bytes)")[:4]
          BUYER.slice(2).padStart(64, '0') +
          FACILITATOR_V2.slice(2).padStart(64, '0') +
          '0'.repeat(64) +
          '0000000000000000000000000000000000000000000000000000000000000080' +
          '0000000000000000000000000000000000000000000000000000000000000000'
        ) as `0x${string}`,
      }, 'latest'],
    });
    console.log('onApprove direct call result:', result);
  } catch (err: any) {
    console.log('onApprove direct call revert:', err.message?.slice(0, 200));
  }

  // 4. Check the actual onApprove selector
  const { keccak256, toBytes } = await import('viem');
  const onApproveSelector = keccak256(toBytes('onApprove(address,address,uint256,bytes)')).slice(0, 10);
  console.log('onApprove selector:', onApproveSelector);

  // 5. Check what TON's approveAndCall expects
  // It might check IERC20OnApprove interface
  const ierc20OnApproveSelector = keccak256(toBytes('onApprove(address,address,uint256,bytes)')).slice(0, 10);
  console.log('IERC20OnApprove.onApprove selector:', ierc20OnApproveSelector);

  // 6. Check if TON checks supportsInterface for IERC20OnApprove
  // ERC165: supportsInterface(bytes4) selector = 0x01ffc9a7
  // IERC20OnApprove interfaceId = onApprove selector
  try {
    const iface = ('0x01ffc9a7' + onApproveSelector.slice(2).padEnd(64, '0')) as `0x${string}`;
    const result = await client.request({
      method: 'eth_call',
      params: [{ to: FACILITATOR_V2, data: iface }, 'latest'],
    });
    console.log('FacilitatorV2 supportsInterface(onApprove):', result);
  } catch (err: any) {
    console.log('supportsInterface check failed:', err.message?.slice(0, 200));
  }
}

main().catch(console.error);
