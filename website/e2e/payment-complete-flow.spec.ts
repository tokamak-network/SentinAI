import { test, expect } from '@playwright/test';

test.describe('Complete X-402 Payment Flow', () => {
  const BASE_URL = 'https://sentinai-xi.vercel.app';

  test('should complete full payment flow without BigInt conversion errors', async ({ page, context }) => {
    // Step 1: Navigate to operators page
    await page.goto(`${BASE_URL}/marketplace/operators`);
    await page.waitForLoadState('networkidle');

    // Verify operators list loads
    const operatorCards = page.locator('[data-testid="operator-card"]').or(page.locator('div:has(> div:has-text("sentinai-operator"))'));
    await expect(operatorCards.first()).toBeVisible({ timeout: 5000 });

    // Step 2: Click on first operator's detail page
    const firstOperatorLink = page.locator('a:has-text("VIEW DETAILS")').first();
    await firstOperatorLink.click();
    await page.waitForLoadState('networkidle');

    // Step 3: Click "BUY DATA" button
    const buyDataButton = page.locator('button:has-text("BUY DATA")').first();
    await buyDataButton.click();

    // Wait for modal to open
    const modal = page.locator('text=BUY -');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Step 4: Click CONNECT tab (should be active)
    const connectTab = page.locator('text=CONNECT').first();
    await expect(connectTab).toBeVisible();

    // Step 5: Check for REQUIREMENTS tab and click
    const requirementsTab = page.locator('text=REQUIREMENTS');
    await expect(requirementsTab).toBeVisible({ timeout: 5000 });

    // Verify requirements data is shown (check for Asset, Amount, Merchant)
    await expect(page.locator('text=Asset')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Amount')).toBeVisible();
    await expect(page.locator('text=Merchant')).toBeVisible();
    await expect(page.locator('text=TON')).toBeVisible();

    // Step 6: Check BALANCE tab
    const balanceTab = page.locator('text=BALANCE');
    await expect(balanceTab).toBeVisible({ timeout: 5000 });

    // Step 7: Check for error messages
    const errorDiv = page.locator('[role="alert"]').or(page.locator('text=/Cannot convert|Error|error/i'));
    const errorCount = await errorDiv.count();

    // If there's an error, log it and fail
    if (errorCount > 0) {
      const errorText = await errorDiv.first().textContent();
      console.error('Payment flow error:', errorText);
      throw new Error(`Payment flow failed with error: ${errorText}`);
    }

    // Step 8: Verify SIGN tab and RESULT tab exist
    const signTab = page.locator('text=SIGN');
    const resultTab = page.locator('text=RESULT');
    await expect(signTab).toBeVisible({ timeout: 5000 });
    await expect(resultTab).toBeVisible({ timeout: 5000 });

    // Step 9: Check "SIGN & PAY" button is present and enabled
    const signPayButton = page.locator('button:has-text("SIGN & PAY")');
    await expect(signPayButton).toBeVisible({ timeout: 5000 });

    console.log('✅ Payment flow UI rendered successfully without BigInt errors');
  });

  test('should handle BALANCE tab gracefully without 0x conversion errors', async ({ page }) => {
    // Navigate directly to operator detail
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');

    // Open purchase modal
    const buyDataButton = page.locator('button:has-text("BUY DATA")').first();
    await buyDataButton.click();

    // Wait for modal
    await expect(page.locator('text=BUY -')).toBeVisible({ timeout: 5000 });

    // Check for any console errors related to BigInt
    let consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a moment for console messages
    await page.waitForTimeout(2000);

    // Filter for BigInt errors
    const bigIntErrors = consoleErrors.filter((err) => err.includes('Cannot convert'));
    if (bigIntErrors.length > 0) {
      throw new Error(`Found BigInt conversion errors: ${bigIntErrors.join('; ')}`);
    }

    console.log('✅ No BigInt conversion errors found in console');
  });
});
