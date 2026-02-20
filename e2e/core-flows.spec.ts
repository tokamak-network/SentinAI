import { expect, test } from '@playwright/test';

test('home page renders core title', async ({ page }) => {
  await page.goto('/');
  const body = (await page.textContent('body')) || '';
  expect(
    body.includes('SentinAI') || body.includes('Connecting to Cluster')
  ).toBeTruthy();
});

test('v2 page is reachable', async ({ page }) => {
  const response = await page.goto('/v2');
  expect(response?.ok()).toBeTruthy();
});

test('health api returns ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body).toHaveProperty('status');
});
