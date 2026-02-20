const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, 'recordings');
const BASE = 'http://localhost:3002';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();

  console.log('[1/6] Loading dashboard...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, '01-dashboard-overview.png'), fullPage: false });
  console.log('  ✓ Dashboard screenshot taken');

  // Scroll down to show more content
  console.log('[2/6] Scrolling through dashboard...');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '02-dashboard-metrics.png'), fullPage: false });

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '03-dashboard-components.png'), fullPage: false });

  // Full page screenshot
  console.log('[3/6] Full page capture...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '04-dashboard-fullpage.png'), fullPage: true });
  console.log('  ✓ Full page screenshot taken');

  // Predictive Scaling - try to find seed selector
  console.log('[4/6] Testing Predictive Scaling...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  
  // Look for prediction section
  const predSection = await page.$('text=Predictive');
  if (predSection) {
    await predSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, '05-predictive-scaling.png') });
    console.log('  ✓ Predictive scaling screenshot');
  }

  // Try seed buttons
  const risingBtn = await page.$('button:has-text("rising")');
  if (risingBtn) {
    await risingBtn.click();
    await page.waitForTimeout(5000); // wait for AI analysis
    await page.screenshot({ path: path.join(OUT, '06-prediction-result.png') });
    console.log('  ✓ Prediction result screenshot');
  }

  // Cost report section
  console.log('[5/6] Cost Report...');
  const costSection = await page.$('text=Cost');
  if (costSection) {
    await costSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, '07-cost-report.png') });
    console.log('  ✓ Cost report screenshot');
  }

  // NLOps Chat
  console.log('[6/6] NLOps Chat...');
  const chatInput = await page.$('input[placeholder*="Ask"], textarea[placeholder*="Ask"], input[type="text"]');
  if (chatInput) {
    await chatInput.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await chatInput.fill('What is the current system status?');
    await page.screenshot({ path: path.join(OUT, '08-nlops-input.png') });
    
    // Press enter or find send button
    const sendBtn = await page.$('button:has-text("Send")') || await page.$('button[type="submit"]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await chatInput.press('Enter');
    }
    await page.waitForTimeout(8000); // wait for AI response
    await page.screenshot({ path: path.join(OUT, '09-nlops-response.png') });
    console.log('  ✓ NLOps chat screenshots');
  }

  // Final full-page
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  console.log('\nClosing browser and saving video...');
  await page.close(); // triggers video save
  await context.close();
  await browser.close();

  console.log(`\n✅ Done! Files saved to: ${OUT}`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
