import { expect, test } from '@playwright/test';

test.describe('pipeline screenshots', () => {
  test('capture pipeline in all states', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-pipeline-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // Wait for initial render + animations
    await page.waitForTimeout(3000);

    // 1. Idle state
    await panel.screenshot({ path: 'e2e-artifacts/pipeline-idle.png' });

    // 2. Spike seed → signal collecting
    await page.getByRole('button', { name: 'spike' }).click();
    await page.waitForTimeout(2000);
    await panel.screenshot({ path: 'e2e-artifacts/pipeline-signal.png' });

    // 3. Plan
    await page.getByRole('button', { name: 'Plan' }).click();
    await page.waitForTimeout(3000);
    await panel.screenshot({ path: 'e2e-artifacts/pipeline-planning.png' });

    // 4. Execute
    const execBtn = page.getByRole('button', { name: 'Execute' });
    if (await execBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
      await execBtn.click();
      await page.waitForTimeout(3000);
      await panel.screenshot({ path: 'e2e-artifacts/pipeline-executing.png' });
    }

    // 5. Full page
    await page.screenshot({ path: 'e2e-artifacts/pipeline-fullpage.png' });
  });
});
