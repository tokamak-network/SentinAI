const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'recordings');
const BASE = 'http://localhost:3002';
fs.mkdirSync(OUT, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();

  // ---- 1. LOAD DASHBOARD ----
  console.log('[1/6] Loading dashboard...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for the dashboard to actually render (metrics loaded)
  // The page shows "Connecting to Cluster..." then switches to real content
  // Wait for the data-testid="l2-block-number" to appear
  try {
    await page.waitForSelector('[data-testid="l2-block-number"]', { timeout: 30000 });
    console.log('  ✓ Dashboard content loaded');
  } catch {
    // If timeout, page might still be on "Connecting" - check what we have
    console.log('  ⚠ Block number not found, waiting extra...');
    await sleep(5000);
  }
  await sleep(3000); // let animations settle
  await page.screenshot({ path: path.join(OUT, 'full-01-overview.png') });
  console.log('  ✓ Screenshot: overview');

  // ---- 2. SCROLL THROUGH DASHBOARD ----
  console.log('[2/6] Dashboard tour...');
  // Smooth scroll down
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
    await sleep(1500);
  }
  await page.screenshot({ path: path.join(OUT, 'full-02-scrolled.png') });
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(2000);

  // ---- 3. PREDICTIVE SCALING ----
  console.log('[3/6] Predictive Scaling...');
  // Find the select element - it's the seed scenario selector
  const selectEl = await page.$('select');
  if (selectEl) {
    await selectEl.scrollIntoViewIfNeeded();
    await sleep(1000);
    
    // Select "rising" scenario
    await selectEl.selectOption('rising');
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'full-03-seed-rising.png') });
    console.log('  ✓ Selected "rising"');
    
    // Click the "Seed" button
    const seedBtn = await page.$('button:text-is("Seed")');
    if (seedBtn) {
      await seedBtn.click();
      console.log('  → AI analyzing...');
      await sleep(10000); // wait for prediction
      await page.screenshot({ path: path.join(OUT, 'full-04-prediction.png') });
      console.log('  ✓ Prediction result');
    } else {
      // Try broader search
      const btns = await page.$$('button');
      for (const b of btns) {
        const t = await b.textContent();
        if (t && t.trim() === 'Seed') {
          await b.click();
          console.log('  → AI analyzing (alt)...');
          await sleep(10000);
          await page.screenshot({ path: path.join(OUT, 'full-04-prediction.png') });
          console.log('  ✓ Prediction result');
          break;
        }
      }
    }

    // Now try "spike" scenario
    await selectEl.selectOption('spike');
    await sleep(500);
    const seedBtn2 = await page.$('button:text-is("Seed")') || (await page.$$('button')).find(async b => (await b.textContent())?.trim() === 'Seed');
    if (seedBtn2) {
      const btns = await page.$$('button');
      for (const b of btns) {
        const t = await b.textContent();
        if (t && t.trim() === 'Seed') {
          await b.click();
          console.log('  → Spike scenario...');
          await sleep(10000);
          await page.screenshot({ path: path.join(OUT, 'full-05-spike.png') });
          console.log('  ✓ Spike result');
          break;
        }
      }
    }
  } else {
    console.log('  ✗ Select element not found');
  }

  // ---- 4. COST REPORT ----
  console.log('[4/6] Cost Report...');
  // Find cost report button by data-testid or text
  const costBtns = await page.$$('button');
  for (const btn of costBtns) {
    const text = await btn.textContent();
    if (text && (text.includes('Generate') || text.includes('Report') || text.includes('Cost'))) {
      await btn.scrollIntoViewIfNeeded();
      await sleep(500);
      // Check if it's the cost report button (near monthly cost section)
      const isNearCost = await btn.evaluate(el => {
        const parent = el.closest('[data-testid]') || el.parentElement?.parentElement;
        return parent?.textContent?.includes('Monthly') || parent?.textContent?.includes('Cost');
      });
      if (isNearCost || text.includes('Report') || text.includes('Generate')) {
        await btn.click();
        console.log(`  → Generating cost report...`);
        await sleep(8000);
        await page.screenshot({ path: path.join(OUT, 'full-06-cost-report.png') });
        console.log('  ✓ Cost report');
        break;
      }
    }
  }

  // ---- 5. NLOPS CHAT ----
  console.log('[5/6] NLOps Chat...');
  // Click the chat toggle button
  const chatToggle = await page.$('[data-testid="chat-toggle"]');
  if (chatToggle) {
    await chatToggle.click();
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'full-07-chat-open.png') });
    console.log('  ✓ Chat panel opened');

    // Click "현재 상태" example button
    const exBtn = await page.$('[data-testid="chat-example-현재 상태"]');
    if (exBtn) {
      await exBtn.click();
      console.log('  → "현재 상태" query...');
      await sleep(12000);
      await page.screenshot({ path: path.join(OUT, 'full-08-chat-status.png') });
      console.log('  ✓ Status response');
    }

    // Type second query
    await sleep(2000);
    const chatInput = await page.$('[data-testid="chat-input"]');
    if (chatInput) {
      await chatInput.fill('비용 확인');
      await sleep(500);
      const sendBtn = await page.$('[data-testid="chat-send"]');
      if (sendBtn) await sendBtn.click();
      console.log('  → "비용 확인" query...');
      await sleep(12000);
      await page.screenshot({ path: path.join(OUT, 'full-09-chat-cost.png') });
      console.log('  ✓ Cost response');
    }

    // Close chat
    const closeBtn = await page.$('[data-testid="chat-close"]');
    if (closeBtn) await closeBtn.click();
    await sleep(1000);
  } else {
    console.log('  ✗ Chat toggle not found');
  }

  // ---- 6. FINAL OVERVIEW ----
  console.log('[6/6] Final overview...');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'full-10-final.png') });
  await page.screenshot({ path: path.join(OUT, 'full-11-fullpage.png'), fullPage: true });
  console.log('  ✓ Final screenshots');

  // Close and save video
  console.log('\nSaving video...');
  const videoPath = await page.video()?.path();
  await page.close();
  await context.close();
  await browser.close();

  // Rename video
  if (videoPath && fs.existsSync(videoPath)) {
    const dest = path.join(OUT, 'sentinai-full-demo.webm');
    fs.copyFileSync(videoPath, dest);
    console.log(`Video saved: ${dest}`);
    
    // Convert to mp4
    const ffmpeg = '/tmp/node_modules/ffmpeg-static/ffmpeg';
    if (fs.existsSync(ffmpeg)) {
      const { execSync } = require('child_process');
      const mp4 = path.join(OUT, 'sentinai-full-demo.mp4');
      execSync(`${ffmpeg} -i ${dest} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ${mp4} -y`);
      console.log(`MP4 saved: ${mp4}`);
    }
  }

  console.log(`\n✅ All done! Files in: ${OUT}`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
