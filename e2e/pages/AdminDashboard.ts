/**
 * Page Object: Admin Dashboard
 */
import { Page, expect } from '@playwright/test';

export class AdminDashboard {
  constructor(readonly page: Page) {}

  // Selectors
  get heading() {
    return this.page.locator('h1');
  }

  get catalogCard() {
    return this.page.locator('a[href="/admin/catalog"]').first();
  }

  get pricingCard() {
    return this.page.locator('a[href="/admin/pricing"]').first();
  }

  get ordersCard() {
    return this.page.locator('a[href="/admin/orders"]').first();
  }

  get analyticsCard() {
    return this.page.locator('a[href="/admin/analytics"]').first();
  }

  get logoutButton() {
    return this.page.locator('button:has-text("LOGOUT")');
  }

  // Actions
  async goto() {
    await this.page.goto('/admin');
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToCatalog() {
    await this.catalogCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToPricing() {
    await this.pricingCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToOrders() {
    await this.ordersCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToAnalytics() {
    await this.analyticsCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  async logout() {
    await this.logoutButton.click();
    await this.page.waitForURL('**/admin/login');
  }

  // Assertions
  async expectDashboardVisible() {
    await expect(this.heading).toContainText('Marketplace Admin');
    await expect(this.catalogCard).toBeVisible();
    await expect(this.pricingCard).toBeVisible();
    await expect(this.ordersCard).toBeVisible();
    await expect(this.analyticsCard).toBeVisible();
  }
}
