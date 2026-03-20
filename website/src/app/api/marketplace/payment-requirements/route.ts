/**
 * Payment Requirements Endpoint
 * Returns X-402 payment requirements for a service
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { resource, merchant } = body;

    if (!resource || !merchant) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: resource, merchant' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Mock payment requirements for USDC token on Sepolia
    // Using real Sepolia USDC: https://sepolia.etherscan.io/token/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
    const requirements = {
      network: 'eip155:11155111',
      asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Real USDC on Sepolia
      amount: '100000000000000000', // 0.1 TON (18 decimals)
      resource,
      merchant,
      facilitator: {
        spender: '0x1234567890123456789012345678901234567890',
        settleUrl: 'https://sentinai.tokamak.network/api/settle',
        receiptUrl: 'https://sentinai.tokamak.network/api/receipt',
      },
      authorization: {
        type: 'eip712',
        domain: {
          name: 'SentinAI Data Service',
          version: '1',
          chainId: 11155111,
          verifyingContract: '0x1234567890123456789012345678901234567890',
        },
        primaryType: 'PaymentAuthorization',
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          PaymentAuthorization: [
            { name: 'resource', type: 'string' },
            { name: 'merchant', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
      },
    };

    return new Response(JSON.stringify(requirements), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Payment requirements error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get payment requirements' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
