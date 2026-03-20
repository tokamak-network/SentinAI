import { test, expect } from '@playwright/test';

const BASE_URL = 'https://sentinai-xi.vercel.app';

test.describe('SLA Dashboard', () => {
  test('SLA Dashboard renders for each service', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    // Check SLA sections exist
    const slaHeaders = await page.locator('text=SLA GUARANTEES').count();
    expect(slaHeaders).toBeGreaterThan(0);
  });
  
  test('Availability gauge displays correct values', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    // Check availability percentage
    const availText = await page.locator('text=Availability:').first().textContent();
    expect(availText).toContain('%');
  });
  
  test('Support Level badge is visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    // Check support level badges
    const badges = await page.locator('text=24/7 Premium').count();
    expect(badges).toBeGreaterThan(0);
  });
});