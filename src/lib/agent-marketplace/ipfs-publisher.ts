import { createHash } from 'node:crypto';

export type AgentMarketplaceIpfsUploadResult =
  | { ok: true; batchHash: string }
  | { ok: false; error: string };

function buildStubCid(root: string, payload: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ root, payload }))
    .digest('hex')
    .slice(0, 32);
  return `stub-${digest}`;
}

export async function uploadAgentMarketplaceBatchToIpfs(input: {
  root: string;
  payload: unknown;
}): Promise<AgentMarketplaceIpfsUploadResult> {
  if (process.env.MARKETPLACE_IPFS_MODE === 'stub') {
    return {
      ok: true,
      batchHash: buildStubCid(input.root, input.payload),
    };
  }

  const uploadUrl = process.env.MARKETPLACE_IPFS_UPLOAD_URL?.trim();
  const authToken = process.env.MARKETPLACE_IPFS_AUTH_TOKEN?.trim();

  if (!uploadUrl || !authToken) {
    return {
      ok: false,
      error: 'IPFS upload requires MARKETPLACE_IPFS_UPLOAD_URL and MARKETPLACE_IPFS_AUTH_TOKEN',
    };
  }

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        root: input.root,
        payload: input.payload,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `IPFS upload failed with status ${response.status}`,
      };
    }

    const body = await response.json() as { cid?: string };
    if (!body.cid) {
      return {
        ok: false,
        error: 'IPFS upload response missing cid',
      };
    }

    return {
      ok: true,
      batchHash: body.cid,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
