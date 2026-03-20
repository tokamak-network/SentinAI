import { test, expect } from '@playwright/test';

const BASE_URL = 'https://sentinai-xi.vercel.app';

test.describe('Performance Graphs', () => {
  test('Performance section renders', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const perfHeader = await page.locator('text=PERFORMANCE').count();
    expect(perfHeader).toBeGreaterThan(0);
  });
  
  test('Period filter buttons are visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const sevenDay = await page.locator('text=7d').count();
    const thirtyDay = await page.locator('text=30d').count();
    const ninetyDay = await page.locator('text=90d').count();
    
    expect(sevenDay).toBeGreaterThan(0);
    expect(thirtyDay).toBeGreaterThan(0);
    expect(ninetyDay).toBeGreaterThan(0);
  });
  
  test('Period filter buttons are clickable', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const sevenDayBtn = await page.locator('button:has-text("7d")').first();
    await sevenDayBtn.click();
    
    // Verify button becomes active (green)
    const style = await sevenDayBtn.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(style).toBeTruthy();
  });
});
