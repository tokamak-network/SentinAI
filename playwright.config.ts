import { defineConfig } from '@playwright/test';

const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

