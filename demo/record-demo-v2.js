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

  console.log('[1/7] Loading dashboard...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, '01-dashboard-overview.png') });
  console.log('  ✓ Dashboard overview');

  // Scroll through sections
  console.log('[2/7] Dashboard sections...');
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '02-dashboard-mid.png') });

  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '03-dashboard-bottom.png') });

  // Full page
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '04-fullpage.png'), fullPage: true });
  console.log('  ✓ Full page');

  // Predictive Scaling - use the actual select + button
  console.log('[3/7] Predictive Scaling...');
  // Find the seed scenario select by its onChange handler
  const seedSelect = await page.$('select');
  if (seedSelect) {
    await seedSelect.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await seedSelect.selectOption('rising');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '05-seed-select.png') });
    console.log('  ✓ Seed selector set to "rising"');

    // Click the seed button
    const seedBtn = await page.$('button:has-text("Seed")');
    if (seedBtn) {
      await seedBtn.click();
      console.log('  → Waiting for AI prediction...');
      await page.waitForTimeout(8000); // wait for AI
      await page.screenshot({ path: path.join(OUT, '06-prediction-result.png') });
      console.log('  ✓ Prediction result');
    }
  } else {
    console.log('  ✗ Seed select not found');
  }

  // Cost section
  console.log('[4/7] Cost Report...');
  const costHeading = await page.$('text=Cost');
  if (costHeading) {
    await costHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, '07-cost-section.png') });
    console.log('  ✓ Cost section');
  }

  // NLOps Chat - open it
  console.log('[5/7] Opening NLOps Chat...');
  const chatBtn = await page.$('[data-testid="chat-open"]') || await page.$('button:has-text("NLOps")') || await page.$('button:has-text("Chat")');
  // Try clicking the MessageSquare button area at bottom
  const allButtons = await page.$$('button');
  let chatOpened = false;
  for (const btn of allButtons) {
    const text = await btn.textContent();
    if (text && (text.includes('NLOps') || text.includes('Chat') || text.includes('💬'))) {
      await btn.click();
      chatOpened = true;
      break;
    }
  }
  // Fallback: click by setChatOpen
  if (!chatOpened) {
    // The chat toggle is likely a fixed button at bottom-right
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.querySelector('svg') && b.className.includes('fixed')) {
          b.click();
          return;
        }
      }
      // last resort: find by position (bottom-right fixed button)
      const fixed = document.querySelector('.fixed.bottom-6.right-6') || document.querySelector('[class*="fixed"][class*="bottom"]');
      if (fixed) fixed.click();
    });
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '08-chat-opened.png') });
  console.log('  ✓ Chat panel');

  // Try example buttons first
  console.log('[6/7] NLOps example query...');
  const exampleBtn = await page.$('[data-testid^="chat-example"]');
  if (exampleBtn) {
    await exampleBtn.click();
    console.log('  → Waiting for AI response...');
    await page.waitForTimeout(10000);
    await page.screenshot({ path: path.join(OUT, '09-chat-example-response.png') });
    console.log('  ✓ Example response');
  } else {
    // Type manually
    const chatInputEl = await page.$('[data-testid="chat-input"]');
    if (chatInputEl) {
      await chatInputEl.fill('What is the current system status?');
      await page.screenshot({ path: path.join(OUT, '09-chat-typing.png') });
      const sendBtn = await page.$('[data-testid="chat-send"]');
      if (sendBtn) await sendBtn.click();
      else await chatInputEl.press('Enter');
      console.log('  → Waiting for AI response...');
      await page.waitForTimeout(10000);
      await page.screenshot({ path: path.join(OUT, '10-chat-response.png') });
      console.log('  ✓ Chat response');
    }
  }

  // Second query
  console.log('[7/7] Second NLOps query...');
  const chatInputEl2 = await page.$('[data-testid="chat-input"]');
  if (chatInputEl2) {
    await chatInputEl2.fill('How can we reduce costs?');
    const sendBtn2 = await page.$('[data-testid="chat-send"]');
    if (sendBtn2) await sendBtn2.click();
    else await chatInputEl2.press('Enter');
    await page.waitForTimeout(10000);
    await page.screenshot({ path: path.join(OUT, '11-chat-cost-response.png') });
    console.log('  ✓ Cost query response');
  }

  // Scroll back to top for video ending
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);

  console.log('\nSaving video...');
  await page.close();
  await context.close();
  await browser.close();

  console.log(`\n✅ Done! Files in: ${OUT}`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
