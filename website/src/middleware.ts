import { NextRequest, NextResponse } from 'next/server';

const ADMIN_SESSION_COOKIE_NAME = 'sentinai_admin_session';

/**
 * Verify HMAC-SHA256 signature using Web Crypto API
 * Edge Runtime compatible (no Node.js crypto module)
 */
async function verifyHmac(
  secret: string,
  data: string,
  providedHmac: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(data);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const hexSignature = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return hexSignature === providedHmac;
  } catch (error) {
    console.error('[Middleware] HMAC verification error:', error);
    return false;
  }
}

/**
 * Verify admin session token
 * Token format: admin_{address}_{issuedAt}_{expiresAt}_{hmac}
 */
async function verifyAdminSession(
  token: string,
  adminAddress: string | null
): Promise<boolean> {
  if (!token || !adminAddress) return false;

  try {
    const parts = token.split('_');
    if (parts.length !== 5 || parts[0] !== 'admin') return false;

    const [, addressStr, issuedAtStr, expiresAtStr, providedHmac] = parts;
    const address = `0x${addressStr}`;
    const issuedAt = parseInt(issuedAtStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);

    // Validate timestamp format
    if (isNaN(issuedAt) || isNaN(expiresAt)) return false;

    // Check expiration
    if (Date.now() > expiresAt) {
      console.debug('[Middleware] Session token expired', { address, expiresAt });
      return false;
    }

    // Verify address matches admin
    if (address.toLowerCase() !== adminAddress.toLowerCase()) {
      console.warn('[Middleware] Token address does not match admin', { address, adminAddress });
      return false;
    }

    // Verify HMAC
    const secret = process.env.MARKETPLACE_SESSION_KEY ?? 'website-admin-fallback-key';
    const data = `${address.toLowerCase()}:${issuedAt}:${expiresAt}`;
    const isValidHmac = await verifyHmac(secret, data, providedHmac);

    if (!isValidHmac) {
      console.warn('[Middleware] Token HMAC mismatch', { address });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Middleware] Session verification error:', error);
    return false;
  }
}

/**
 * Extract admin address from environment
 */
function getAdminAddress(): string | null {
  const adminKey = process.env.NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY?.trim();
  if (!adminKey) {
    console.warn('[Middleware] NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY not set');
    return null;
  }

  // Validate it's a valid address format
  if (!adminKey.startsWith('0x') || adminKey.length !== 42) {
    console.error('[Middleware] Invalid admin address format');
    return null;
  }

  return adminKey;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin/* routes
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Allow access to /admin/login without session
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  // Extract session cookie
  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const adminAddress = getAdminAddress();

  // Verify session
  const isValidSession = await verifyAdminSession(sessionToken || '', adminAddress);

  if (!isValidSession) {
    // Redirect to login with callback URL
    const callbackUrl = new URL('/admin/login', request.url);
    callbackUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(callbackUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
