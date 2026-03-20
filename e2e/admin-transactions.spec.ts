import { test, expect } from '@playwright/test';

test.describe('Admin Transactions Page', () => {
  test('loads transactions and shows filters', async ({ page }) => {
    await page.goto('/admin/transactions');
    
    // Check header
    await expect(page.locator('h1', { hasText: 'Transactions' })).toBeVisible();
    
    // Check filters
    await expect(page.locator('input[placeholder="Search by buyer address..."]')).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible(); // Status filter
    await expect(page.locator('select').nth(1)).toBeVisible(); // Merchant filter
    
    // Table should be visible
    await expect(page.locator('table')).toBeVisible();
    
    // Headers should be present
    await expect(page.locator('th', { hasText: 'Buyer' })).toBeVisible();
    await expect(page.locator('th', { hasText: 'Amount' })).toBeVisible();
    await expect(page.locator('th', { hasText: 'Status' })).toBeVisible();
  });
});
