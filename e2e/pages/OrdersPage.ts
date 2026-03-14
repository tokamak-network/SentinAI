/**
 * Page Object: Orders Page
 */
import { Page, expect } from '@playwright/test';

export class OrdersPage {
  constructor(readonly page: Page) {}

  // Selectors
  get pageHeading() {
    return this.page.locator('h1:has-text("Orders")');
  }

  get searchInput() {
    return this.page.locator('input[placeholder*="search" i]');
  }

  get ordersTable() {
    return this.page.locator('table');
  }

  get tableRows() {
    return this.page.locator('tbody tr');
  }

  get totalOrdersCard() {
    return this.page.locator('text=Total Orders').locator('..').locator('..').first();
  }

  get totalRevenueCard() {
    return this.page.locator('text=Total Revenue').locator('..').locator('..').first();
  }

  // Pagination
  get itemsPerPageSelect() {
    return this.page.locator('select').first();
  }

  get previousButton() {
    return this.page.locator('button:has-text("Previous")');
  }

  get nextButton() {
    return this.page.locator('button:has-text("Next")');
  }

  get pageIndicator() {
    return this.page.locator('text=/Page \d+ of \d+/');
  }

  // Actions
  async goto() {
    await this.page.goto('/admin/orders');
    await this.page.waitForLoadState('networkidle');
  }

  async searchOrders(query: string) {
    await this.searchInput.fill(query);
    await this.page.waitForLoadState('networkidle');
  }

  async setItemsPerPage(count: number) {
    await this.itemsPerPageSelect.selectOption(String(count));
    await this.page.waitForLoadState('networkidle');
  }

  async goToNextPage() {
    await this.nextButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async goToPreviousPage() {
    await this.previousButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getRowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async getOrderIdFromRow(rowIndex: number): Promise<string> {
    return (
      await this.tableRows
        .nth(rowIndex)
        .locator('td')
        .first()
        .textContent()
    ) || '';
  }

  // Assertions
  async expectOrdersPageVisible() {
    await expect(this.pageHeading).toBeVisible();
    await expect(this.searchInput).toBeVisible();
    await expect(this.ordersTable).toBeVisible();
  }

  async expectOrdersVisible() {
    const rowCount = await this.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
  }

  async expectNoOrders() {
    const rowCount = await this.getRowCount();
    expect(rowCount).toBe(0);
  }

  async expectTotalOrdersCardVisible() {
    await expect(this.totalOrdersCard).toBeVisible();
  }

  async expectTotalRevenueCardVisible() {
    await expect(this.totalRevenueCard).toBeVisible();
  }
}
