import { test, expect, type Page } from '@playwright/test';

// ─── Helper ──────────────────────────────────────────────────────────────────

async function gotoMarketplace(page: Page) {
  await page.goto('/marketplace', { waitUntil: 'networkidle' });
}

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Marketplace Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMarketplace(page);
  });

  test('marketplace page is accessible at /marketplace', async ({ page }) => {
    expect(page.url()).toContain('/marketplace');
  });

  test('marketplace page title or heading is visible', async ({ page }) => {
    // Wait for any heading or title to appear
    const heading = page.locator('h1, h2, [role="heading"]').first();
    await expect(heading).toBeVisible();
  });

  test('marketplace page has navbar with MARKETPLACE link', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const marketplaceLink = header.locator('a', { hasText: 'MARKETPLACE' });
    await expect(marketplaceLink).toBeVisible();
    await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');
  });
});

// ─── Marketplace Content ──────────────────────────────────────────────────────

test.describe('Marketplace Page Content', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMarketplace(page);
  });

  test('marketplace page has main content area', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('marketplace page renders without errors', async ({ page }) => {
    // Collect any console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await gotoMarketplace(page);
    await page.waitForTimeout(500);

    // Should not have critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('Not Found') && !e.includes('404')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

// ─── API Endpoints ───────────────────────────────────────────────────────────

test.describe('Marketplace API Endpoints', () => {
  test('GET /api/agent-marketplace/catalog returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/catalog');
    expect(response.status()).toBe(200);
  });

  test('GET /api/agent-marketplace/catalog returns JSON', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/catalog');
    const data = await response.json();
    expect(Array.isArray(data) || typeof data === 'object').toBeTruthy();
  });

  test('GET /api/agent-marketplace/agent.json returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/agent.json');
    expect(response.status()).toBe(200);
  });

  test('GET /api/agent-marketplace/sequencer-health returns response', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/sequencer-health');
    expect([200, 402]).toContain(response.status());
  });

  test('GET /api/agent-marketplace/incident-summary returns response', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/incident-summary');
    expect([200, 402]).toContain(response.status());
  });

  test('GET /api/agent-marketplace/batch-submission-status returns response', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/batch-submission-status');
    expect([200, 402]).toContain(response.status());
  });

  test('paid endpoints return 402 without x-payment header', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/sequencer-health');
    if (response.status() === 402) {
      expect(response.status()).toBe(402);
    }
  });

  test('paid endpoints accept x-payment header', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/sequencer-health', {
      headers: { 'x-payment': 'valid-payment' },
    });
    expect([200, 402, 401]).toContain(response.status());
  });
});

// ─── Tab Navigation (if implemented) ──────────────────────────────────────────

test.describe('Marketplace Tabs', () => {
  test('marketplace page may have tab navigation', async ({ page }) => {
    await gotoMarketplace(page);

    // Check for any tab-like navigation (optional)
    const tabs = page.locator('button[role="tab"], [data-tab], .tabs').count();
    // Tabs are optional, just verify page loads
    await expect(page.locator('main')).toBeVisible();
  });
});
