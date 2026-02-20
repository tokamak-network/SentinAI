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

  console.log('[1] Loading dashboard (waiting up to 60s for content)...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for the "Connecting to Cluster..." to disappear and real content to load
  try {
    await page.waitForSelector('text=Block Height', { timeout: 45000 });
    console.log('  ✓ Dashboard loaded');
  } catch {
    console.log('  ⚠ Timed out waiting for Block Height, continuing anyway...');
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'v3-01-overview.png') });

  // Scroll to predictive section
  console.log('[2] Predictive Scaling...');
  const predText = await page.$('text=Predictive Scaling');
  if (predText) {
    await predText.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    
    // The select element for seed scenario
    const selects = await page.$$('select');
    console.log(`  Found ${selects.length} select elements`);
    for (const sel of selects) {
      const options = await sel.$$('option');
      for (const opt of options) {
        const val = await opt.getAttribute('value');
        if (val === 'rising') {
          await sel.selectOption('rising');
          console.log('  ✓ Selected "rising" scenario');
          break;
        }
      }
    }
    await page.screenshot({ path: path.join(OUT, 'v3-02-seed-select.png') });

    // Find and click the Seed/Run button near the select
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && (text.includes('Seed') || text.includes('Run') || text.includes('Predict'))) {
        await btn.click();
        console.log(`  → Clicked "${text.trim()}" button, waiting for AI...`);
        await page.waitForTimeout(10000);
        break;
      }
    }
    await page.screenshot({ path: path.join(OUT, 'v3-03-prediction.png') });
  } else {
    console.log('  ✗ Predictive Scaling section not found');
  }

  // Anomaly / RCA section
  console.log('[3] Anomaly & RCA...');
  const anomalyText = await page.$('text=Anomal');
  if (anomalyText) {
    await anomalyText.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, 'v3-04-anomaly.png') });
    
    // Look for RCA button
    const rcaBtns = await page.$$('button');
    for (const btn of rcaBtns) {
      const text = await btn.textContent();
      if (text && (text.includes('RCA') || text.includes('Root Cause') || text.includes('Analyze'))) {
        await btn.click();
        console.log(`  → Clicked "${text.trim()}", waiting for AI...`);
        await page.waitForTimeout(10000);
        await page.screenshot({ path: path.join(OUT, 'v3-05-rca-result.png') });
        break;
      }
    }
  }

  // Cost section
  console.log('[4] Cost Report...');
  const costText = await page.$('text=Cost');
  if (costText) {
    await costText.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, 'v3-06-cost.png') });
  }

  // NLOps Chat
  console.log('[5] NLOps Chat...');
  // Find the chat open button (fixed position, bottom-right)
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const rect = b.getBoundingClientRect();
      // Look for button near bottom-right corner (chat toggle)
      if (rect.bottom > window.innerHeight - 100 && rect.right > window.innerWidth - 100) {
        b.click();
        return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(1500);

  // Check if chat panel is open by looking for chat-input
  let chatInput = await page.$('[data-testid="chat-input"]');
  if (!chatInput) {
    // Try clicking any button with MessageSquare or chat icon
    await page.evaluate(() => {
      const all = document.querySelectorAll('button.fixed, button[class*="fixed"]');
      if (all.length) all[all.length - 1].click();
    });
    await page.waitForTimeout(1000);
    chatInput = await page.$('[data-testid="chat-input"]');
  }

  if (chatInput) {
    await page.screenshot({ path: path.join(OUT, 'v3-07-chat-open.png') });
    console.log('  ✓ Chat panel open');

    // Try example button first
    const exBtn = await page.$('[data-testid^="chat-example"]');
    if (exBtn) {
      const exText = await exBtn.textContent();
      console.log(`  → Clicking example: "${exText}"`);
      await exBtn.click();
      await page.waitForTimeout(12000);
      await page.screenshot({ path: path.join(OUT, 'v3-08-chat-response.png') });
      console.log('  ✓ Chat example response');
    } else {
      await chatInput.fill('What is the current system status?');
      const sendBtn = await page.$('[data-testid="chat-send"]');
      if (sendBtn) await sendBtn.click();
      await page.waitForTimeout(12000);
      await page.screenshot({ path: path.join(OUT, 'v3-08-chat-response.png') });
      console.log('  ✓ Chat response');
    }
  } else {
    console.log('  ✗ Chat input not found');
  }

  // Final overview
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'v3-09-final.png') });

  console.log('\nSaving video...');
  await page.close();
  await context.close();
  await browser.close();
  console.log(`\n✅ Done! ${OUT}`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
