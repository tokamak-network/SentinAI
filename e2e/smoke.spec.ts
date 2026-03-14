/**
 * Smoke Test: Verify Playwright setup works
 */
import { test, expect } from '@playwright/test';

test('smoke: can navigate to home page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SentinAI/);
});
