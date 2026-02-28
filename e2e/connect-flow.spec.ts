import { test, expect } from '@playwright/test';
import { startMockJsonRpcServer } from './mock-rpc-server';
import fs from 'fs';

test('connect flow: onboarding + redirect to dashboard', async ({ page }) => {
  const mock = await startMockJsonRpcServer();
  try {
    await page.goto('/connect');

    await page.getByLabel('Node type').selectOption('ethereum-el');
    await page.getByLabel('URL').fill(mock.url);

    await page.getByRole('button', { name: 'Test + Onboard' }).click();

    // Redirect should land on /v2
    await page.waitForURL('**/v2', { timeout: 20_000 });

    fs.mkdirSync('e2e-artifacts', { recursive: true });
    await page.screenshot({ path: 'e2e-artifacts/connect-success.png', fullPage: true });

    // Basic sanity: dashboard shows title-ish text
    await expect(page.getByText('SentinAI', { exact: false })).toBeVisible();
  } finally {
    await mock.close();
  }
});
