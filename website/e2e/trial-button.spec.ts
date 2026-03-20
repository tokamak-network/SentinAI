import { test, expect } from '@playwright/test';

const BASE_URL = 'https://sentinai-xi.vercel.app';

test.describe('Free Trial Button', () => {
  test('TRY FREE button renders for each service', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const buttons = await page.locator('button:has-text("TRY FREE")').count();
    expect(buttons).toBeGreaterThan(0);
  });
  
  test('Free calls counter displays correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const counter = await page.locator('text=free calls remaining').count();
    expect(counter).toBeGreaterThan(0);
  });
  
  test('TRY FREE button is clickable', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    
    const firstButton = await page.locator('button:has-text("TRY FREE")').first();
    await firstButton.click();
    
    // Check for result message
    const result = await page.locator('text=Mock data received').count();
    expect(result).toBe(1);
  });
});
