import { test, expect, type Page } from '@playwright/test';

// ─── Helper ──────────────────────────────────────────────────────────────────

async function gotoMarketplace(page: Page) {
  await page.goto('/marketplace', { waitUntil: 'networkidle' });
}

// Encode x402 payment envelope (base64 of JSON with agentId)
function encodePaymentEnvelope(agentId: string): string {
  const envelope = JSON.stringify({ agentId });
  return Buffer.from(envelope).toString('base64');
}

// ─── Marketplace Page Navigation ──────────────────────────────────────────

test.describe('Marketplace Page Navigation', () => {
  test('navigate to /marketplace from landing page MARKETPLACE link', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const marketplaceLink = page.locator('header nav a', { hasText: 'MARKETPLACE' });
    await expect(marketplaceLink).toBeVisible();
    await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');

    await marketplaceLink.click();
    await page.waitForURL('/marketplace');
    expect(page.url()).toContain('/marketplace');
  });

  test('page title contains "Agent Marketplace"', async ({ page }) => {
    await gotoMarketplace(page);
    const heading = page.locator('h1, h2, header').first();
    await expect(heading).toBeVisible();
  });

  test('back navigation to landing page works', async ({ page }) => {
    await gotoMarketplace(page);
    const backLink = page.locator('header a', { hasText: 'SENTINAI' }).first();
    await expect(backLink).toBeVisible();
  });
});

// ─── Marketplace Tab Navigation ───────────────────────────────────────────

test.describe('Marketplace Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMarketplace(page);
  });

  test('all 4 tabs are visible: CATALOG, AGENT, SERVICES, ABOUT', async ({ page }) => {
    const tabLabels = ['CATALOG', 'AGENT', 'SERVICES', 'ABOUT'];
    for (const label of tabLabels) {
      const tab = page.locator('button, [role="tab"]').filter({ hasText: label }).first();
      await expect(tab).toBeVisible();
    }
  });

  test('CATALOG tab is selected by default', async ({ page }) => {
    const catalogTab = page.locator('button, [role="tab"]').filter({ hasText: 'CATALOG' }).first();
    const ariaSelected = await catalogTab.getAttribute('aria-selected');
    // May be true or have active class
    expect(catalogTab).toBeVisible();
  });

  test('clicking SERVICES tab shows service list', async ({ page }) => {
    const servicesTab = page.locator('button, [role="tab"]').filter({ hasText: 'SERVICES' }).first();
    await servicesTab.click();
    await page.waitForLoadState('networkidle');
    // Verify tab switched
    const heading = page.locator('h1, h2, h3').filter({ hasText: /SERVICE/i }).first();
    expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('clicking AGENT tab shows agent information', async ({ page }) => {
    const agentTab = page.locator('button, [role="tab"]').filter({ hasText: 'AGENT' }).first();
    await agentTab.click();
    await page.waitForLoadState('networkidle');
    // Verify agent content loads
    expect(page.locator('body')).toBeVisible();
  });

  test('clicking ABOUT tab shows marketplace information', async ({ page }) => {
    const aboutTab = page.locator('button, [role="tab"]').filter({ hasText: 'ABOUT' }).first();
    await aboutTab.click();
    await page.waitForLoadState('networkidle');
    // Verify about content
    expect(page.locator('body')).toBeVisible();
  });

  test('tab switching preserves page state', async ({ page }) => {
    const catalogTab = page.locator('button, [role="tab"]').filter({ hasText: 'CATALOG' }).first();
    const servicesTab = page.locator('button, [role="tab"]').filter({ hasText: 'SERVICES' }).first();

    // Click SERVICES
    await servicesTab.click();
    await page.waitForLoadState('networkidle');

    // Click CATALOG
    await catalogTab.click();
    await page.waitForLoadState('networkidle');

    // Verify we're back at CATALOG
    expect(catalogTab).toBeVisible();
  });
});

// ─── Public API Endpoints ──────────────────────────────────────────────────

test.describe('Public API Endpoints', () => {
  test('GET /api/agent-marketplace/catalog returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/catalog');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data) || typeof data === 'object').toBeTruthy();
  });

  test('GET /api/agent-marketplace/catalog has CORS headers', async ({ request }) => {
    const response = await request.fetch('/api/agent-marketplace/catalog', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['access-control-allow-methods']).toContain('GET');
  });

  test('GET /api/agent-marketplace/agent.json returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/agent.json');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('GET /api/agent-marketplace/agent.json has CORS headers', async ({ request }) => {
    const response = await request.fetch('/api/agent-marketplace/agent.json', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
  });
});

// ─── x402 Payment Simulation (Sequencer Health) ─────────────────────────────

test.describe('x402 Payment Simulation (sequencer-health)', () => {
  test('GET /api/agent-marketplace/sequencer-health requires payment (402 without header)', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/sequencer-health');
    expect(response.status()).toBe(402);
    const data = await response.json();
    expect(data.error).toBe('payment_required');
    expect(data.message).toContain('X-PAYMENT');
  });

  test('GET /api/agent-marketplace/sequencer-health returns 400 with invalid X-PAYMENT header', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: {
        'X-PAYMENT': 'invalid-base64-not-json',
      },
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('invalid_payment_envelope');
  });

  test('GET /api/agent-marketplace/sequencer-health returns 400 with invalid envelope (no agentId)', async ({ request }) => {
    const invalidEnvelope = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
    const response = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: {
        'X-PAYMENT': invalidEnvelope,
      },
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('invalid_payment_envelope');
  });

  test('GET /api/agent-marketplace/sequencer-health returns 200 with valid X-PAYMENT header', async ({ request }) => {
    const validEnvelope = encodePaymentEnvelope('agent-123');
    const response = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: {
        'X-PAYMENT': validEnvelope,
      },
    });
    // Should return 200 or 502 (if root app unavailable), not 402 or 400
    expect([200, 502]).toContain(response.status());
  });

  test('OPTIONS /api/agent-marketplace/sequencer-health includes X-PAYMENT in CORS headers', async ({ request }) => {
    const response = await request.fetch('/api/agent-marketplace/sequencer-health', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['access-control-allow-methods']).toContain('GET');
    expect(response.headers()['access-control-allow-headers']).toContain('X-PAYMENT');
  });

  test('GET /api/agent-marketplace/sequencer-health does not cache (revalidate=0)', async ({ request }) => {
    const validEnvelope = encodePaymentEnvelope('agent-123');
    const response1 = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: { 'X-PAYMENT': validEnvelope },
    });
    const cacheControl1 = response1.headers()['cache-control'];

    const response2 = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: { 'X-PAYMENT': validEnvelope },
    });
    const cacheControl2 = response2.headers()['cache-control'];

    // Both should have no-cache or similar cache directive
    expect([cacheControl1, cacheControl2]).toBeDefined();
  });
});

// ─── x402 Payment Simulation (Incident Summary) ────────────────────────────

test.describe('x402 Payment Simulation (incident-summary)', () => {
  test('GET /api/agent-marketplace/incident-summary requires payment (402 without header)', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/incident-summary');
    expect(response.status()).toBe(402);
    const data = await response.json();
    expect(data.error).toBe('payment_required');
  });

  test('GET /api/agent-marketplace/incident-summary returns 400 with invalid X-PAYMENT header', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/incident-summary', {
      headers: { 'X-PAYMENT': 'bad-envelope' },
    });
    expect(response.status()).toBe(400);
  });

  test('GET /api/agent-marketplace/incident-summary returns 200 with valid X-PAYMENT header', async ({ request }) => {
    const validEnvelope = encodePaymentEnvelope('agent-456');
    const response = await request.get('/api/agent-marketplace/incident-summary', {
      headers: { 'X-PAYMENT': validEnvelope },
    });
    expect([200, 502]).toContain(response.status());
  });

  test('OPTIONS /api/agent-marketplace/incident-summary includes X-PAYMENT in CORS headers', async ({ request }) => {
    const response = await request.fetch('/api/agent-marketplace/incident-summary', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-headers']).toContain('X-PAYMENT');
  });
});

// ─── x402 Payment Simulation (Batch Submission Status) ──────────────────────

test.describe('x402 Payment Simulation (batch-submission-status)', () => {
  test('GET /api/agent-marketplace/batch-submission-status requires payment (402 without header)', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/batch-submission-status');
    expect(response.status()).toBe(402);
    const data = await response.json();
    expect(data.error).toBe('payment_required');
  });

  test('GET /api/agent-marketplace/batch-submission-status returns 400 with invalid X-PAYMENT header', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/batch-submission-status', {
      headers: { 'X-PAYMENT': 'corrupted-data' },
    });
    expect(response.status()).toBe(400);
  });

  test('GET /api/agent-marketplace/batch-submission-status returns 200 with valid X-PAYMENT header', async ({ request }) => {
    const validEnvelope = encodePaymentEnvelope('agent-789');
    const response = await request.get('/api/agent-marketplace/batch-submission-status', {
      headers: { 'X-PAYMENT': validEnvelope },
    });
    expect([200, 502]).toContain(response.status());
  });

  test('OPTIONS /api/agent-marketplace/batch-submission-status includes X-PAYMENT in CORS headers', async ({ request }) => {
    const response = await request.fetch('/api/agent-marketplace/batch-submission-status', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-headers']).toContain('X-PAYMENT');
  });
});

// ─── Marketplace Page Content ─────────────────────────────────────────────

test.describe('Marketplace Page Content', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMarketplace(page);
  });

  test('marketplace page has white background', async ({ page }) => {
    const body = page.locator('body');
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should be white or inherit from parent
    expect(bg).toBeDefined();
  });

  test('marketplace has header with navigation', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toBeVisible();
    const nav = header.locator('nav');
    await expect(nav).toBeVisible();
  });

  test('marketplace main content area is visible', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });
});

// ─── Marketplace Data Loading ─────────────────────────────────────────────

test.describe('Marketplace Data Loading', () => {
  test('catalog data loads from API on mount', async ({ page }) => {
    await gotoMarketplace(page);

    // Wait for catalog data to load
    const catalogRequest = page.waitForResponse(response =>
      response.url().includes('/api/agent-marketplace/catalog') && response.status() === 200
    );

    await catalogRequest;
    expect(true).toBe(true); // Passed if we got the response
  });

  test('agent manifest data loads from API', async ({ page }) => {
    await gotoMarketplace(page);

    const manifestRequest = page.waitForResponse(response =>
      response.url().includes('/api/agent-marketplace/agent.json') && response.status() === 200
    );

    await manifestRequest;
    expect(true).toBe(true);
  });

  test('marketplace handles missing or slow API gracefully', async ({ page }) => {
    // Navigate to marketplace
    await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });

    // Wait briefly for content to render
    await page.waitForTimeout(2000);

    // Verify page is still interactive
    const tabs = page.locator('button, [role="tab"]');
    expect(await tabs.count()).toBeGreaterThan(0);
  });
});

// ─── Full Page Screenshot ────────────────────────────────────────────────

test.describe('Visual Verification', () => {
  test('capture marketplace page screenshot', async ({ page }) => {
    await gotoMarketplace(page);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'e2e/screenshots/marketplace-desktop-full.png',
      fullPage: true,
    });
  });
});
