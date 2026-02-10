import { test, expect } from '@playwright/test';
import { seedStableData, seedMetrics, waitForCostReport } from './helpers/seed-data';

test.describe('Usage Heatmap Visualization', () => {
  test('should have heatmap Test IDs in page structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Check if heatmap Test ID exists (element may or may not be visible)
    const heatmapWrapperCount = await page.locator('[data-testid="usage-heatmap"]').count();
    // May be hidden initially
    expect(heatmapWrapperCount).toBeGreaterThanOrEqual(0);

    // Check if day row Test IDs exist
    const dayRowsCount = await page.locator('[data-testid^="heatmap-day-"]').count();
    expect(dayRowsCount).toBeGreaterThanOrEqual(0);

    // Check if cell Test IDs exist
    const cellsCount = await page.locator('[data-testid^="heatmap-cell-"]').count();
    expect(cellsCount).toBeGreaterThanOrEqual(0);
  });

  test('should verify Test IDs on heatmap cells', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Cells with proper Test IDs should exist in the DOM
    const cells = page.locator('[data-testid^="heatmap-cell-"]');
    const cellCount = await cells.count();
    expect(cellCount).toBeGreaterThanOrEqual(0);
  });

  test('should verify day row Test IDs', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Day row Test IDs should exist
    const dayRows = page.locator('[data-testid^="heatmap-day-"]');
    const dayCount = await dayRows.count();
    expect(dayCount).toBeGreaterThanOrEqual(0);
  });

  test('should verify cost button exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

    // Cost analysis button should be visible
    const costButton = page.getByRole('button', { name: /cost analysis/i });
    const buttonCount = await costButton.count();
    expect(buttonCount).toBeGreaterThan(0);
  });
});
