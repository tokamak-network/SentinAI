/**
 * E2E Test Fixture: Admin Session Management
 * Provides helpers to authenticate test sessions without MetaMask
 */

import { createHmac } from 'crypto';
import { getAddress } from 'viem';

export const ADMIN_SESSION_COOKIE_NAME = 'sentinai_admin_session';
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// Test admin address (used during E2E tests)
const TEST_ADMIN_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3';

function getHmacSecret(): string {
  return process.env.MARKETPLACE_SESSION_KEY ?? 'website-admin-fallback-key';
}

function computeHmac(
  address: string,
  issuedAt: number,
  expiresAt: number
): string {
  const secret = getHmacSecret();
  const data = `${address.toLowerCase()}:${issuedAt}:${expiresAt}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Generate a valid admin session token for E2E testing
 */
export function generateTestSessionToken(adminAddress: string = TEST_ADMIN_ADDRESS): string {
  const checksumAddress = getAddress(adminAddress as `0x${string}`);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ADMIN_SESSION_TTL_MS;

  const hmac = computeHmac(checksumAddress, issuedAt, expiresAt);
  return `admin_${checksumAddress.toLowerCase()}_${issuedAt}_${expiresAt}_${hmac}`;
}

/**
 * Set admin session cookie in browser context
 */
export async function setAdminSessionCookie(
  page: any,
  adminAddress: string = TEST_ADMIN_ADDRESS
): Promise<void> {
  const token = generateTestSessionToken(adminAddress);

  await page.context().addCookies([
    {
      name: ADMIN_SESSION_COOKIE_NAME,
      value: token,
      domain: new URL(page.url()).hostname || 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Navigate directly to admin dashboard with authenticated session
 */
export async function navigateToAdminDashboard(
  page: any,
  baseURL: string = 'http://localhost:3002'
): Promise<void> {
  // Set session cookie before navigation
  await setAdminSessionCookie(page);

  // Navigate to admin dashboard
  await page.goto(`${baseURL}/admin`);

  // Wait for dashboard to load
  await page.waitForLoadState('networkidle');
}

/**
 * Navigate to a specific admin page with authenticated session
 */
export async function navigateToAdminPage(
  page: any,
  path: string,
  baseURL: string = 'http://localhost:3002'
): Promise<void> {
  await setAdminSessionCookie(page);
  await page.goto(`${baseURL}${path}`);
  await page.waitForLoadState('networkidle');
}

/**
 * Clear admin session cookie
 */
export async function clearAdminSession(page: any): Promise<void> {
  await page.context().clearCookies({
    name: ADMIN_SESSION_COOKIE_NAME,
  });
}
