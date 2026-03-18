import { createWalletClient, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { facilitatorAbi } from '@/lib/marketplace/facilitator/abi';
import type { SettleTransferInput, SettleTransferResult } from '@/lib/marketplace/facilitator/types';

export async function settleTransfer(input: SettleTransferInput): Promise<SettleTransferResult> {
  const merchant = getAddress(input.merchant);
  const expectedMerchant = getAddress(input.expectedMerchant);

  if (merchant !== expectedMerchant) {
    throw new Error('Settlement merchant does not match the expected merchant');
  }

  const account = privateKeyToAccount(input.profile.relayerPrivateKey);
  const walletClient = createWalletClient({
    account,
    transport: http(input.profile.rpcUrl, { timeout: 10_000 }),
  });

  const txHash = await walletClient.writeContract({
    chain: undefined,
    address: input.profile.facilitatorAddress,
    abi: facilitatorAbi,
    functionName: 'settle',
    args: [
      getAddress(input.buyer),
      merchant,
      input.profile.tonAssetAddress,
      input.amount,
      input.resource,
      input.nonce,
      input.validAfter,
      input.validBefore,
      input.signature,
    ],
  });

  return {
    txHash,
    status: 'submitted',
  };
}
