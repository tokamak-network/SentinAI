import { defineConfig } from '@playwright/test';

const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_API_KEY = process.env.E2E_SENTINAI_API_KEY || 'sentinai-e2e-key';

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
    command: `npm run build && npm run start -- -p ${PORT}`,
    env: {
      ...process.env,
      SENTINAI_API_KEY: E2E_API_KEY,
      NEXT_PUBLIC_SENTINAI_API_KEY: E2E_API_KEY,
      NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE: 'false',
    },
    port: PORT,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
