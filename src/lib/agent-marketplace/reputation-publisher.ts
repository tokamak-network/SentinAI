import type { ReputationBatchExport } from '@/lib/agent-marketplace/reputation-batch';
import { uploadAgentMarketplaceBatchToIpfs } from '@/lib/agent-marketplace/ipfs-publisher';
import { submitAgentMarketplaceReputationRoot } from '@/lib/agent-marketplace/reputation-submit';

export type PublishAgentMarketplaceReputationBatchResult =
  | { ok: true; batchHash: string; txHash: `0x${string}` | string }
  | { ok: false; error: string };

export async function publishAgentMarketplaceReputationBatch(input: {
  walletKey: `0x${string}` | string;
  registryAddress: `0x${string}` | string;
  batch: ReputationBatchExport;
}): Promise<PublishAgentMarketplaceReputationBatchResult> {
  const upload = await uploadAgentMarketplaceBatchToIpfs({
    root: input.batch.root,
    payload: input.batch,
  });

  if (!upload.ok) {
    return upload;
  }

  const submit = await submitAgentMarketplaceReputationRoot({
    walletKey: input.walletKey,
    registryAddress: input.registryAddress,
    batchHash: upload.batchHash,
    root: input.batch.root,
    agents: input.batch.leaves.map((leaf) => ({
      agentId: leaf.agentId,
      score: leaf.score,
    })),
  });

  if (!submit.ok) {
    return submit;
  }

  return {
    ok: true,
    batchHash: upload.batchHash,
    txHash: submit.txHash,
  };
}
