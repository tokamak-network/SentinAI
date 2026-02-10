import { test, expect } from '@playwright/test';

test.describe('NLOps Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });
  });

  // ============================================================
  // Chat Open / Close
  // ============================================================

  test('should open and close chat panel', async ({ page }) => {
    // Toggle button should be visible
    const toggle = page.getByTestId('chat-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('SentinAI 어시스턴트');

    // Open chat
    await toggle.click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();

    // Welcome message should appear
    await expect(page.getByTestId('chat-welcome')).toBeVisible();

    // Toggle button should be hidden when panel is open
    await expect(toggle).not.toBeVisible();

    // Close chat
    await page.getByTestId('chat-close').click();
    await expect(panel).not.toBeVisible();

    // Toggle button visible again
    await expect(toggle).toBeVisible();
  });

  // ============================================================
  // Welcome State & Example Buttons
  // ============================================================

  test('should show example buttons and send on click', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();
    await expect(page.getByTestId('chat-panel')).toBeVisible();

    // Three example buttons
    const examples = ['현재 상태', '로그 분석 해줘', '비용 확인'];
    for (const text of examples) {
      await expect(page.getByTestId(`chat-example-${text}`)).toBeVisible();
    }

    // Click "현재 상태" example
    await page.getByTestId('chat-example-현재 상태').click();

    // User message should appear
    const userMsg = page.getByTestId('chat-msg-user');
    await expect(userMsg.first()).toBeVisible({ timeout: 5000 });

    // Loading indicator should appear briefly
    // Then assistant response should arrive
    await expect(page.getByTestId('chat-msg-assistant').first()).toBeVisible({ timeout: 60000 });

    // Welcome should disappear after first message
    await expect(page.getByTestId('chat-welcome')).not.toBeVisible();
  });

  // ============================================================
  // Text Input & Send
  // ============================================================

  test('should send typed message and receive response', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    const input = page.getByTestId('chat-input');
    const sendBtn = page.getByTestId('chat-send');

    // Send button disabled when input empty
    await expect(sendBtn).toBeDisabled();

    // Type a message
    await input.fill('이상 현황 보여줘');
    await expect(sendBtn).toBeEnabled();

    // Send
    await sendBtn.click();

    // Input should be cleared
    await expect(input).toHaveValue('');

    // User message appears
    await expect(page.getByTestId('chat-msg-user').first()).toBeVisible();

    // Wait for assistant response
    const assistantMsg = page.getByTestId('chat-msg-assistant').first();
    await expect(assistantMsg).toBeVisible({ timeout: 60000 });
  });

  test('should send message with Enter key', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    const input = page.getByTestId('chat-input');
    await input.fill('현재 상태');
    await input.press('Enter');

    // User message appears
    await expect(page.getByTestId('chat-msg-user').first()).toBeVisible({ timeout: 5000 });

    // Assistant responds
    await expect(page.getByTestId('chat-msg-assistant').first()).toBeVisible({ timeout: 60000 });
  });

  // ============================================================
  // Confirmation Flow (scale / config)
  // ============================================================

  test('should show confirmation bar for dangerous actions', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    const input = page.getByTestId('chat-input');
    await input.fill('2 vCPU로 스케일해줘');
    await page.getByTestId('chat-send').click();

    // Wait for assistant response (confirmation request)
    await expect(page.getByTestId('chat-msg-assistant').first()).toBeVisible({ timeout: 60000 });

    // Confirmation bar should appear
    const confirmation = page.getByTestId('chat-confirmation');
    await expect(confirmation).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('chat-confirmation-msg')).toContainText('스케일링');

    // Confirm and Cancel buttons visible
    await expect(page.getByTestId('chat-confirm-btn')).toBeVisible();
    await expect(page.getByTestId('chat-cancel-btn')).toBeVisible();

    // Input should be disabled during confirmation
    await expect(input).toBeDisabled();
  });

  test('should cancel confirmation and restore input', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    await page.getByTestId('chat-input').fill('자동 스케일링 꺼줘');
    await page.getByTestId('chat-send').click();

    // Wait for confirmation bar
    await expect(page.getByTestId('chat-confirmation')).toBeVisible({ timeout: 60000 });

    // Click cancel
    await page.getByTestId('chat-cancel-btn').click();

    // Confirmation should disappear
    await expect(page.getByTestId('chat-confirmation')).not.toBeVisible();

    // Input should be enabled again
    await expect(page.getByTestId('chat-input')).toBeEnabled();

    // Cancel message should appear from assistant
    const assistantMessages = page.getByTestId('chat-msg-assistant');
    const count = await assistantMessages.count();
    expect(count).toBeGreaterThanOrEqual(2); // confirmation + cancellation
  });

  test('should execute action after confirmation', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    await page.getByTestId('chat-input').fill('2 vCPU로 스케일해줘');
    await page.getByTestId('chat-send').click();

    // Wait for confirmation bar
    await expect(page.getByTestId('chat-confirmation')).toBeVisible({ timeout: 60000 });

    // Click confirm
    await page.getByTestId('chat-confirm-btn').click();

    // Confirmation should disappear
    await expect(page.getByTestId('chat-confirmation')).not.toBeVisible({ timeout: 5000 });

    // Wait for execution response
    await page.waitForTimeout(1000);
    const assistantMessages = page.getByTestId('chat-msg-assistant');
    const count = await assistantMessages.count();
    // Should have: initial confirmation message + execution result
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // ============================================================
  // Multiple Messages (conversation)
  // ============================================================

  test('should maintain conversation history', async ({ page }) => {
    await page.getByTestId('chat-toggle').click();

    // Send first message
    const input = page.getByTestId('chat-input');
    await input.fill('현재 상태');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-msg-assistant').first()).toBeVisible({ timeout: 60000 });

    // Send second message
    await input.fill('비용 확인');
    await page.getByTestId('chat-send').click();

    // Wait for second response
    await page.waitForTimeout(2000);
    const userMessages = page.getByTestId('chat-msg-user');
    const assistantMessages = page.getByTestId('chat-msg-assistant');

    // Should have 2 user + at least 2 assistant messages
    await expect(userMessages).toHaveCount(2, { timeout: 60000 });
    const assistantCount = await assistantMessages.count();
    expect(assistantCount).toBeGreaterThanOrEqual(2);
  });
});
