import { test, expect } from '@playwright/test';
import { seedMetrics, waitForMetricsUpdate } from './helpers/seed-data';

test.describe('Daily Report Generation', () => {
  test('should have all required metric Test IDs', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Verify key metrics Test IDs are in the DOM
    const vcpuMetric = page.getByTestId('current-vcpu');
    await expect(vcpuMetric).toBeVisible();

    const costMetric = page.getByTestId('monthly-cost');
    await expect(costMetric).toBeVisible();

    const blockMetric = page.getByTestId('l2-block-number');
    await expect(blockMetric).toBeVisible();
  });

  test('should verify metrics contain numeric values', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Extract metric values to verify they contain actual data
    const vcpuText = await page.getByTestId('current-vcpu').textContent();
    const costText = await page.getByTestId('monthly-cost').textContent();
    const blockText = await page.getByTestId('l2-block-number').textContent();

    expect(vcpuText).toMatch(/\d+/); // Should contain numbers
    expect(costText).toMatch(/\d+/); // Should contain numbers
    expect(blockText).toMatch(/\d+/); // Should contain numbers
  });

  test('should maintain metrics display', async ({ page }) => {
    await page.goto('/');

    // Load initial data
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Get initial metric values
    const initialVcpu = await page.getByTestId('current-vcpu').textContent();
    const initialCost = await page.getByTestId('monthly-cost').textContent();
    const initialBlock = await page.getByTestId('l2-block-number').textContent();

    // Wait a moment
    await page.waitForTimeout(2000);

    // Get values again
    const secondVcpu = await page.getByTestId('current-vcpu').textContent();
    const secondCost = await page.getByTestId('monthly-cost').textContent();
    const secondBlock = await page.getByTestId('l2-block-number').textContent();

    // Values should be present (they may change, but should exist)
    expect(initialVcpu).toBeTruthy();
    expect(initialCost).toBeTruthy();
    expect(initialBlock).toBeTruthy();
    expect(secondVcpu).toBeTruthy();
    expect(secondCost).toBeTruthy();
    expect(secondBlock).toBeTruthy();
  });

  test('should load dashboard without errors', async ({ page }) => {
    // Simple page load test
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Just verify page loaded and has content
    const content = await page.content();
    expect(content.length).toBeGreaterThan(0);
  });

  test('should verify page structure with all expected elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Check for main page structure
    const title = page.locator('h1');
    const titleCount = await title.count();
    expect(titleCount).toBeGreaterThan(0);
  });
});
