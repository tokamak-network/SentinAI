import { createPublicClient, decodeEventLog, decodeFunctionData, erc20Abi, getAddress, http } from 'viem';
import type { VerifySettlementInput, VerifySettlementResult } from '@/lib/marketplace/facilitator/types';

function failed(reason: string, blockNumber: number | null = null): VerifySettlementResult {
  return {
    status: 'failed',
    blockNumber,
    transferVerified: false,
    failureReason: reason,
  };
}

export async function verifySettlement(input: VerifySettlementInput): Promise<VerifySettlementResult> {
  const client = createPublicClient({
    transport: http(input.profile.rpcUrl, { timeout: 10_000 }),
  });

  const transaction = await client.getTransaction({ hash: input.txHash });
  if (!transaction) {
    return failed('Settlement transaction not found');
  }

  const expectedContract = getAddress(input.profile.tonAssetAddress);
  if (!transaction.to || getAddress(transaction.to) !== expectedContract) {
    return failed('Settlement transaction targeted the wrong token contract');
  }

  const receipt = await client.getTransactionReceipt({ hash: input.txHash });
  if (!receipt || transaction.blockNumber === null) {
    return {
      status: 'submitted',
      blockNumber: null,
      transferVerified: false,
    };
  }
  if (receipt.status !== 'success') {
    return failed('Settlement transaction receipt was not successful', Number(receipt.blockNumber));
  }

  const decodedCall = decodeFunctionData({
    abi: erc20Abi,
    data: transaction.input,
  });
  if (
    decodedCall.functionName !== 'transferFrom' ||
    decodedCall.args[0] !== getAddress(input.expected.buyer) ||
    decodedCall.args[1] !== getAddress(input.expected.merchant) ||
    decodedCall.args[2] !== input.expected.amount
  ) {
    return failed('Settlement calldata did not match the expected transferFrom', Number(receipt.blockNumber));
  }

  const transferLog = receipt.logs.find((log) => {
    if (!log.address) return false;
    return getAddress(log.address) === expectedContract;
  });
  if (!transferLog) {
    return failed('Settlement Transfer log was not found', Number(receipt.blockNumber));
  }

  const decodedLog = decodeEventLog({
    abi: erc20Abi,
    ...transferLog,
  });
  if (
    decodedLog.eventName !== 'Transfer' ||
    decodedLog.args.from !== getAddress(input.expected.buyer) ||
    decodedLog.args.to !== getAddress(input.expected.merchant) ||
    decodedLog.args.value !== input.expected.amount
  ) {
    return failed('Settlement Transfer log did not match expected values', Number(receipt.blockNumber));
  }

  return {
    status: 'settled',
    blockNumber: Number(receipt.blockNumber),
    transferVerified: true,
  };
}
