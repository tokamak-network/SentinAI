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
    command: `npx next build && npx next start -- -p ${PORT}`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SENTINAI_API_KEY: E2E_API_KEY,
      NEXT_PUBLIC_SENTINAI_API_KEY: E2E_API_KEY,
      NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE: 'false',
      NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3',
      MARKETPLACE_SESSION_KEY: 'e2e-test-secret-key-for-session-hmac',
    },
    port: PORT,
    timeout: 300_000,
    reuseExistingServer: !!(process.env.PW_REUSE_SERVER) || false,
  },
});
