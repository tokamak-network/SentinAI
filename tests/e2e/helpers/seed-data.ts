import { Page } from '@playwright/test';

/**
 * Seed metrics with specific scenario
 * @param page Playwright page object
 * @param scenario Data scenario (stable/rising/spike/falling/live)
 */
export async function seedMetrics(
  page: Page,
  scenario: 'stable' | 'rising' | 'spike' | 'falling' | 'live'
) {
  const response = await page.request.post(
    `/api/metrics/seed?scenario=${scenario}`
  );
  if (!response.ok()) {
    throw new Error(`Failed to seed metrics: ${response.status()}`);
  }
  return response.json();
}

/**
 * Wait for metrics update with polling
 * @param page Playwright page object
 * @param timeout Maximum time to wait in milliseconds (default: 5000ms)
 */
export async function waitForMetricsUpdate(
  page: Page,
  timeout: number = 5000
): Promise<any> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await page.request.get('/api/metrics?t=' + Date.now());
      if (response.ok()) {
        const data = await response.json();
        // Check if data contains expected fields
        if (data.metrics && data.cost) {
          return data;
        }
      }
    } catch (e) {
      lastError = e as Error;
    }

    // Wait 100ms before next attempt
    await page.waitForTimeout(100);
  }

  throw lastError || new Error(`Timeout waiting for metrics update (${timeout}ms)`);
}

/**
 * Wait for cost report API response
 * @param page Playwright page object
 * @param days Number of days for cost report (default: 7)
 * @param timeout Maximum time to wait in milliseconds (default: 10000ms)
 */
export async function waitForCostReport(
  page: Page,
  days: number = 7,
  timeout: number = 10000
): Promise<any> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await page.request.get(`/api/cost-report?days=${days}`);
      if (response.ok()) {
        const data = await response.json();
        // Check if data contains expected fields
        if (data.usagePatterns && data.recommendations !== undefined) {
          return data;
        }
      }
    } catch (e) {
      lastError = e as Error;
    }

    // Wait 200ms before next attempt
    await page.waitForTimeout(200);
  }

  throw lastError || new Error(`Timeout waiting for cost report (${timeout}ms)`);
}

/**
 * Seed stable data over multiple days for cost analysis
 * @param page Playwright page object
 * @param days Number of days to seed (default: 7)
 */
export async function seedStableData(
  page: Page,
  days: number = 7
): Promise<void> {
  // Seed initial stable data
  await seedMetrics(page, 'stable');

  // Wait for first update
  await waitForMetricsUpdate(page, 5000);

  // Additional seeds to build up historical data
  for (let i = 1; i < Math.min(days, 3); i++) {
    await page.waitForTimeout(500);
    await seedMetrics(page, 'stable');
  }

  // Wait for final update
  await waitForMetricsUpdate(page, 5000);
}
