/**
 * Page Object: Analytics Page
 */
import { Page, expect } from '@playwright/test';

export class AnalyticsPage {
  constructor(readonly page: Page) {}

  // Selectors
  get pageHeading() {
    return this.page.locator('h1:has-text("Analytics")');
  }

  get totalOrdersMetric() {
    return this.page.locator('text=Total Orders').locator('..').locator('..').first();
  }

  get totalRevenueMetric() {
    return this.page.locator('text=Total Revenue').locator('..').locator('..').first();
  }

  get revenueByTierSection() {
    return this.page.locator('text=Revenue by Tier').locator('..').first();
  }

  get orderDistributionSection() {
    return this.page.locator('text=Order Distribution').locator('..').first();
  }

  get topAgentsTable() {
    return this.page.locator('text=Top Agents').locator('..').locator('table').first();
  }

  get emptyStateMessage() {
    return this.page.locator('text=No order data available yet');
  }

  // Tier cards
  getTierCard(tier: 'Trainee' | 'Junior' | 'Senior' | 'Expert') {
    return this.page
      .locator(`text=${tier}`)
      .locator('..')
      .locator('..')
      .first();
  }

  // Actions
  async goto() {
    await this.page.goto('/admin/analytics');
    await this.page.waitForLoadState('networkidle');
  }

  async getTotalOrdersValue(): Promise<string> {
    const card = this.totalOrdersMetric;
    await expect(card).toBeVisible();
    const text = await card.locator('text=/\\d+/').first().textContent();
    return text || '0';
  }

  async getTotalRevenueValue(): Promise<string> {
    const card = this.totalRevenueMetric;
    await expect(card).toBeVisible();
    const text = await card.locator('text=/\\$[\\d,.]+/').first().textContent();
    return text || '$0.00';
  }

  async getTopAgentsCount(): Promise<number> {
    const table = this.topAgentsTable;
    try {
      await expect(table).toBeVisible();
      return await table.locator('tbody tr').count();
    } catch {
      return 0;
    }
  }

  // Assertions
  async expectAnalyticsPageVisible() {
    await expect(this.pageHeading).toBeVisible();
    await expect(this.totalOrdersMetric).toBeVisible();
    await expect(this.totalRevenueMetric).toBeVisible();
  }

  async expectRevenueByTierVisible() {
    await expect(this.revenueByTierSection).toBeVisible();
  }

  async expectOrderDistributionVisible() {
    await expect(this.orderDistributionSection).toBeVisible();
  }

  async expectHasData() {
    // Check that at least one metric has non-zero value
    const totalOrders = await this.getTotalOrdersValue();
    const hasOrders = totalOrders !== '0' && totalOrders !== '';
    expect(hasOrders).toBe(true);
  }

  async expectEmptyState() {
    await expect(this.emptyStateMessage).toBeVisible();
  }

  async expectTierCardVisible(tier: 'Trainee' | 'Junior' | 'Senior' | 'Expert') {
    const card = this.getTierCard(tier);
    await expect(card).toBeVisible();
  }
}
