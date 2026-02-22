import { expect, test } from '@playwright/test';

test.describe('autonomy cockpit', () => {
  test('정책 레벨 변경 시 성공 피드백과 현재 레벨이 갱신된다', async ({ page }) => {
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
    await expect(feedback).toContainText(`자율 레벨을 ${targetLevel}로 변경했습니다.`);
    await expect(levelBadge).toHaveText(targetLevel);
  });

  test('정책 레벨 버튼 hover 시 권한/가드레일 툴팁이 노출된다', async ({ page }) => {
    await page.goto('/');

    const panel = page.getByTestId('autonomy-cockpit-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    const levelButton = page.getByTestId('autonomy-level-btn-A4');
    await levelButton.hover();

    const tooltip = page.getByTestId('autonomy-level-tooltip-A4');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('권한');
    await expect(tooltip).toContainText('가드레일');
  });
});
