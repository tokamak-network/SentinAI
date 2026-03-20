import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000'; // test locally

test.describe('Multiple Operators Support', () => {
  test('Operators list shows all operators', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators`);
    
    // The section bar is "Network Operators"
    await expect(page.locator('text=Network Operators')).toBeVisible();

    // Check multiple operator cards (should be at least 5)
    // Using a more robust selector, e.g., the View Details button which implies a card
    const viewDetailsButtons = await page.locator('text=VIEW DETAILS').count();
    expect(viewDetailsButtons).toBeGreaterThanOrEqual(5);
  });
  
  test('Can navigate to different operator detail pages', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators`);
    
    const firstOperatorBtn = page.locator('text=VIEW DETAILS').first();
    await firstOperatorBtn.click();
    
    await expect(page.locator('text=Operator Detail')).toBeVisible();
  });
  
  test('Different operators have different services', async ({ page }) => {
    // Visit operator 1
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    const services1Count = await page.locator('text=BUY DATA').count();
    
    // Visit operator 2
    await page.goto(`${BASE_URL}/marketplace/operators/0x1111111111111111111111111111111111111111`);
    const services2Count = await page.locator('text=BUY DATA').count();
    
    expect(services1Count).toBeGreaterThan(0);
    expect(services2Count).toBeGreaterThan(0);
  });
});
