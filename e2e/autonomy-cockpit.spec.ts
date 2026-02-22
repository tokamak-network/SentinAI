import { expect, test } from '@playwright/test';

test.describe('autonomy cockpit', () => {
  test('updates success feedback and current level after policy level change', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-cockpit-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    const levelBadge = page.getByTestId('autonomy-current-level-badge');
    await expect(levelBadge).toBeVisible();

    const currentLevel = (await levelBadge.textContent())?.trim() || 'A2';
    const targetLevel = currentLevel === 'A3' ? 'A4' : 'A3';

    const targetButton = page.getByTestId(`autonomy-level-btn-${targetLevel}`);
    await expect(targetButton).toBeEnabled();
    await targetButton.click();

    const feedback = page.getByTestId('autonomy-action-feedback');
    await expect(feedback).toContainText(`Autonomy level changed to ${targetLevel}.`);
    await expect(levelBadge).toHaveText(targetLevel);
  });

  test('shows permission and guardrail tooltip when hovering policy level button', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-cockpit-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    const levelButton = page.getByTestId('autonomy-level-btn-A4');
    await levelButton.hover();

    const tooltip = page.getByTestId('autonomy-level-tooltip-A4');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Permission');
    await expect(tooltip).toContainText('Guardrail');
  });
});
