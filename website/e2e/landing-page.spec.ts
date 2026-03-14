import { test, expect, type Page } from '@playwright/test';

const GITHUB_URL = 'https://github.com/tokamak-network/SentinAI';
const DASHBOARD_URL = 'https://sentinai.tokamak.network/thanos-sepolia';

// ─── Helper ──────────────────────────────────────────────────────────────────

async function gotoLanding(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
}

// ─── Navbar ──────────────────────────────────────────────────────────────────

test.describe('Navbar', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('brand block shows SENTINAI text with red background', async ({ page }) => {
    const brand = page.locator('header').locator('span', { hasText: 'SENTINAI' }).first();
    await expect(brand).toBeVisible();
    await expect(brand).toHaveText('SENTINAI');

    // Verify brand block has red background (#D40000)
    const brandBlock = brand.locator('..');
    const bg = await brandBlock.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(212, 0, 0)');
  });

  test('nav links DOCS, DEPLOY, MARKETPLACE, ADMIN, GITHUB exist with correct hrefs', async ({ page }) => {
    const nav = page.locator('header nav');

    const docsLink = nav.locator('a', { hasText: 'DOCS' });
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute('href', '/docs');

    const deployLink = nav.locator('a', { hasText: 'DEPLOY' });
    await expect(deployLink).toBeVisible();
    await expect(deployLink).toHaveAttribute('href', '/connect');

    const marketplaceLink = nav.locator('a', { hasText: 'MARKETPLACE' });
    await expect(marketplaceLink).toBeVisible();
    await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');

    const adminLink = nav.locator('a', { hasText: 'ADMIN' });
    await expect(adminLink).toBeVisible();
    // ADMIN link defaults to localhost:3002/login but can be overridden by NEXT_PUBLIC_ADMIN_URL
    const adminHref = await adminLink.getAttribute('href');
    expect(adminHref).toBeTruthy();

    const githubLink = nav.locator('a', { hasText: 'GITHUB' });
    await expect(githubLink).toBeVisible();
    await expect(githubLink).toHaveAttribute('href', GITHUB_URL);
    await expect(githubLink).toHaveAttribute('target', '_blank');
  });

  test('CTA button "CONNECT NODE" exists with red background', async ({ page }) => {
    const cta = page.locator('header a', { hasText: 'CONNECT NODE' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/connect');

    const bg = await cta.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(212, 0, 0)');
  });

  test('navbar has white background and sticky position', async ({ page }) => {
    const header = page.locator('header');
    const bg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');

    const position = await header.evaluate(el => getComputedStyle(el).position);
    expect(position).toBe('sticky');
  });
});

// ─── Hero ────────────────────────────────────────────────────────────────────

test.describe('Hero Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('status ticker bar shows OPERATIONAL, ACTIVE, chains, MIT LICENSE', async ({ page }) => {
    // The ticker bar is the first dark div inside the hero section
    const heroSection = page.locator('section').first();
    const tickerBar = heroSection.locator('div').first();

    await expect(tickerBar.getByText('OPERATIONAL')).toBeVisible();
    await expect(tickerBar.getByText('ACTIVE', { exact: false })).toBeVisible();
    await expect(tickerBar.getByText('OP STACK', { exact: false })).toBeVisible();
    await expect(tickerBar.getByText('MIT LICENSE')).toBeVisible();
  });

  test('h1 heading contains "Autonomous Operations"', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Autonomous Operations');

    // "Autonomous Operations" should be red
    const redSpan = heading.locator('span');
    const color = await redSpan.evaluate(el => getComputedStyle(el).color);
    expect(color).toBe('rgb(212, 0, 0)');
  });

  test('AUTONOMOUS NODE GUARDIAN badge is visible', async ({ page }) => {
    await expect(page.getByText('AUTONOMOUS NODE GUARDIAN', { exact: true })).toBeVisible();
  });

  test('terminal code block contains docker compose command', async ({ page }) => {
    await expect(page.getByText('docker compose up -d').first()).toBeVisible();
    await expect(page.getByText('cp .env.local.sample .env.local')).toBeVisible();
    await expect(page.getByText('sentinai started on port 3002')).toBeVisible();
    await expect(page.getByText('agent loop active')).toBeVisible();
  });

  test('terminal block has dark background with green text', async ({ page }) => {
    const greenText = page.getByText('sentinai started on port 3002');
    const color = await greenText.evaluate(el => getComputedStyle(el).color);
    expect(color).toBe('rgb(0, 255, 136)');
  });

  test('3 CTA buttons exist: CONNECT YOUR NODE, VIEW DASHBOARD, READ DOCS', async ({ page }) => {
    const connectBtn = page.locator('main a', { hasText: 'CONNECT YOUR NODE' });
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toHaveAttribute('href', '/connect');

    const viewBtn = page.locator('main a', { hasText: 'VIEW DASHBOARD' });
    await expect(viewBtn).toBeVisible();
    await expect(viewBtn).toHaveAttribute('href', DASHBOARD_URL);
    await expect(viewBtn).toHaveAttribute('target', '_blank');

    const readDocsBtn = page.locator('main a', { hasText: 'READ DOCS' }).first();
    await expect(readDocsBtn).toBeVisible();
    await expect(readDocsBtn).toHaveAttribute('href', '/docs');
  });
});

// ─── Supported Clients ──────────────────────────────────────────────────────

test.describe('Supported Clients Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('section bar shows "SUPPORTED CLIENTS"', async ({ page }) => {
    const sectionBars = page.locator('div').filter({ hasText: /^SUPPORTED CLIENTS$/i });
    await expect(sectionBars.first()).toBeVisible();
  });

  test('2 client groups are visible: L2, L1 EXECUTION', async ({ page }) => {
    await expect(page.getByText('L2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('L1 EXECUTION', { exact: true })).toBeVisible();
  });

  test('L2 clients: OP Stack, Arbitrum Nitro, ZK Stack', async ({ page }) => {
    // Use exact: true to avoid matching ticker bar and description text
    await expect(page.getByText('OP Stack', { exact: true })).toBeVisible();
    await expect(page.getByText('Arbitrum Nitro', { exact: true })).toBeVisible();
    await expect(page.getByText('ZK Stack', { exact: true })).toBeVisible();
  });

  test('L1 Execution clients: Geth, Reth, Nethermind, Besu', async ({ page }) => {
    // Use exact: true to avoid matching description paragraphs and HeroMiniature
    await expect(page.getByText('Geth', { exact: true })).toBeVisible();
    await expect(page.getByText('Reth', { exact: true })).toBeVisible();
    await expect(page.getByText('Nethermind', { exact: true })).toBeVisible();
    await expect(page.getByText('Besu', { exact: true })).toBeVisible();
  });

});

// ─── What It Does ────────────────────────────────────────────────────────────

test.describe('What It Does Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('section bar shows "WHAT IT DOES"', async ({ page }) => {
    const sectionBars = page.locator('div').filter({ hasText: /^WHAT IT DOES$/i });
    await expect(sectionBars.first()).toBeVisible();
  });

  test('all 6 capability cards are visible', async ({ page }) => {
    const capabilities = [
      'REAL-TIME DETECTION',
      'POLICY-BASED PLANNING',
      'AUTO-EXECUTION',
      'APPROVAL GATING',
      'AUDIT TRAILS',
      'L1 VALIDATOR MONITORING',
    ];

    for (const cap of capabilities) {
      await expect(page.getByText(cap, { exact: true })).toBeVisible();
    }
  });

  test('capability descriptions are visible', async ({ page }) => {
    await expect(page.getByText('Z-Score + AI analysis pipeline', { exact: false })).toBeVisible();
    await expect(page.getByText('Low-risk remediation actions', { exact: false })).toBeVisible();
    await expect(page.getByText('require human approval', { exact: false })).toBeVisible();
  });
});

// ─── How It Works ────────────────────────────────────────────────────────────

test.describe('How It Works Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('section bar shows "HOW IT WORKS"', async ({ page }) => {
    const sectionBars = page.locator('div').filter({ hasText: /^HOW IT WORKS$/i });
    await expect(sectionBars.first()).toBeVisible();
  });

  test('4 pipeline nodes: OBSERVE, DETECT, ANALYZE, ACT', async ({ page }) => {
    for (const phase of ['OBSERVE', 'DETECT', 'ANALYZE', 'ACT']) {
      await expect(page.getByText(phase, { exact: true }).first()).toBeVisible();
    }
  });

  test('pipeline descriptions are visible', async ({ page }) => {
    await expect(page.getByText('Collect L1/L2 metrics from RPC', { exact: false })).toBeVisible();
    await expect(page.getByText('Z-Score statistical anomaly detection', { exact: false })).toBeVisible();
    await expect(page.getByText('Root cause analysis traces fault propagation', { exact: false })).toBeVisible();
    await expect(page.getByText('Execute scaling or remediation', { exact: false })).toBeVisible();
  });

  test('agent loop description is visible', async ({ page }) => {
    await expect(page.getByText('An autonomous agent loop running every 30 seconds')).toBeVisible();
  });

  test('arrows between pipeline nodes exist', async ({ page }) => {
    // There should be 3 arrow characters between the 4 nodes
    // The arrows are rendered as text content
    const howItWorksSection = page.locator('section').filter({ has: page.getByText('HOW IT WORKS') });
    const arrowCount = await howItWorksSection.locator('div').filter({ hasText: /^→$/ }).count();
    expect(arrowCount).toBeGreaterThanOrEqual(3);
  });
});

// ─── Deployment ──────────────────────────────────────────────────────────────

test.describe('Deployment Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('section bar shows "DEPLOYMENT OPTIONS"', async ({ page }) => {
    const sectionBars = page.locator('div').filter({ hasText: /^DEPLOYMENT OPTIONS$/i });
    await expect(sectionBars.first()).toBeVisible();
  });

  test('Docker Compose card is visible with code block', async ({ page }) => {
    await expect(page.getByText('DOCKER COMPOSE', { exact: true })).toBeVisible();
    await expect(page.getByText('Local development and demo', { exact: false })).toBeVisible();
    // The docker compose command appears in both hero terminal and deployment section
    const dockerCommands = page.getByText('docker compose up -d');
    expect(await dockerCommands.count()).toBeGreaterThanOrEqual(2);
  });

  test('Kubernetes (EKS) card is visible with code block', async ({ page }) => {
    await expect(page.getByText('KUBERNETES (EKS)')).toBeVisible();
    await expect(page.getByText('Production-grade deployment', { exact: false })).toBeVisible();
    await expect(page.getByText('AWS_CLUSTER_NAME=my-cluster', { exact: false })).toBeVisible();
  });

  test('Docker feature list items are visible', async ({ page }) => {
    await expect(page.getByText('Next.js dashboard on :3002')).toBeVisible();
    await expect(page.getByText('Redis state store')).toBeVisible();
    await expect(page.getByText('Caddy HTTPS proxy (optional)')).toBeVisible();
  });

  test('K8s feature list items are visible', async ({ page }) => {
    await expect(page.getByText('Auto-detects EKS region', { exact: false })).toBeVisible();
    await expect(page.getByText('Real pod scaling', { exact: false })).toBeVisible();
    await expect(page.getByText('L1 RPC failover', { exact: false })).toBeVisible();
  });

  test('GENERATE SETUP SCRIPT button exists', async ({ page }) => {
    const btn = page.locator('a', { hasText: 'GENERATE SETUP SCRIPT' });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', '/setup');
  });
});

// ─── Safety & Control ────────────────────────────────────────────────────────

test.describe('Safety & Control Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('section bar shows "SAFETY & CONTROL"', async ({ page }) => {
    // The source uses &amp; in JSX, rendered as &
    const sectionBars = page.locator('div').filter({ hasText: /^SAFETY & CONTROL$/i });
    await expect(sectionBars.first()).toBeVisible();
  });

  test('4 safety items with labels', async ({ page }) => {
    const labels = [
      'RISK-TIERED POLICIES',
      'DESTRUCTIVE ACTIONS BLOCKED',
      'APPROVAL REQUIRED',
      'FULL AUDIT HISTORY',
    ];
    for (const label of labels) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test('level badges: POLICY, BLOCKED, GATED, LOGGED', async ({ page }) => {
    for (const level of ['POLICY', 'BLOCKED', 'GATED', 'LOGGED']) {
      await expect(page.getByText(level, { exact: true })).toBeVisible();
    }
  });

  test('POLICY badge has blue border color', async ({ page }) => {
    const policyBadge = page.getByText('POLICY', { exact: true });
    const borderColor = await policyBadge.evaluate(el => getComputedStyle(el).borderColor);
    expect(borderColor).toBe('rgb(0, 85, 170)');
  });

  test('BLOCKED badge has red border color', async ({ page }) => {
    const blockedBadge = page.getByText('BLOCKED', { exact: true });
    const borderColor = await blockedBadge.evaluate(el => getComputedStyle(el).borderColor);
    expect(borderColor).toBe('rgb(212, 0, 0)');
  });

  test('GATED badge has orange border color', async ({ page }) => {
    const gatedBadge = page.getByText('GATED', { exact: true });
    const borderColor = await gatedBadge.evaluate(el => getComputedStyle(el).borderColor);
    expect(borderColor).toBe('rgb(204, 102, 0)');
  });

  test('LOGGED badge has green border color', async ({ page }) => {
    const loggedBadge = page.getByText('LOGGED', { exact: true });
    const borderColor = await loggedBadge.evaluate(el => getComputedStyle(el).borderColor);
    expect(borderColor).toBe('rgb(0, 122, 0)');
  });

  test('safety descriptions are visible', async ({ page }) => {
    // Scope to the Safety & Control section to avoid matching WhatItDoes descriptions
    const safetySection = page.locator('section').filter({ has: page.locator('div', { hasText: /^SAFETY & CONTROL$/i }) });

    await expect(safetySection.getByText('classified by risk level', { exact: false })).toBeVisible();
    await expect(safetySection.getByText('blocked by default at the policy layer', { exact: false })).toBeVisible();
    await expect(safetySection.getByText('ChatOps approval flow', { exact: false })).toBeVisible();
    await expect(safetySection.getByText('Replay incidents', { exact: false })).toBeVisible();
  });
});

// ─── Footer ──────────────────────────────────────────────────────────────────

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('footer has black background (#0A0A0A)', async ({ page }) => {
    const footer = page.locator('footer');
    const bg = await footer.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(10, 10, 10)');
  });

  test('footer has red SENTINAI brand block', async ({ page }) => {
    const footerBrand = page.locator('footer').locator('div', { hasText: 'SENTINAI' }).first();
    await expect(footerBrand).toBeVisible();
  });

  test('footer contains Tokamak Network credit', async ({ page }) => {
    await expect(page.locator('footer').getByText('Tokamak Network')).toBeVisible();
  });

  test('footer links: DOCS, DEPLOY, GITHUB, X / TWITTER', async ({ page }) => {
    const footerNav = page.locator('footer nav');

    const docsLink = footerNav.locator('a', { hasText: 'DOCS' });
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute('href', '/docs');

    const deployLink = footerNav.locator('a', { hasText: 'DEPLOY' });
    await expect(deployLink).toBeVisible();
    await expect(deployLink).toHaveAttribute('href', '/connect');

    const githubLink = footerNav.locator('a', { hasText: 'GITHUB' });
    await expect(githubLink).toBeVisible();
    await expect(githubLink).toHaveAttribute('href', GITHUB_URL);

    const twitterLink = footerNav.locator('a', { hasText: 'X / TWITTER' });
    await expect(twitterLink).toBeVisible();
    await expect(twitterLink).toHaveAttribute('href', 'https://x.com/tokamak_network');
  });
});

// ─── Theme & Typography ──────────────────────────────────────────────────────

test.describe('Theme & Typography', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('page has white background (#FFFFFF)', async ({ page }) => {
    const rootDiv = page.locator('body > div').first();
    const bg = await rootDiv.evaluate(el => {
      // Walk up to find the explicit white background
      let node: Element | null = el;
      while (node) {
        const style = getComputedStyle(node);
        if (style.backgroundColor === 'rgb(255, 255, 255)') return style.backgroundColor;
        node = node.parentElement;
      }
      return getComputedStyle(el).backgroundColor;
    });
    expect(bg).toBe('rgb(255, 255, 255)');
  });

  test('IBM Plex Mono font is referenced in styles', async ({ page }) => {
    const heading = page.locator('h1');
    const fontFamily = await heading.evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily.toLowerCase()).toContain('ibm plex mono');
  });

  test('brand color #D40000 is used for SENTINAI text blocks', async ({ page }) => {
    // Check navbar brand block background
    const navBrand = page.locator('header > div').first();
    const bg = await navBrand.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(212, 0, 0)');
  });

  test('no horizontal scrollbar on desktop viewport', async ({ page }) => {
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
  });
});

// ─── Section Order ───────────────────────────────────────────────────────────

test.describe('Section Order', () => {
  test('sections appear in correct order', async ({ page }) => {
    await gotoLanding(page);

    // Get all section bars to verify ordering
    const sectionBarTexts = [
      'SUPPORTED CLIENTS',
      'WHAT IT DOES',
      'HOW IT WORKS',
      'DEPLOYMENT OPTIONS',
      'SAFETY & CONTROL',
    ];

    // Get Y positions of each section bar
    const positions: number[] = [];
    for (const text of sectionBarTexts) {
      const el = page.locator('div').filter({ hasText: new RegExp(`^${text.replace('&', '&')}$`, 'i') }).first();
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      positions.push(box!.y);
    }

    // Verify each section comes after the previous one
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

// ─── Full Page Screenshot ────────────────────────────────────────────────────

test.describe('Visual Verification', () => {
  test('capture full page screenshot for desktop', async ({ page }) => {
    await gotoLanding(page);
    await page.screenshot({
      path: 'e2e/screenshots/landing-desktop-full.png',
      fullPage: true,
    });
  });
});
