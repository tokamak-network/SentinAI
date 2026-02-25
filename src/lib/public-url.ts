/**
 * Resolve the public-facing base URL from request headers.
 * In Docker/K8s, request.url contains the internal address (0.0.0.0:8080).
 * Use x-forwarded-host / x-forwarded-proto set by the ingress/load balancer instead.
 */
import type { NextRequest } from 'next/server';

export function getPublicBase(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const forwardedHost =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';

  // x-forwarded-host may contain multiple values (comma-separated); take the first
  const host = forwardedHost.split(',')[0].trim();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

  return `${forwardedProto}://${host}${basePath}`;
}
