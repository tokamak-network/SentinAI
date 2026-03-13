import { listPendingSettlements, markSettlementStatus } from '@/lib/marketplace/facilitator/settlement-store';
import { verifySettlement } from '@/lib/marketplace/facilitator/verify-settlement';
import type { FacilitatorProfile } from '@/lib/marketplace/facilitator/types';

interface ReconcileInput {
  redisPrefix: string;
  profile: Pick<FacilitatorProfile, 'chainId' | 'rpcUrl' | 'tonAssetAddress'>;
}

interface ReconcileResult {
  processed: number;
  settled: number;
  failed: number;
  skipped: number;
}

export async function reconcileSubmittedSettlements(input: ReconcileInput): Promise<ReconcileResult> {
  const settlements = await listPendingSettlements(input.redisPrefix, input.profile.chainId);
  const result: ReconcileResult = {
    processed: settlements.length,
    settled: 0,
    failed: 0,
    skipped: 0,
  };

  for (const settlement of settlements) {
    if (settlement.status !== 'submitted') {
      result.skipped += 1;
      continue;
    }

    const verification = await verifySettlement({
      profile: input.profile,
      txHash: settlement.txHash,
      expected: {
        buyer: settlement.buyer,
        merchant: settlement.merchant,
        amount: BigInt(settlement.amount),
      },
    });

    if (verification.status === 'submitted') {
      continue;
    }

    if (verification.status === 'settled') {
      await markSettlementStatus(input.redisPrefix, input.profile.chainId, settlement.settlementId, {
        status: 'settled',
        txStatus: 'settled',
        transferVerified: verification.transferVerified,
        confirmedBlock: verification.blockNumber,
        failureReason: null,
      });
      result.settled += 1;
      continue;
    }

    await markSettlementStatus(input.redisPrefix, input.profile.chainId, settlement.settlementId, {
      status: 'failed',
      txStatus: 'failed',
      transferVerified: verification.transferVerified,
      confirmedBlock: verification.blockNumber,
      failureReason: verification.failureReason ?? 'Settlement verification failed',
    });
    result.failed += 1;
  }

  return result;
}
