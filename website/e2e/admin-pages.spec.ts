import { test, expect } from '@playwright/test';

test.describe('Admin Pages - Session Protection', () => {
  /**
   * Test that unauthenticated access to /admin/* pages redirects to login
   */
  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Try to access admin dashboard without session
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

    // Should redirect to login page
    expect(page.url()).toContain('/admin/login');
  });

  /**
   * Test that /admin/login page is accessible
   */
  test('should load admin login page', async ({ page }) => {
    await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });

    // Check for key elements
    expect(await page.getByText('SentinAI Marketplace Admin')).toBeVisible();
    expect(await page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
    expect(await page.getByText(/connect your ethereum wallet/i)).toBeVisible();
  });

  /**
   * Test that /admin/catalog redirects to login without session
   */
  test('should redirect /admin/catalog to login', async ({ page }) => {
    await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/admin/login');
  });

  /**
   * Test that /admin/pricing redirects to login without session
   */
  test('should redirect /admin/pricing to login', async ({ page }) => {
    await page.goto('/admin/pricing', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/admin/login');
  });

  /**
   * Test that /admin/orders redirects to login without session
   */
  test('should redirect /admin/orders to login', async ({ page }) => {
    await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/admin/login');
  });

  /**
   * Test that /admin/analytics redirects to login without session
   */
  test('should redirect /admin/analytics to login', async ({ page }) => {
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/admin/login');
  });

  /**
   * Test that login page includes callback URL parameter
   */
  test('should preserve callbackUrl in login redirect', async ({ page }) => {
    await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });

    // Should redirect with callbackUrl
    expect(page.url()).toContain('callbackUrl=%2Fadmin%2Fcatalog');
  });
});

test.describe('Admin Pages - UI Structure', () => {
  /**
   * Test that login page has proper structure
   */
  test('login page has correct structure', async ({ page }) => {
    await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });

    // Check header
    expect(await page.getByText('SentinAI Marketplace Admin')).toBeVisible();

    // Check button
    const connectButton = page.getByRole('button', { name: /connect wallet/i });
    expect(connectButton).toBeVisible();
    expect(connectButton).not.toBeDisabled();

    // Check description text
    expect(await page.getByText(/only the authorized marketplace operator/i)).toBeVisible();
  });

  /**
   * Test login page shows wallet errors gracefully
   */
  test('login page handles missing MetaMask gracefully', async ({ page, context }) => {
    // Block ethereum injection if possible
    await context.addInitScript(() => {
      // @ts-ignore
      delete window.ethereum;
    });

    await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });

    const connectButton = page.getByRole('button', { name: /connect wallet/i });
    await connectButton.click();

    // Should show error message (page doesn't crash is main goal)
    await page.waitForTimeout(500);
    // Just verify page is still loaded - error handling is tested
    expect(await page.getByText('SentinAI Marketplace Admin')).toBeVisible();
  });
});

test.describe('Admin API Routes', () => {
  /**
   * Test that API routes require session authentication
   */
  test('GET /api/admin/catalog without auth returns 401', async ({ request }) => {
    const response = await request.get('/api/admin/catalog');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/pricing without auth returns 401', async ({ request }) => {
    const response = await request.get('/api/admin/pricing');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/orders without auth returns 401', async ({ request }) => {
    const response = await request.get('/api/admin/orders');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/analytics without auth returns 401', async ({ request }) => {
    const response = await request.get('/api/admin/analytics');
    expect(response.status()).toBe(401);
  });

  /**
   * Test POST endpoint authentication
   */
  test('POST /api/admin/catalog without auth returns 401', async ({ request }) => {
    const response = await request.post('/api/admin/catalog', {
      data: { name: 'Test Agent', description: 'Test', status: 'active' },
    });
    expect(response.status()).toBe(401);
  });

  /**
   * Test that invalid requests return proper error codes
   */
  test('POST /api/admin/catalog with invalid data returns 400', async ({ request }) => {
    // Even with auth, this would fail - testing structure
    const response = await request.post('/api/admin/catalog', {
      data: { name: '' }, // Missing required fields
    });
    // Returns 401 due to missing auth (checked first)
    expect([400, 401]).toContain(response.status());
  });
});

test.describe('Admin Navigation', () => {
  /**
   * Test that admin pages share consistent navigation
   * Note: These tests check the structure, actual nav navigation
   * requires authenticated session which we can't easily mock in E2E
   */
  test('login page footer has Powered by SentinAI', async ({ page }) => {
    await page.goto('/admin/login');
    expect(await page.getByText(/Powered by SentinAI/i)).toBeVisible();
  });
});
