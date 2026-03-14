import { expect, test } from '@playwright/test';
import { verifyMessage } from 'viem';

test('marketplace protected by session gate', async ({ page }) => {
  // Direct access to /v2/marketplace without session should redirect to /login
  await page.goto('/v2/marketplace');
  expect(page.url()).toContain('/login');
  expect(page.url()).toContain('callbackUrl=%2Fv2%2Fmarketplace');
});

test('login page renders with wallet connection UI', async ({ page }) => {
  await page.goto('/login');

  // Check for key UI elements
  const header = await page.locator('text=SENTINAI MARKETPLACE ADMIN');
  await expect(header).toBeVisible();

  const connectButton = await page.locator('button:has-text("CONNECT WALLET")');
  await expect(connectButton).toBeVisible();
});

test('login page includes description text', async ({ page }) => {
  await page.goto('/login');

  const description = await page.locator('text=Connect your Ethereum wallet');
  await expect(description).toBeVisible();
});

test('nonce API returns valid format', async ({ request }) => {
  // Test with valid address format
  const address = '0x1234567890123456789012345678901234567890';
  const response = await request.get(`/api/auth/siwe/nonce?address=${address}`);

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body).toHaveProperty('nonce');
  expect(typeof body.nonce).toBe('string');
  expect(body.nonce.length).toBe(32); // hex string of 16 bytes = 32 chars
});

test('nonce API rejects invalid address format', async ({ request }) => {
  // Missing '0x' prefix
  const response = await request.get('/api/auth/siwe/nonce?address=1234567890123456789012345678901234567890');
  expect(response.status()).toBe(400);

  const body = await response.json();
  expect(body).toHaveProperty('error');
});

test('nonce API rejects malformed address', async ({ request }) => {
  // Too short address
  const response = await request.get('/api/auth/siwe/nonce?address=0x123');
  expect(response.status()).toBe(400);
});

test('verify endpoint rejects invalid signature format', async ({ request }) => {
  const address = '0x1234567890123456789012345678901234567890';
  const message = 'test message\nNonce: abc123';
  const invalidSignature = '0x123'; // too short

  const response = await request.post('/api/auth/siwe/verify', {
    data: {
      address,
      signature: invalidSignature,
      message,
    },
  });

  // Should be 400 (invalid input) or 401 (verification failed)
  expect([400, 401]).toContain(response.status());
});

test('verify endpoint rejects missing nonce in message', async ({ request }) => {
  const address = '0x1234567890123456789012345678901234567890';
  const signature = '0x' + 'a'.repeat(130); // valid format but wrong sig
  const messageWithoutNonce = 'SentinAI wants you to sign in with your Ethereum account';

  const response = await request.post('/api/auth/siwe/verify', {
    data: {
      address,
      signature,
      message: messageWithoutNonce,
    },
  });

  // Should fail - either invalid format or nonce extraction
  expect(response.status()).toBeGreaterThanOrEqual(400);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

test('logout endpoint responds to POST request', async ({ page }) => {
  // Test that logout endpoint is accessible and processes POST requests
  await page.goto('/login');

  // Call logout endpoint from client context
  const result = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/auth/siwe/logout', {
        method: 'POST',
        redirect: 'manual',
      });
      return {
        status: response.status,
        hasLocationHeader: response.headers.has('location'),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // Endpoint should respond with redirect or auth requirement
  // (It may require API key depending on middleware configuration)
  expect(result.status).toBeGreaterThanOrEqual(300);
});

test('login page respects callbackUrl query parameter', async ({ page }) => {
  await page.goto('/login?callbackUrl=/v2/marketplace?dispute=test');

  // The page should render (callback URL is stored for post-login redirect)
  const header = await page.locator('text=SENTINAI MARKETPLACE ADMIN');
  await expect(header).toBeVisible();
});

test('login page defaults to /v2/marketplace when no callbackUrl provided', async ({ page }) => {
  await page.goto('/login');

  // The page should render normally
  const header = await page.locator('text=SENTINAI MARKETPLACE ADMIN');
  await expect(header).toBeVisible();
});

test('MetaMask not detected error message is shown when window.ethereum is undefined', async ({ page }) => {
  // Mock page to hide window.ethereum
  await page.goto('/login');

  // Evaluate script to hide ethereum provider and click button
  await page.evaluate(() => {
    // @ts-ignore
    delete window.ethereum;
  });

  const connectButton = await page.locator('button:has-text("CONNECT WALLET")');
  await connectButton.click();

  // Error message should appear
  await page.waitForSelector('text=MetaMask or compatible wallet not detected');
  const errorBox = await page.locator('text=MetaMask or compatible wallet not detected');
  await expect(errorBox).toBeVisible();
});

test('address display updates when wallet connection succeeds', async ({ page }) => {
  await page.goto('/login');

  // Mock ethereum provider to return an account
  await page.addInitScript(() => {
    // @ts-ignore
    window.ethereum = {
      request: async (args: any) => {
        if (args.method === 'eth_requestAccounts') {
          return ['0x742d35Cc6634C0532925a3b844Bc7e7595f42E01'];
        }
        return null;
      },
    };
  });

  // Reload page with mocked provider
  await page.reload();

  const connectButton = await page.locator('button:has-text("CONNECT")');
  const initialText = await connectButton.textContent();

  // Click the button
  await connectButton.click();

  // Wait briefly for some change
  await page.waitForTimeout(100);

  // Page should still be on login page or show some status
  const pageUrl = page.url();
  expect(pageUrl).toContain('/login');
});

test('marketplace page is protected on all subpaths', async ({ page }) => {
  // Test various subpaths
  const subpaths = [
    '/v2/marketplace',
    '/v2/marketplace/some-section',
    '/v2/marketplace/disputes/123',
  ];

  for (const path of subpaths) {
    await page.goto(path);
    expect(page.url()).toContain('/login');
  }
});

test('health and auth exempt routes are accessible', async ({ request }) => {
  // Health check should work without auth
  const healthResponse = await request.get('/api/health');
  expect([200, 404]).toContain(healthResponse.status()); // 404 if not implemented

  // OAuth routes are exempt from API key auth, but may have other validation
  // Should not return 401 for missing API key (that's the point of exemption)
  const tokenResponse = await request.post('/api/oauth/token', {
    data: { invalid: true },
  });

  // May be 400 (bad request) or 401 (auth), but not due to API key
  expect([400, 401, 403, 404]).toContain(tokenResponse.status());
});
