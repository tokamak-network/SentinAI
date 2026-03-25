import type { AgentMarketplaceServiceDefinition } from '@/types/agent-marketplace';
import { verifyTypedData } from 'viem';
import { sepolia } from 'viem/chains';

export type AgentMarketplacePaymentMode = 'open' | 'stub' | 'facilitated';

export interface AgentMarketplacePaymentEnvelope {
  agentId: string;
  scheme: string;
  network: string;
  // x402 v2 payload fields (contract-aligned)
  buyer?: string;
  merchant?: string;
  asset?: string;
  amount: string;
  resource?: string;
  nonce?: string;
  validAfter?: string;
  validBefore?: string;
  signature?: string;
  // Legacy fields
  token?: string;
  authorization?: string;
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

function getFacilitatorAddress(): `0x${string}` {
  const addr = process.env.FACILITATOR_ADDRESS?.trim();
  return (addr || '0x0000000000000000000000000000000000000000') as `0x${string}`;
}

export function parsePaymentHeader(headerValue: string): ParsedPaymentHeaderResult {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);

    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error: {
          code: 'invalid_payment_payload',
          message: 'Payment payload is not a valid object.',
        },
      };
    }

    const obj = parsed as Record<string, unknown>;

    // x402 v2: extract from payload
    const payload = (obj.payload ?? obj) as Record<string, unknown>;

    const envelope: AgentMarketplacePaymentEnvelope = {
      agentId: (payload.buyer as string) ?? 'unknown',
      scheme: (obj.scheme as string) ?? 'exact',
      network: (obj.network as string) ?? '',
      buyer: payload.buyer as string,
      merchant: payload.merchant as string,
      asset: payload.asset as string,
      amount: (payload.amount as string) ?? '0',
      resource: payload.resource as string,
      nonce: payload.nonce as string,
      validAfter: payload.validAfter as string,
      validBefore: payload.validBefore as string,
      signature: payload.signature as string,
    };

    if (!envelope.signature) {
      return {
        ok: false,
        error: {
          code: 'invalid_payment_payload',
          message: 'Payment payload is missing signature.',
        },
      };
    }

    return { ok: true, envelope };
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

/**
 * Verify EIP-712 signature server-side using viem's verifyTypedData.
 * Matches the SentinAIFacilitator.sol PaymentAuthorization struct.
 */
async function verifyFacilitatedPayment(
  envelope: AgentMarketplacePaymentEnvelope
): Promise<PaymentVerificationResult> {
  if (!envelope.buyer || !envelope.signature || !envelope.nonce) {
    return {
      ok: false,
      error: {
        code: 'payment_verification_failed',
        message: 'Missing buyer, signature, or nonce in payment envelope.',
      },
    };
  }

  const facilitatorAddress = getFacilitatorAddress();

  try {
    const isValid = await verifyTypedData({
      address: envelope.buyer as `0x${string}`,
      domain: {
        name: 'SentinAI x402 TON Facilitator',
        version: '1',
        chainId: sepolia.id,
        verifyingContract: facilitatorAddress,
      },
      types: {
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
      primaryType: 'PaymentAuthorization',
      message: {
        buyer: envelope.buyer as `0x${string}`,
        merchant: (envelope.merchant ?? '0x0') as `0x${string}`,
        asset: (envelope.asset ?? '0x0') as `0x${string}`,
        amount: BigInt(envelope.amount),
        resource: envelope.resource ?? '',
        nonce: envelope.nonce as `0x${string}`,
        validAfter: BigInt(envelope.validAfter ?? '0'),
        validBefore: BigInt(envelope.validBefore ?? '0'),
      },
      signature: envelope.signature as `0x${string}`,
    });

    if (!isValid) {
      return {
        ok: false,
        error: {
          code: 'payment_verification_failed',
          message: 'EIP-712 signature verification failed. Signer does not match buyer.',
        },
      };
    }

    // Check time validity
    const now = Math.floor(Date.now() / 1000);
    const validAfter = Number(envelope.validAfter ?? '0');
    const validBefore = Number(envelope.validBefore ?? '0');

    if (now < validAfter) {
      return {
        ok: false,
        error: { code: 'payment_verification_failed', message: 'Payment authorization not yet valid.' },
      };
    }
    if (now > validBefore) {
      return {
        ok: false,
        error: { code: 'payment_verification_failed', message: 'Payment authorization has expired.' },
      };
    }

    return {
      ok: true,
      mode: 'facilitated',
      agentId: envelope.buyer,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'payment_verification_failed',
        message: `Signature verification error: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    };
  }
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
  if (mode === 'open') {
    return { ok: true, mode: 'open', agentId: envelope.agentId };
  }
  if (mode === 'stub') {
    return { ok: true, mode: 'stub', agentId: envelope.agentId };
  }

  return verifyFacilitatedPayment(envelope);
}
