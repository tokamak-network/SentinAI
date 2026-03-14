/**
 * Page Object: Catalog Management Page
 */
import { Page, expect } from '@playwright/test';

export class CatalogPage {
  constructor(readonly page: Page) {}

  // Selectors
  get pageHeading() {
    return this.page.locator('h1:has-text("Catalog")');
  }

  get addAgentButton() {
    return this.page.locator('button:has-text("ADD AGENT")');
  }

  get searchInput() {
    return this.page.locator('input[placeholder*="search" i]');
  }

  get agentCards() {
    return this.page.locator('[data-testid="agent-card"]');
  }

  get agentRow(index: number) {
    return this.page.locator('tbody tr').nth(index);
  }

  getAgentCard(name: string) {
    return this.page.locator(`[data-testid="agent-card"]:has-text("${name}")`);
  }

  getEditButton(cardIndex: number) {
    return this.agentRow(cardIndex).locator('button:has-text("EDIT")');
  }

  getDeleteButton(cardIndex: number) {
    return this.agentRow(cardIndex).locator('button:has-text("DELETE")');
  }

  get deleteConfirmButton() {
    return this.page.locator('button:has-text("Confirm")').first();
  }

  // Dialog/Form selectors
  get nameInput() {
    return this.page.locator('input[placeholder*="Agent name" i]');
  }

  get descriptionInput() {
    return this.page.locator('textarea[placeholder*="description" i]');
  }

  get tierSelect() {
    return this.page.locator('select').first();
  }

  get saveButton() {
    return this.page.locator('button:has-text("SAVE")');
  }

  get cancelButton() {
    return this.page.locator('button:has-text("CANCEL")');
  }

  // Actions
  async goto() {
    await this.page.goto('/admin/catalog');
    await this.page.waitForLoadState('networkidle');
  }

  async searchAgent(name: string) {
    await this.searchInput.fill(name);
    await this.page.waitForLoadState('networkidle');
  }

  async clickAddAgent() {
    await this.addAgentButton.click();
    await this.page.waitForSelector('input[placeholder*="Agent name"]');
  }

  async fillAgentForm(data: {
    name: string;
    description: string;
    tier: string;
  }) {
    await this.nameInput.fill(data.name);
    await this.descriptionInput.fill(data.description);
    await this.tierSelect.selectOption(data.tier);
  }

  async saveAgent() {
    await this.saveButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async deleteAgent(index: number) {
    await this.getDeleteButton(index).click();
    await this.page.waitForSelector('button:has-text("Confirm")');
    await this.deleteConfirmButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async editAgent(index: number, newData: {
    name?: string;
    description?: string;
    tier?: string;
  }) {
    await this.getEditButton(index).click();
    await this.page.waitForSelector('input[placeholder*="Agent name"]');

    if (newData.name) {
      await this.nameInput.clear();
      await this.nameInput.fill(newData.name);
    }

    if (newData.description) {
      await this.descriptionInput.clear();
      await this.descriptionInput.fill(newData.description);
    }

    if (newData.tier) {
      await this.tierSelect.selectOption(newData.tier);
    }

    await this.saveAgent();
  }

  // Assertions
  async expectCatalogVisible() {
    await expect(this.pageHeading).toBeVisible();
    await expect(this.addAgentButton).toBeVisible();
    await expect(this.searchInput).toBeVisible();
  }

  async expectAgentVisible(name: string) {
    await expect(this.page.locator(`text=${name}`)).toBeVisible();
  }

  async expectAgentCount(expectedCount: number) {
    const cards = await this.agentCards.count();
    expect(cards).toBeGreaterThanOrEqual(expectedCount);
  }
}
