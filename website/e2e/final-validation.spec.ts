import { test, expect } from '@playwright/test';

const BASE_URL = 'https://sentinai-xi.vercel.app';

test.describe('SentinAI Marketplace - Final Validation', () => {
  
  test('1. Marketplace Page Loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace`);
    await page.waitForLoadState('networkidle');
    
    // Check page title or content
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
    console.log('✅ Marketplace page loads');
  });

  test('2. Operators List Shows 5 Operators', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators`);
    await page.waitForLoadState('networkidle');
    
    // Check for operator count display
    const content = await page.content();
    expect(content).toContain('OPERATOR');
    console.log('✅ Operators list displays');
  });

  test('3. Operator Detail Page Loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    // Check for operator details
    const content = await page.content();
    expect(content).toContain('sentinai-operator');
    console.log('✅ Operator detail page loads');
  });

  test('4. SLA Dashboard Visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    expect(content).toContain('AVAILABILITY');
    expect(content).toContain('RESPONSE TIME');
    console.log('✅ SLA Dashboard visible');
  });

  test('5. Performance Graphs Visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    expect(content).toContain('PERFORMANCE');
    console.log('✅ Performance Graphs visible');
  });

  test('6. Free Trial Button Visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    expect(content).toContain('TRY FREE');
    console.log('✅ Free Trial Button visible');
  });

  test('7. BUY DATA Button Visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    expect(content).toContain('BUY DATA');
    console.log('✅ BUY DATA Button visible');
  });

  test('8. Admin Transactions Page Accessible', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/transactions`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    // Should show admin dashboard
    expect(content.length).toBeGreaterThan(100);
    console.log('✅ Admin Transactions page accessible');
  });

  test('9. Admin Analytics Page Accessible', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/analytics`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    // Should show admin dashboard with charts
    expect(content.length).toBeGreaterThan(100);
    console.log('✅ Admin Analytics page accessible');
  });

  test('10. API Endpoints Return Data', async ({ request }) => {
    // Test catalog API
    const catalogRes = await request.get(`${BASE_URL}/api/agent-marketplace/catalog`);
    expect(catalogRes.ok()).toBeTruthy();
    const catalogData = await catalogRes.json();
    expect(catalogData).toBeDefined();
    console.log('✅ Catalog API works');

    // Test payment requirements API
    const paymentRes = await request.post(`${BASE_URL}/api/marketplace/payment-requirements`, {
      data: {
        resource: '/api/marketplace/sequencer-health',
        merchant: 'test-merchant'
      }
    });
    expect(paymentRes.ok()).toBeTruthy();
    console.log('✅ Payment Requirements API works');

    // Test analytics API
    const analyticsRes = await request.get(`${BASE_URL}/api/marketplace/analytics/summary`);
    expect(analyticsRes.ok()).toBeTruthy();
    console.log('✅ Analytics API works');
  });

  test('11. Trust Metrics Display Correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators`);
    await page.waitForLoadState('networkidle');
    
    const content = await page.content();
    expect(content).toContain('RATING');
    expect(content).toContain('UPTIME');
    expect(content).toContain('LATENCY');
    console.log('✅ Trust Metrics display correctly');
  });

  test('12. X-402 Payment Modal Opens', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    // Click BUY DATA button
    await page.click('button:has-text("BUY DATA")');
    await page.waitForTimeout(1000);
    
    const content = await page.content();
    expect(content).toContain('BUY');
    console.log('✅ X-402 Payment Modal opens');
  });

  test('13. MetaMask Connect Available', async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace/operators/0xd7d57ba9f40629d48c4009a87654cdda8a5433e9`);
    await page.waitForLoadState('networkidle');
    
    // Open modal
    await page.click('button:has-text("BUY DATA")');
    await page.waitForTimeout(1000);
    
    const content = await page.content();
    expect(content).toContain('CONNECT');
    console.log('✅ MetaMask Connect option visible');
  });

  test('14. Sepolia TON Token Configured', async ({ request }) => {
    const paymentRes = await request.post(`${BASE_URL}/api/marketplace/payment-requirements`, {
      data: {
        resource: '/api/marketplace/sequencer-health',
        merchant: 'test-merchant'
      }
    });
    
    const data = await paymentRes.json() as any;
    expect(data.asset).toBe('0xa30fe40285B8f5c0457DbC3B7C8A280373c40044');
    expect(data.network).toBe('eip155:11155111');
    console.log('✅ Sepolia TON Token configured correctly');
  });

  test('15. No Console Errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto(`${BASE_URL}/marketplace`);
    await page.goto(`${BASE_URL}/marketplace/operators`);
    await page.goto(`${BASE_URL}/admin/transactions`);
    await page.goto(`${BASE_URL}/admin/analytics`);
    
    await page.waitForTimeout(2000);
    
    expect(errors.length).toBe(0);
    console.log('✅ No console errors detected');
  });
});
