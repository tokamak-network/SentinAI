/**
 * Playwright Configuration for Vercel Deployment Testing
 *
 * Use this config to run E2E tests against a deployed Vercel instance
 *
 * Usage:
 *   VERCEL_URL=https://sentinai-dashboard.vercel.app npx playwright test --config=playwright.vercel.config.ts
 */

import { defineConfig } from '@playwright/test';

const VERCEL_URL = process.env.VERCEL_URL || 'http://localhost:3002';
const BASE_URL = VERCEL_URL.startsWith('http') ? VERCEL_URL : `https://${VERCEL_URL}`;

console.log(`📡 Testing against: ${BASE_URL}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 30000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-vercel' }],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // NOTE: We don't start a webServer here since we're testing a deployed instance
  // If testing locally, use playwright.config.ts instead

  projects: [
    {
      name: 'chromium',
      use: { ...{}, browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { ...{}, browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { ...{}, browserName: 'webkit' },
    },
  ],
});
