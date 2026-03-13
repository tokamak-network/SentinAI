import { createPublicClient, erc20Abi, http } from 'viem';
import type { CheckFundsInput, CheckFundsResult } from '@/lib/marketplace/facilitator/types';

export async function checkFunds(input: CheckFundsInput): Promise<CheckFundsResult> {
  const client = createPublicClient({
    transport: http(input.profile.rpcUrl, { timeout: 10_000 }),
  });

  const balance = await client.readContract({
    address: input.profile.tonAssetAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [input.buyer],
  });
  const allowance = await client.readContract({
    address: input.profile.tonAssetAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.buyer, input.facilitatorSpender],
  });

  if (balance < input.amount) {
    throw new Error('Insufficient buyer balance for settlement');
  }
  if (allowance < input.amount) {
    throw new Error('Insufficient facilitator allowance for settlement');
  }

  return {
    balance,
    allowance,
  };
}
