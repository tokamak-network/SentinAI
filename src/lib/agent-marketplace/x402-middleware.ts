import type { AgentMarketplaceServiceDefinition } from '@/types/agent-marketplace';
import { checkAgentMarketplaceRateLimit } from '@/lib/agent-marketplace/rate-limit';
import { recordAgentMarketplaceRequest } from '@/lib/agent-marketplace/request-log-store';
import {
  parsePaymentHeader,
  verifyAgentMarketplacePayment,
} from '@/lib/agent-marketplace/payment-verifier';
import { settleOnChain } from '@/lib/agent-marketplace/settlement-relayer';
import logger from '@/lib/logger';

export interface AuthorizedPaymentContext {
  payment: {
    agentId: string;
    mode: 'open' | 'stub' | 'facilitated';
  };
}

function buildPaymentRequiredResponse(service: AgentMarketplaceServiceDefinition): Response {
  return Response.json({
    error: {
      code: 'payment_required',
      message: `Payment is required for ${service.key}.`,
    },
    accepts: service.payment ? [service.payment] : [],
  }, {
    status: 402,
  });
}

function buildPaymentErrorResponse(code: string, message: string, service: AgentMarketplaceServiceDefinition): Response {
  return Response.json({
    error: {
      code,
      message,
    },
    accepts: service.payment ? [service.payment] : [],
  }, {
    status: 402,
  });
}

function buildRateLimitResponse(service: AgentMarketplaceServiceDefinition, retryAfterMs: number): Response {
  return Response.json({
    error: {
      code: 'rate_limited',
      message: `Rate limit exceeded for ${service.key}.`,
    },
    accepts: service.payment ? [service.payment] : [],
    retryAfterMs,
  }, {
    status: 429,
  });
}

export async function withX402(
  request: Request,
  service: AgentMarketplaceServiceDefinition,
  handler: (context: AuthorizedPaymentContext) => Promise<Response>,
  operatorAddress?: string
): Promise<Response> {
  const startedAt = Date.now();
  const paymentHeader = request.headers.get('x-payment');
  if (!paymentHeader) {
    return buildPaymentRequiredResponse(service);
  }

  const parsed = parsePaymentHeader(paymentHeader);
  if (!parsed.ok) {
    await recordAgentMarketplaceRequest({
      agentId: 'unknown',
      serviceKey: service.key,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      verificationResult: 'rejected',
      success: false,
      operatorAddress,
    });
    return buildPaymentErrorResponse(parsed.error.code, parsed.error.message, service);
  }

  const verification = await verifyAgentMarketplacePayment({
    service,
    envelope: parsed.envelope,
  });

  if (!verification.ok) {
    await recordAgentMarketplaceRequest({
      agentId: parsed.envelope.agentId,
      serviceKey: service.key,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      verificationResult: 'rejected',
      success: false,
      operatorAddress,
    });
    return buildPaymentErrorResponse(
      verification.error.code,
      verification.error.message,
      service
    );
  }

  const rateLimitResult = checkAgentMarketplaceRateLimit({
    agentId: verification.agentId,
    serviceKey: service.key,
  });
  if (!rateLimitResult.ok) {
    await recordAgentMarketplaceRequest({
      agentId: verification.agentId,
      serviceKey: service.key,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      verificationResult: 'rate_limited',
      success: false,
      operatorAddress,
    });
    return buildRateLimitResponse(service, rateLimitResult.retryAfterMs);
  }

  // On-chain settlement (facilitated mode only, skip for open/stub)
  let settlementTxHash: string | undefined;
  let settlementStatus: 'settled' | 'pending' | 'skipped' = 'skipped';

  if (verification.mode === 'facilitated' && process.env.RELAYER_PRIVATE_KEY) {
    settlementStatus = 'pending';
    const settlement = await settleOnChain(parsed.envelope);
    if (!settlement.success) {
      logger.warn(`[x402] Settlement failed for ${service.key}: ${settlement.error}`);
    } else {
      logger.info(`[x402] Settlement successful for ${service.key}: ${settlement.txHash}`);
      settlementTxHash = settlement.txHash;
      settlementStatus = 'settled';
    }
  }

  const response = await handler({
    payment: {
      agentId: verification.agentId,
      mode: verification.mode,
    },
  });

  // Inject settlement info into response headers
  const enrichedHeaders = new Headers(response.headers);
  enrichedHeaders.set('X-Settlement-Status', settlementStatus);
  if (settlementTxHash) {
    enrichedHeaders.set('X-Settlement-TxHash', settlementTxHash);
  }
  enrichedHeaders.set('Access-Control-Expose-Headers', 'X-Settlement-Status, X-Settlement-TxHash');

  const enrichedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: enrichedHeaders,
  });
  await recordAgentMarketplaceRequest({
    agentId: verification.agentId,
    serviceKey: service.key,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    verificationResult: 'verified',
    success: enrichedResponse.ok,
    operatorAddress,
  });
  return enrichedResponse;
}
