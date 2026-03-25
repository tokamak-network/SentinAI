/**
 * Payment Requirements Endpoint
 * Returns X-402 payment requirements for a service.
 * EIP-712 types match the deployed SentinAIFacilitator contract exactly.
 */

const TON_TOKEN = '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044';
const SEPOLIA_CHAIN_ID = 11155111;

function getFacilitatorAddress(): string {
  return process.env.FACILITATOR_ADDRESS?.trim() || '0x0000000000000000000000000000000000000000';
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { resource, merchant, amount } = body;

    if (!resource || !merchant) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: resource, merchant' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facilitatorAddress = getFacilitatorAddress();

    const requirements = {
      network: `eip155:${SEPOLIA_CHAIN_ID}`,
      asset: TON_TOKEN,
      amount: amount || '100000000000000000', // service-specific or default 0.1 TON
      resource,
      merchant,
      facilitator: {
        address: facilitatorAddress,
        spender: facilitatorAddress, // buyer approves TON to Facilitator
      },
      authorization: {
        type: 'eip712',
        domain: {
          name: 'SentinAI x402 TON Facilitator',
          version: '1',
          chainId: SEPOLIA_CHAIN_ID,
          verifyingContract: facilitatorAddress,
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
