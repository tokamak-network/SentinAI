import { fetchFromRootApp } from '@/lib/agent-marketplace';

export const revalidate = 0;

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

  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Payment required. Send X-PAYMENT header with base64 envelope',
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!validatePaymentEnvelope(paymentHeader)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_payment_envelope',
        message: 'X-PAYMENT must be valid base64-encoded JSON with agentId',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/batch-submission-status'
    );
    return Response.json(data);
  } catch (error) {
    console.error('[batch-submission-status] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
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
