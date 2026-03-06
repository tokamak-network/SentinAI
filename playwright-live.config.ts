import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  globalTimeout: 600_000,
  use: {
    baseURL: 'https://sentinai.tokamak.network/thanos-sepolia',
    trace: 'off',
    headless: true,
  },
});
