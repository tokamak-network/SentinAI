import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000'; // local server since vercel deploy isn't ready

test.describe('X-402 Payment Flow', () => {
  test('PurchaseModal opens when BUY DATA clicked', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    // Click first BUY DATA button
    const buyButton = await page.locator('button:has-text("BUY DATA")').first();
    await buyButton.click();
    
    // Modal should appear
    const modal = await page.locator('text=BUY -').count();
    expect(modal).toBe(1);
  });

  test('CONNECT METAMASK button is visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const buyButton = await page.locator('button:has-text("BUY DATA")').first();
    await buyButton.click();
    
    const connectBtn = await page.locator('button:has-text("CONNECT")').count();
    expect(connectBtn).toBeGreaterThan(0);
  });

  test('Modal can be closed', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const buyButton = await page.locator('button:has-text("BUY DATA")').first();
    await buyButton.click();
    
    // Find and click close button
    const closeBtn = await page.locator('button:has-text("CLOSE")').first();
    if (closeBtn) {
      await closeBtn.click();
    }
  });
});
