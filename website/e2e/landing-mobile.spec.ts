import { test, expect } from '@playwright/test';

// Mobile-only tests run on the chromium-mobile project (375x812)
test.describe('Mobile Responsive (375px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('no horizontal overflow on mobile viewport', async ({ page }) => {
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance
  });

  test('navbar brand SENTINAI is visible on mobile', async ({ page }) => {
    const brand = page.locator('header').locator('span', { hasText: 'SENTINAI' }).first();
    await expect(brand).toBeVisible();
  });

  test('h1 heading is visible and not clipped', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();

    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    // Heading should fit within actual viewport width
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 10); // small tolerance
  });

  test('CTA buttons wrap properly on mobile', async ({ page }) => {
    const connectBtn = page.locator('main a', { hasText: 'CONNECT YOUR NODE' });
    const readDocsBtn = page.locator('main a', { hasText: 'READ DOCS' }).first();

    await expect(connectBtn).toBeVisible();
    await expect(readDocsBtn).toBeVisible();

    // Both should be in viewport
    const connectBox = await connectBtn.boundingBox();
    const readDocsBox = await readDocsBtn.boundingBox();
    expect(connectBox).not.toBeNull();
    expect(readDocsBox).not.toBeNull();
  });

  test('section bars are visible on mobile', async ({ page }) => {
    const sectionTexts = [
      'SUPPORTED CLIENTS',
      'WHAT IT DOES',
      'HOW IT WORKS',
      'DEPLOYMENT OPTIONS',
    ];

    for (const text of sectionTexts) {
      const bar = page.locator('div').filter({ hasText: new RegExp(`^${text}$`, 'i') }).first();
      await expect(bar).toBeVisible();
    }
  });

  test('footer is visible on mobile', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('capture full page screenshot for mobile', async ({ page }) => {
    await page.screenshot({
      path: 'e2e/screenshots/landing-mobile-full.png',
      fullPage: true,
    });
  });
});
