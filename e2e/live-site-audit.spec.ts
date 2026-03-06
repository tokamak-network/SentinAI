/**
 * Comprehensive Playwright audit of https://sentinai.tokamak.network/thanos-sepolia
 * Tests all visible features, captures screenshots, and evaluates UX.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'https://sentinai.tokamak.network/thanos-sepolia';

// Helper: navigate and wait for dashboard to fully load
async function waitForDashboard(page: Page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Wait for "SentinAI" text to appear (it's a span, not an h1)
  await expect(page.locator('text=SentinAI').first()).toBeVisible({ timeout: 30_000 });
  // Extra wait for data polling to populate
  await page.waitForTimeout(3000);
}

// ─────────────────────────────────────────────
// 1. PAGE LOAD & BASIC STRUCTURE
// ─────────────────────────────────────────────
test.describe('1. Page Load & Structure', () => {
  test('dashboard loads with title and header', async ({ page }) => {
    await waitForDashboard(page);

    const title = await page.title();
    expect(title).toContain('SentinAI');

    await expect(page.locator('text=Autonomous Node Guardian')).toBeVisible();
    await expect(page.locator('text=Thanos Sepolia').first()).toBeVisible();
    await page.screenshot({ path: 'e2e-artifacts/01-dashboard-loaded.png', fullPage: true });
  });

  test('page has correct meta and no critical console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await waitForDashboard(page);

    if (consoleErrors.length > 0) {
      console.log(`Console errors (${consoleErrors.length}):`, consoleErrors.slice(0, 5));
    } else {
      console.log('No console errors detected');
    }
  });

  test('status bar shows operational state', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasOperational = body?.includes('Operational') ?? false;
    const hasUptime = body?.includes('uptime') ?? false;

    console.log('Status bar:', { hasOperational, hasUptime });
    expect(hasOperational || hasUptime).toBeTruthy();

    await page.screenshot({ path: 'e2e-artifacts/01-status-bar.png' });
  });
});

// ─────────────────────────────────────────────
// 2. METRICS HEADER (L1/L2 blocks, resources)
// ─────────────────────────────────────────────
test.describe('2. Metrics Header', () => {
  test('displays L1 and L2 block numbers', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasL1Block = body?.includes('L1 Block') ?? false;
    const hasL2Block = body?.includes('L2 Block') ?? false;

    console.log('Block headers:', { hasL1Block, hasL2Block });
    expect(hasL1Block).toBeTruthy();
    expect(hasL2Block).toBeTruthy();

    // Check for actual block numbers (formatted with commas)
    const blockNumberMatch = body?.match(/[\d,]{5,}/g);
    console.log('Block numbers found:', blockNumberMatch?.slice(0, 4));

    await page.screenshot({ path: 'e2e-artifacts/02-metrics-header.png' });
  });

  test('displays TXPOOL PENDING count', async ({ page }) => {
    await waitForDashboard(page);
    const body = await page.textContent('body');
    expect(body?.includes('TxPool') || body?.includes('Pending')).toBeTruthy();
  });

  test('displays EOA balances (BATCHER & PROPOSER)', async ({ page }) => {
    await waitForDashboard(page);
    const body = await page.textContent('body');

    const hasBatcher = body?.includes('batcher') ?? false;
    const hasProposer = body?.includes('proposer') ?? false;
    const hasEth = body?.includes('ETH') ?? false;

    console.log('EOA balances:', { hasBatcher, hasProposer, hasEth });
    expect(hasBatcher).toBeTruthy();
    expect(hasProposer).toBeTruthy();
  });

  test('displays sync status and L1 RPC info', async ({ page }) => {
    await waitForDashboard(page);
    const body = await page.textContent('body');

    const hasSyncStatus = body?.includes('Sync Status') ?? false;
    const hasL1Rpc = body?.includes('L1 RPC') ?? false;
    const hasFailoverPool = body?.includes('Failover') ?? false;

    console.log('Infra status:', { hasSyncStatus, hasL1Rpc, hasFailoverPool });
    expect(hasSyncStatus).toBeTruthy();
    expect(hasL1Rpc).toBeTruthy();
  });

  test('monthly cost section visible', async ({ page }) => {
    await waitForDashboard(page);
    const body = await page.textContent('body');

    const hasDollar = body?.includes('$') ?? false;
    const hasMonthlyCost = (body?.includes('MONTHLY COST') || body?.includes('monthly')) ?? false;

    console.log('Cost section:', { hasDollar, hasMonthlyCost });
    expect(hasDollar).toBeTruthy();
  });
});

// ─────────────────────────────────────────────
// 3. SENTINAI OPS ASSISTANT (Chat bar)
// ─────────────────────────────────────────────
test.describe('3. SentinAI Ops Assistant', () => {
  test('chat bar visible at top', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasOpsAssistant = (body?.includes('Ops Assistant') || body?.includes('ops-assistant')) ?? false;
    console.log('Ops Assistant bar:', hasOpsAssistant);

    await page.screenshot({ path: 'e2e-artifacts/03-ops-assistant.png' });
  });

  test('chat toggle opens chat panel', async ({ page }) => {
    await waitForDashboard(page);

    const toggle = page.getByTestId('chat-toggle');
    const isVisible = await toggle.isVisible().catch(() => false);

    if (isVisible) {
      await toggle.click();
      await page.waitForTimeout(500);

      const panel = page.getByTestId('chat-panel');
      await expect(panel).toBeVisible();

      await page.screenshot({ path: 'e2e-artifacts/03-chat-open.png' });
    } else {
      // Try clicking "Ops Assistant" text area
      const chatBar = page.locator('text=Ops Assistant').first();
      if (await chatBar.isVisible()) {
        await chatBar.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: 'e2e-artifacts/03-chat-area.png' });
    }
  });

  test('chat has example prompts', async ({ page }) => {
    await waitForDashboard(page);

    const toggle = page.getByTestId('chat-toggle');
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
    }

    const examples = page.locator('[data-testid^="chat-example-"]');
    const count = await examples.count();
    console.log('Chat example prompts:', count);

    if (count > 0) {
      const texts: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        texts.push(await examples.nth(i).textContent() || '');
      }
      console.log('Example prompts:', texts);
    }
  });

  test('can send a message and receive response', async ({ page }) => {
    await waitForDashboard(page);

    const toggle = page.getByTestId('chat-toggle');
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
    }

    const input = page.getByTestId('chat-input');
    if (await input.isVisible().catch(() => false)) {
      await input.fill('What is the current status?');
      await page.getByTestId('chat-send').click();
      await page.waitForTimeout(15_000);

      const messages = page.getByTestId('chat-messages');
      const msgText = await messages.textContent();
      console.log('Chat response (truncated):', msgText?.slice(0, 300));

      // Check if we got an assistant response
      const assistantMsg = page.locator('[data-testid="chat-msg-assistant"]');
      const hasResponse = await assistantMsg.count() > 0;
      console.log('Got assistant response:', hasResponse);

      await page.screenshot({ path: 'e2e-artifacts/03-chat-response.png' });
    }
  });

  test('chat close button works', async ({ page }) => {
    await waitForDashboard(page);

    const toggle = page.getByTestId('chat-toggle');
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
      await expect(page.getByTestId('chat-panel')).toBeVisible();

      await page.getByTestId('chat-close').click();
      await page.waitForTimeout(500);
      await expect(page.getByTestId('chat-panel')).not.toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────
// 4. AUTONOMY PIPELINE
// ─────────────────────────────────────────────
test.describe('4. Autonomy Pipeline', () => {
  test('pipeline section visible', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasPipeline = (body?.includes('Autonomy Pipeline') || body?.includes('Pipeline')) ?? false;

    console.log('Autonomy Pipeline visible:', hasPipeline);

    await page.screenshot({ path: 'e2e-artifacts/04-autonomy-pipeline.png' });
  });

  test('pipeline stages rendered', async ({ page }) => {
    await waitForDashboard(page);

    const stages = ['signal', 'goal', 'plan', 'act', 'verify'];
    const found: Record<string, boolean> = {};

    for (const stage of stages) {
      const el = page.getByTestId(`pipeline-stage-${stage}`);
      found[stage] = await el.isVisible().catch(() => false);
    }
    console.log('Pipeline stages:', found);

    // Also check by text content
    const body = await page.textContent('body');
    for (const stage of stages) {
      const upper = stage.charAt(0).toUpperCase() + stage.slice(1);
      if (!found[stage]) {
        found[`${stage}-text`] = body?.includes(upper) ?? false;
      }
    }
    console.log('Pipeline stages (with text fallback):', found);
  });

  test('autonomy level badge visible', async ({ page }) => {
    await waitForDashboard(page);

    const badge = page.getByTestId('autonomy-current-level-badge');
    const isVisible = await badge.isVisible().catch(() => false);

    if (isVisible) {
      const level = await badge.textContent();
      console.log('Autonomy level:', level);
    } else {
      // Check for "A" level text patterns
      const body = await page.textContent('body');
      const levelMatch = body?.match(/A[0-5]/g);
      console.log('Autonomy level from text:', levelMatch);
    }
  });
});

// ─────────────────────────────────────────────
// 5. PARALLEL AGENT FLEET
// ─────────────────────────────────────────────
test.describe('5. Parallel Agent Fleet', () => {
  test('fleet panel shows agent summary', async ({ page }) => {
    await waitForDashboard(page);

    const fleetPanel = page.getByTestId('parallel-agent-fleet-panel');
    const isVisible = await fleetPanel.isVisible().catch(() => false);

    if (isVisible) {
      const text = await fleetPanel.textContent();
      console.log('Fleet panel (truncated):', text?.slice(0, 300));
    } else {
      const body = await page.textContent('body');
      const hasFleet = (body?.includes('Parallel Agent Fleet') || body?.includes('Agent Fleet')) ?? false;
      console.log('Fleet section found via text:', hasFleet);
    }

    await page.screenshot({ path: 'e2e-artifacts/05-agent-fleet.png' });
  });

  test('fleet shows agent counts and roles', async ({ page }) => {
    await waitForDashboard(page);
    const body = await page.textContent('body');

    const roles = ['anomaly', 'scaling', 'rca', 'cost', 'report', 'predictive', 'eoa', 'failover', 'remediation', 'notifier'];
    const foundRoles = roles.filter(r => body?.toLowerCase().includes(r));
    console.log('Found agent roles:', foundRoles);

    // Check for task rate info
    const hasTaskRate = (body?.includes('tasks/min') || body?.includes('task')) ?? false;
    console.log('Has task rate info:', hasTaskRate);
  });
});

// ─────────────────────────────────────────────
// 6. AGENT EXPERIENCE
// ─────────────────────────────────────────────
test.describe('6. Agent Experience', () => {
  test('experience panel shows tier and stats', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasExperience = (body?.includes('Agent Experience') || body?.includes('Experience')) ?? false;
    const hasTier = (body?.includes('Trainee') || body?.includes('Veteran') || body?.includes('Expert') || body?.includes('Master')) ?? false;
    const hasXP = body?.match(/\d+\s*(xp|XP|ops)/i) !== null;

    console.log('Experience section:', { hasExperience, hasTier, hasXP });

    await page.screenshot({ path: 'e2e-artifacts/06-agent-experience.png' });
  });
});

// ─────────────────────────────────────────────
// 7. ACTIVITY LOG & COMPONENTS
// ─────────────────────────────────────────────
test.describe('7. Activity Log & Components', () => {
  test('activity log section visible', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasActivityLog = (body?.includes('ACTIVITY LOG') || body?.includes('Activity')) ?? false;
    console.log('Activity Log visible:', hasActivityLog);

    // Scroll to bottom to see activity log
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e-artifacts/07-activity-log.png' });
  });

  test('components section shows K8s pod statuses', async ({ page }) => {
    await waitForDashboard(page);

    const body = await page.textContent('body');
    const hasComponents = body?.includes('Components') ?? false;

    const k8sComponents = [
      'Execution Client', 'Consensus Node', 'Batcher', 'Proposer', 'Challenger'
    ];
    const foundComponents = k8sComponents.filter(c => body?.includes(c));
    console.log('Components:', { hasComponents, found: foundComponents });

    await page.screenshot({ path: 'e2e-artifacts/07-components.png', fullPage: true });
  });
});

// ─────────────────────────────────────────────
// 8. COST ANALYSIS (expandable)
// ─────────────────────────────────────────────
test.describe('8. Cost Analysis', () => {
  test('cost analysis button expands details', async ({ page }) => {
    await waitForDashboard(page);

    const btn = page.getByTestId('cost-analysis-btn');
    const isVisible = await btn.isVisible().catch(() => false);

    if (isVisible) {
      await btn.click();
      await page.waitForTimeout(5000);

      const body = await page.textContent('body');
      const hasSavings = (body?.includes('Savings') || body?.includes('savings') || body?.includes('Recommendation')) ?? false;
      console.log('Cost analysis expanded, has savings info:', hasSavings);

      await page.screenshot({ path: 'e2e-artifacts/08-cost-analysis.png', fullPage: true });
    } else {
      console.log('Cost analysis button not found — checking for inline cost data');
      const body = await page.textContent('body');
      console.log('Has dollar sign:', body?.includes('$'));
    }
  });
});

// ─────────────────────────────────────────────
// 9. CONNECT PAGE
// ─────────────────────────────────────────────
test.describe('9. Connect Page', () => {
  test('connect your chain link navigates properly', async ({ page }) => {
    await waitForDashboard(page);

    const connectLink = page.locator('text=Connect your chain').first();
    const isVisible = await connectLink.isVisible().catch(() => false);

    if (isVisible) {
      await connectLink.click();
      await page.waitForTimeout(3000);
      console.log('Navigated to:', page.url());
      await page.screenshot({ path: 'e2e-artifacts/09-connect-page.png', fullPage: true });
    } else {
      console.log('Connect link not visible on dashboard');
    }
  });
});

// ─────────────────────────────────────────────
// 10. API ENDPOINTS
// ─────────────────────────────────────────────
test.describe('10. API Endpoints', () => {
  test('health API returns ok', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Health:', JSON.stringify(body, null, 2).slice(0, 300));
    expect(body.status).toBe('ok');
  });

  test('metrics API returns full data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/metrics`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Metrics keys:', Object.keys(body));
    console.log('Metrics values:', {
      l1Block: body.metrics?.l1BlockHeight,
      l2Block: body.metrics?.blockHeight,
      txPool: body.metrics?.txPoolCount,
      cpu: body.metrics?.cpuUsage,
      gethVcpu: body.metrics?.gethVcpu,
    });
    console.log('Components:', body.components?.map((c: { name: string; status: string }) => `${c.name}:${c.status}`));
    expect(body.metrics).toBeTruthy();
  });

  test('anomalies API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/anomalies`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Anomalies:', { total: body.total, activeCount: body.activeCount });
  });

  test('scaler API returns state', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/scaler`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Scaler:', {
      currentVcpu: body.currentVcpu,
      autoScaling: body.autoScalingEnabled,
      simulation: body.simulationMode,
      cooldown: body.cooldownRemaining,
    });
  });

  test('agent-loop API returns status', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/agent-loop`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Agent loop:', JSON.stringify(body, null, 2).slice(0, 400));
  });

  test('agent-decisions API returns history', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/agent-decisions`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Decisions:', { total: body.total, traces: body.traces?.length });
  });

  test('cost-report API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/cost-report`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Cost:', {
      currentMonthly: body.currentMonthly,
      optimizedMonthly: body.optimizedMonthly,
      savingsPercent: body.totalSavingsPercent,
    });
  });

  test('l1-failover API returns status', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/l1-failover`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('L1 failover:', { failoverCount: body.failoverCount, healthy: body.healthy, spareUrls: body.spareUrlCount });
  });

  test('goal-manager API returns state', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/goal-manager`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Goals:', { activeGoalId: body.activeGoalId, queueDepth: body.queueDepth });
  });

  test('ai-routing status API', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/ai-routing/status`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('AI routing policy:', body.policy);
  });

  test('remediation API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/remediation`);
    const body = await resp.json();
    console.log('Remediation:', { status: resp.status(), keys: Object.keys(body) });
  });

  test('eoa-balance API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/eoa-balance`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('EOA balance:', JSON.stringify(body, null, 2).slice(0, 300));
  });

  test('agent-memory API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/agent-memory`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Agent memory keys:', Object.keys(body));
  });

  test('savings-advisor API returns data', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/savings-advisor`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('Savings advisor:', JSON.stringify(body, null, 2).slice(0, 200));
  });
});

// ─────────────────────────────────────────────
// 11. RESPONSIVE DESIGN
// ─────────────────────────────────────────────
test.describe('11. Responsive Design', () => {
  test('mobile viewport (375px) — overflow check', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log('Mobile (375px): body scrollWidth =', bodyWidth, bodyWidth > 385 ? 'OVERFLOW' : 'OK');

    await page.screenshot({ path: 'e2e-artifacts/11-mobile-375.png', fullPage: true });
    await ctx.close();
  });

  test('tablet viewport (768px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log('Tablet (768px): body scrollWidth =', bodyWidth, bodyWidth > 778 ? 'OVERFLOW' : 'OK');

    await page.screenshot({ path: 'e2e-artifacts/11-tablet-768.png', fullPage: true });
    await ctx.close();
  });

  test('wide desktop (1920px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'e2e-artifacts/11-desktop-1920.png', fullPage: true });
    await ctx.close();
  });
});

// ─────────────────────────────────────────────
// 12. PERFORMANCE
// ─────────────────────────────────────────────
test.describe('12. Performance', () => {
  test('page load time and Web Vitals', async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const loadTime = Date.now() - start;

    const perfMetrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
        ttfb: Math.round(nav.responseStart - nav.startTime),
        transferSize: nav.transferSize,
      };
    });

    console.log(`Total load: ${loadTime}ms`);
    console.log('Navigation timing:', perfMetrics);

    if (loadTime > 5000) console.warn(`SLOW: ${loadTime}ms`);
  });

  test('cumulative layout shift (CLS)', async ({ page }) => {
    await page.goto(BASE);

    const cls = await page.evaluate(() => {
      return new Promise<number>(resolve => {
        let v = 0;
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!(e as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) {
              v += (e as PerformanceEntry & { value: number }).value;
            }
          }
        });
        obs.observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => { obs.disconnect(); resolve(v); }, 8000);
      });
    });

    console.log(`CLS: ${cls.toFixed(4)} (good < 0.1, needs-improvement < 0.25, poor >= 0.25)`);
  });

  test('JavaScript bundle size check', async ({ page }) => {
    const resources: { name: string; size: number }[] = [];

    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('.js') && resp.status() === 200) {
        const headers = resp.headers();
        const size = parseInt(headers['content-length'] || '0', 10);
        if (size > 0) resources.push({ name: url.split('/').pop()!.slice(0, 40), size });
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    resources.sort((a, b) => b.size - a.size);
    const totalKB = resources.reduce((s, r) => s + r.size, 0) / 1024;
    console.log(`Total JS: ${totalKB.toFixed(0)}KB across ${resources.length} files`);
    console.log('Top 5 bundles:', resources.slice(0, 5).map(r => `${r.name}: ${(r.size/1024).toFixed(0)}KB`));
  });
});

// ─────────────────────────────────────────────
// 13. ACCESSIBILITY
// ─────────────────────────────────────────────
test.describe('13. Accessibility', () => {
  test('heading hierarchy', async ({ page }) => {
    await waitForDashboard(page);

    const headings = await page.evaluate(() => {
      const hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(hs).map(h => ({ tag: h.tagName, text: h.textContent?.trim().slice(0, 60) }));
    });

    console.log('Headings:', headings);
    const h1Count = headings.filter(h => h.tag === 'H1').length;
    console.log(`H1 count: ${h1Count} (should be 1)`);
  });

  test('keyboard navigable interactive elements', async ({ page }) => {
    await waitForDashboard(page);

    const focusableCount = await page.evaluate(() => {
      const els = document.querySelectorAll('button, a, input, select, [tabindex]');
      return els.length;
    });
    console.log('Focusable elements:', focusableCount);
  });

  test('unlabeled buttons audit', async ({ page }) => {
    await waitForDashboard(page);

    const unlabeled = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button'))
        .filter(b => !b.textContent?.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'))
        .map(b => ({ classes: b.className.slice(0, 80), html: b.innerHTML.slice(0, 80) }));
    });

    console.log(`Unlabeled buttons: ${unlabeled.length}`);
    if (unlabeled.length > 0) console.log('Examples:', unlabeled.slice(0, 3));
  });

  test('images have alt text', async ({ page }) => {
    await waitForDashboard(page);

    const missingAlt = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .filter(img => !img.getAttribute('alt'))
        .map(img => img.src.slice(0, 60));
    });

    console.log(`Images without alt: ${missingAlt.length}`);
    if (missingAlt.length > 0) console.log('Missing alt:', missingAlt);
  });
});

// ─────────────────────────────────────────────
// 14. FULL PAGE CAPTURE & STRUCTURE AUDIT
// ─────────────────────────────────────────────
test.describe('14. Full Page Audit', () => {
  test('capture complete dashboard at 1440px', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);

    await page.screenshot({ path: 'e2e-artifacts/14-full-dashboard-1440.png', fullPage: true });

    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    console.log(`Dashboard height: ${pageHeight}px`);

    const structure = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="rounded-2xl"]');
      const testIds = document.querySelectorAll('[data-testid]');
      const sections = document.querySelectorAll('h3');
      return {
        cardCount: cards.length,
        testIdPanels: Array.from(testIds).map(p => p.getAttribute('data-testid')).filter(Boolean),
        sectionHeadings: Array.from(sections).map(s => s.textContent?.trim().slice(0, 40)),
      };
    });

    console.log('Dashboard structure:', JSON.stringify(structure, null, 2));
    await ctx.close();
  });
});
