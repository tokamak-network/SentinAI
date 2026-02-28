import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const realRpcUrl = process.env.SENTINAI_REAL_RPC_URL;
const realNodeType = (process.env.SENTINAI_REAL_NODE_TYPE ?? 'opstack-l2') as
  | 'ethereum-el'
  | 'opstack-l2'
  | 'arbitrum-nitro'
  | 'zkstack';

const runReal = Boolean(realRpcUrl);

describe('v2 onboarding complete (real RPC optional)', () => {
  it.skipIf(!runReal)(
    'validates + registers using a real RPC endpoint when SENTINAI_REAL_RPC_URL is set',
    async () => {
      const req = new NextRequest('http://localhost/api/v2/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({
          nodeType: realNodeType,
          connectionConfig: { rpcUrl: realRpcUrl },
          operatorId: 'default',
          label: 'Real RPC Integration Test',
        }),
      });

      const res = await POST(req);
      const json = (await res.json()) as {
        data?: { instanceId?: string; dashboardUrl?: string };
        error?: string;
      };

      expect(res.status).toBe(200);
      expect(json.data?.instanceId).toBeTruthy();
      expect(json.data?.dashboardUrl).toBe('/v2');
    }
  );
});
