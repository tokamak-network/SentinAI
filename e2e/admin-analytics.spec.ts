import { test, expect } from '@playwright/test';

test.describe('Admin Analytics Page', () => {
  test('loads metrics and charts', async ({ page }) => {
    await page.goto('/admin/analytics');
    
    // Check header
    await expect(page.locator('h1', { hasText: 'Analytics' })).toBeVisible();
    
    // Check merchant filter
    await expect(page.locator('select', { hasText: 'All Merchants' })).toBeVisible();
    
    // Wait for data to load
    await page.waitForSelector('text=Total Transactions');
    
    // Check metrics cards
    await expect(page.locator('div', { hasText: 'Total Transactions' }).first()).toBeVisible();
    await expect(page.locator('div', { hasText: 'Total Volume' }).first()).toBeVisible();
    await expect(page.locator('div', { hasText: 'Success Rate' }).first()).toBeVisible();
    await expect(page.locator('div', { hasText: 'Avg Amount' }).first()).toBeVisible();
    
    // Check charts sections
    await expect(page.locator('h2', { hasText: 'Daily Volume' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Cumulative Revenue' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Revenue by Product' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Transaction Status' })).toBeVisible();
  });
});
