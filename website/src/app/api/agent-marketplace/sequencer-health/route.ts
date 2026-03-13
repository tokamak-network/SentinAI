import { fetchFromRootApp } from '@/lib/agent-marketplace';

export const revalidate = 0; // No caching for paid endpoints

function validatePaymentEnvelope(envelope: string): boolean {
  try {
    const decoded = Buffer.from(envelope, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return typeof parsed.agentId === 'string';
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const paymentHeader = req.headers.get('X-PAYMENT');

  // Check for payment header
  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Payment required. Send X-PAYMENT header with base64 envelope',
      }),
      {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate payment envelope
  if (!validatePaymentEnvelope(paymentHeader)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_payment_envelope',
        message: 'X-PAYMENT must be valid base64-encoded JSON with agentId',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Fetch from root app
  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/sequencer-health'
    );
    return Response.json(data);
  } catch (error) {
    console.error('[sequencer-health] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch from root app',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-PAYMENT, Content-Type',
    },
  });
}
