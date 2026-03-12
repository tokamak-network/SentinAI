import type { AgentMarketplaceServiceDefinition } from '@/types/agent-marketplace';

export type AgentMarketplacePaymentMode = 'open' | 'stub' | 'facilitated';

export interface AgentMarketplacePaymentEnvelope {
  agentId: string;
  scheme: string;
  network: string;
  token: string;
  amount: string;
  authorization: string;
}

export interface AgentMarketplacePaymentError {
  code:
    | 'invalid_payment_header'
    | 'invalid_payment_payload'
    | 'payment_amount_mismatch'
    | 'payment_verification_failed';
  message: string;
}

export type ParsedPaymentHeaderResult =
  | { ok: true; envelope: AgentMarketplacePaymentEnvelope }
  | { ok: false; error: AgentMarketplacePaymentError };

export type PaymentVerificationResult =
  | { ok: true; mode: AgentMarketplacePaymentMode; agentId: string }
  | { ok: false; error: AgentMarketplacePaymentError };

function getPaymentMode(): AgentMarketplacePaymentMode {
  const mode = process.env.MARKETPLACE_PAYMENT_MODE;
  if (mode === 'open' || mode === 'stub') {
    return mode;
  }
  return 'facilitated';
}

function isPaymentEnvelope(value: unknown): value is AgentMarketplacePaymentEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return [
    'agentId',
    'scheme',
    'network',
    'token',
    'amount',
    'authorization',
  ].every((key) => typeof candidate[key] === 'string' && candidate[key].length > 0);
}

export function parsePaymentHeader(headerValue: string): ParsedPaymentHeaderResult {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);

    if (!isPaymentEnvelope(parsed)) {
      return {
        ok: false,
        error: {
          code: 'invalid_payment_payload',
          message: 'Payment payload is missing required fields.',
        },
      };
    }

    return { ok: true, envelope: parsed };
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid_payment_header',
        message: 'Payment header must be base64 encoded JSON.',
      },
    };
  }
}

async function verifyFacilitatedPayment(
  envelope: AgentMarketplacePaymentEnvelope
): Promise<PaymentVerificationResult> {
  if (!envelope.authorization) {
    return {
      ok: false,
      error: {
        code: 'payment_verification_failed',
        message: 'Payment authorization is required.',
      },
    };
  }

  return {
    ok: true,
    mode: 'facilitated',
    agentId: envelope.agentId,
  };
}

export async function verifyAgentMarketplacePayment(input: {
  service: AgentMarketplaceServiceDefinition;
  envelope: AgentMarketplacePaymentEnvelope;
}): Promise<PaymentVerificationResult> {
  const { service, envelope } = input;

  if (!service.payment) {
    return {
      ok: false,
      error: {
        code: 'payment_verification_failed',
        message: `Service ${service.key} is not configured for payments.`,
      },
    };
  }

  if (service.payment.amount !== envelope.amount) {
    return {
      ok: false,
      error: {
        code: 'payment_amount_mismatch',
        message: `Payment amount does not match the ${service.key} price.`,
      },
    };
  }

  const mode = getPaymentMode();
  if (mode === 'open' || mode === 'stub') {
    return {
      ok: true,
      mode,
      agentId: envelope.agentId,
    };
  }

  return verifyFacilitatedPayment(envelope);
}
