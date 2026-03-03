import { expect, test } from '@playwright/test';

test.describe('autonomy pipeline', () => {
  test('updates success feedback and current level after policy level change', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-pipeline-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    const levelBadge = page.getByTestId('autonomy-current-level-badge');
    await expect(levelBadge).toBeVisible();

    const currentLevel = (await levelBadge.textContent())?.trim() || 'A2';
    const targetLevel = currentLevel === 'A3' ? 'A4' : 'A3';

    const targetButton = page.getByTestId(`autonomy-level-btn-${targetLevel}`);
    await expect(targetButton).toBeEnabled();
    await targetButton.click();

    const feedback = page.getByTestId('autonomy-action-feedback');
    await expect(feedback).toContainText(`Autonomy level set to ${targetLevel}`);
    await expect(levelBadge).toHaveText(targetLevel);
  });

  test('renders all 5 pipeline stages', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-pipeline-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    for (const stage of ['signal', 'goal', 'plan', 'act', 'verify']) {
      await expect(page.getByTestId(`pipeline-stage-${stage}`)).toBeVisible();
    }
  });
});
