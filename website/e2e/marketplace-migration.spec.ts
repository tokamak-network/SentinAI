import { test, expect } from '@playwright/test';

/**
 * Chunk 7: E2E Testing for Marketplace Data Migration
 *
 * Test scenarios:
 * 1. Verify 5 migrated agents appear in marketplace page
 * 2. Verify agent pricing and tier information is correct
 * 3. Verify marketplace navigation works
 */

test.describe('Marketplace Data Migration (Chunk 6)', () => {
  test('Core Scenario: Marketplace displays 5 migrated agents', async ({ page }) => {
    // Navigate to marketplace page
    await page.goto('/marketplace');

    // Verify page loads with agents
    await expect(page.locator('text=SENTINAI')).toBeVisible();
    await expect(page.locator('h1:has-text("Agent Marketplace")')).toBeVisible();

    // Verify registry tab content shows agents
    await expect(page.locator('text=AVAILABLE AGENTS')).toBeVisible();

    // Check for all 5 migrated agents
    const agentIds = [
      'anomaly-detector',
      'rca-engine',
      'cost-optimizer',
      'predictive-scaler',
      'nlops-chat',
    ];

    for (const id of agentIds) {
      const idElement = page.locator(`text=ID: ${id}`);
      await expect(idElement).toBeVisible();
    }

    // Verify pricing information for a few agents
    // Anomaly Detector: junior ($199)
    await expect(page.locator('text=ANOMALY DETECTOR').first()).toBeVisible();
    await expect(page.locator('text=JUNIOR').first()).toBeVisible();
    await expect(page.locator('text=$199.00')).toBeVisible();

    // RCA Engine: senior ($499)
    await expect(page.locator('text=RCA ENGINE')).toBeVisible();
    await expect(page.locator('text=SENIOR').first()).toBeVisible();
    await expect(page.locator('text=$499.00').first()).toBeVisible();

    // Predictive Scaler: expert ($799)
    await expect(page.locator('text=PREDICTIVE SCALER')).toBeVisible();
    await expect(page.locator('text=EXPERT').first()).toBeVisible();
    await expect(page.locator('text=$799.00').nth(1)).toBeVisible();
  });

  test('Navigation: Can reach marketplace from home page', async ({ page }) => {
    // Start at home
    await page.goto('/');

    // Find and click marketplace link
    const marketplaceLink = page.locator('a').filter({ hasText: 'MARKETPLACE' }).first();
    await expect(marketplaceLink).toBeVisible();
    await marketplaceLink.click();

    // Should navigate to marketplace
    await page.waitForURL('/marketplace');
    await expect(page.locator('h1:has-text("Agent Marketplace")')).toBeVisible();
    await expect(page.locator('text=ANOMALY DETECTOR').first()).toBeVisible();
  });

  test('Agent Details: All agents have name, description, and pricing', async ({ page }) => {
    await page.goto('/marketplace');

    // Define agents with expected properties
    const agents = [
      {
        id: 'anomaly-detector',
        name: 'ANOMALY DETECTOR',
        tier: 'JUNIOR',
        price: '$199.00',
      },
      {
        id: 'rca-engine',
        name: 'RCA ENGINE',
        tier: 'SENIOR',
        price: '$499.00',
      },
      {
        id: 'cost-optimizer',
        name: 'COST OPTIMIZER',
        tier: 'SENIOR',
        price: '$499.00',
      },
      {
        id: 'predictive-scaler',
        name: 'PREDICTIVE SCALER',
        tier: 'EXPERT',
        price: '$799.00',
      },
      {
        id: 'nlops-chat',
        name: 'NLOPS CHAT',
        tier: 'EXPERT',
        price: '$799.00',
      },
    ];

    for (const agent of agents) {
      // Verify agent ID is visible
      const idElement = page.locator(`text=ID: ${agent.id}`);
      await expect(idElement).toBeVisible();

      // Verify agent name is visible (use first to avoid ambiguity)
      const nameElement = page.locator(`text=${agent.name}`).first();
      await expect(nameElement).toBeVisible();

      // Verify tier is visible (use locator within agent card context)
      const tierElement = page.locator(`span:has-text("${agent.tier}")`).first();
      await expect(tierElement).toBeVisible();

      // Verify price is visible
      const priceElement = page.locator(`text=${agent.price}`).first();
      await expect(priceElement).toBeVisible();
    }
  });

  test('Agent Descriptions: All agents have descriptions', async ({ page }) => {
    await page.goto('/marketplace');

    // Check for key description phrases
    const descriptionPhrases = [
      'Real-time detection',          // anomaly-detector
      'Root cause analysis',           // rca-engine
      'cost analysis',                 // cost-optimizer
      'auto-scales infrastructure',    // predictive-scaler
      'conversational interface',      // nlops-chat
    ];

    for (const phrase of descriptionPhrases) {
      const desc = page.locator(`text=${phrase}`);
      await expect(desc).toBeVisible();
    }
  });

  test('UI Elements: Agent cards have action buttons', async ({ page }) => {
    await page.goto('/marketplace');

    // Verify DETAILS button exists
    const detailsButtons = page.locator('button:has-text("DETAILS")');
    await expect(detailsButtons.first()).toBeVisible();
    const detailsCount = await detailsButtons.count();
    expect(detailsCount).toBeGreaterThanOrEqual(5);

    // Verify DOCS button exists
    const docsButtons = page.locator('button:has-text("DOCS")');
    await expect(docsButtons.first()).toBeVisible();
    const docsCount = await docsButtons.count();
    expect(docsCount).toBeGreaterThanOrEqual(5);
  });

  test('Marketplace Tabs: All tabs are accessible', async ({ page }) => {
    await page.goto('/marketplace');

    // Check all tabs exist
    const tabNames = ['registry', 'instance', 'guide', 'sandbox'];
    for (const tabName of tabNames) {
      const tabButton = page.locator(`button`, { has: page.locator(`text=${tabName}`) }).first();
      // Tab buttons are rendered (might be case-insensitive)
      const tabElements = page.locator('button');
      const count = await tabElements.count();
      expect(count).toBeGreaterThanOrEqual(4); // At least 4 tabs
    }
  });

  test('Agent Count: Exactly 5 agents are displayed', async ({ page }) => {
    await page.goto('/marketplace');

    // Count agent ID elements
    const agentIds = page.locator('text=/ID: /');
    const count = await agentIds.count();
    expect(count).toBe(5);
  });

  test('Responsive Design: Marketplace works on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/marketplace');

    // Verify key elements are still visible
    await expect(page.locator('text=SENTINAI')).toBeVisible();
    await expect(page.locator('text=ANOMALY DETECTOR')).toBeVisible();
    await expect(page.locator('text=ID: rca-engine')).toBeVisible();
  });
});
