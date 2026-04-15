import { expect, test } from '@playwright/test';

/**
 * Deployment verification tests
 * Run against live deployed environment:
 *   DEPLOY_URL=https://dashboard.example.com npx playwright test e2e/deploy-test.spec.ts
 */

const DEPLOY_URL = process.env.DEPLOY_URL || 'http://localhost:3002';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://sentinai-xi.vercel.app';

test.describe('Deployment Health Check', () => {
  test('root app responds to health check', async ({ request }) => {
    const response = await request.get(`${DEPLOY_URL}/api/health`);
    expect([200, 404]).toContain(response.status());
  });

  test('marketplace is protected by session gate', async ({ page }) => {
    await page.goto(`${DEPLOY_URL}/v2/marketplace`);
    expect(page.url()).toContain('/login');
    expect(page.url()).toContain('callbackUrl=%2Fv2%2Fmarketplace');
  });

  test('login page renders with SIWE UI', async ({ page }) => {
    await page.goto(`${DEPLOY_URL}/login`);
    const header = await page.locator('text=SENTINAI Marketplace Admin').first();
    await expect(header).toBeVisible();
  });

  test('nonce API works on deployed environment', async ({ request }) => {
    const address = '0x1234567890123456789012345678901234567890';
    const response = await request.get(
      `${DEPLOY_URL}/api/auth/siwe/nonce?address=${address}`
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('nonce');
    expect(typeof body.nonce).toBe('string');
  });

  test('logout endpoint accessible', async ({ request }) => {
    const response = await request.post(`${DEPLOY_URL}/api/auth/siwe/logout`);
    // Should redirect or require auth
    expect([303, 401]).toContain(response.status());
  });
});

test.describe('Website App Integration', () => {
  test('website landing page loads', async ({ page }) => {
    await page.goto(WEBSITE_URL);
    const sentinai = await page.locator('text=SENTINAI').first();
    await expect(sentinai).toBeVisible();
  });

  test('website navbar has ADMIN link', async ({ page }) => {
    await page.goto(WEBSITE_URL);
    const adminLink = await page.locator('a:has-text("ADMIN")');
    await expect(adminLink).toBeVisible();

    const href = await adminLink.getAttribute('href');
    expect(href).toContain('/login');
  });

  test('ADMIN link navigates to root app login', async ({ page }) => {
    await page.goto(WEBSITE_URL);
    const adminLink = await page.locator('a:has-text("ADMIN")');
    await adminLink.click();

    // Should navigate to root app login
    await page.waitForNavigation();
    expect(page.url()).toContain('/login');
  });
});

test.describe('SIWE Auth Flow (Manual Test)', () => {
  test('MetaMask not detected shows error message', async ({ page }) => {
    await page.goto(`${DEPLOY_URL}/login`);

    // Remove ethereum provider
    await page.evaluate(() => {
      // @ts-expect-error: window.ethereum is not in the standard type definitions
      delete window.ethereum;
    });

    const connectBtn = await page.locator('button:has-text("CONNECT WALLET")');
    await connectBtn.click();

    const errorMsg = await page.locator('text=MetaMask or compatible wallet not detected');
    await expect(errorMsg).toBeVisible();
  });

  test('login page displays correctly styled UI', async ({ page }) => {
    await page.goto(`${DEPLOY_URL}/login`);

    const header = await page.locator('div:has-text("SENTINAI Marketplace Admin")');
    await expect(header).toHaveCSS('background', /221, 0, 0|#D40000|rgb\(212, 0, 0\)/);

    const button = await page.locator('button:has-text("CONNECT WALLET")');
    await expect(button).toBeVisible();

    const description = await page.locator('text=Connect your Ethereum wallet');
    await expect(description).toBeVisible();
  });

  test('callbackUrl parameter is respected', async ({ page }) => {
    const callbackUrl = encodeURIComponent('/v2/marketplace?tab=disputes');
    await page.goto(`${DEPLOY_URL}/login?callbackUrl=${callbackUrl}`);

    const header = await page.locator('text=SENTINAI Marketplace Admin');
    await expect(header).toBeVisible();
    // After successful SIWE (manual), user should redirect to callbackUrl
  });
});
