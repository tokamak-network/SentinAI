/**
 * Page Object: Pricing Management Page
 */
import { Page, expect } from '@playwright/test';

export class PricingPage {
  constructor(readonly page: Page) {}

  // Selectors
  get pageHeading() {
    return this.page.locator('h1:has-text("Pricing")');
  }

  get resetButton() {
    return this.page.locator('button:has-text("RESET TO DEFAULTS")');
  }

  get saveButton() {
    return this.page.locator('button:has-text("SAVE CHANGES")');
  }

  // Tier inputs
  getTierInput(tier: 'trainee' | 'junior' | 'senior' | 'expert') {
    const tierMap = {
      trainee: 'Trainee',
      junior: 'Junior',
      senior: 'Senior',
      expert: 'Expert',
    };
    return this.page.locator(`input[data-tier="${tier}"]`);
  }

  getTierLabel(tier: string) {
    return this.page.locator(`text=${tier}`).first();
  }

  // Actions
  async goto() {
    await this.page.goto('/admin/pricing');
    await this.page.waitForLoadState('networkidle');
  }

  async updatePrice(tier: 'trainee' | 'junior' | 'senior' | 'expert', priceUSDCents: number) {
    const input = this.getTierInput(tier);
    await input.clear();
    await input.fill(String(priceUSDCents));
  }

  async savePricing() {
    await this.saveButton.click();
    // Wait for toast notification or API response
    await this.page.waitForTimeout(1000);
  }

  async resetToDefaults() {
    await this.resetButton.click();
    await this.page.waitForTimeout(500);
  }

  // Assertions
  async expectPricingPageVisible() {
    await expect(this.pageHeading).toBeVisible();
    await expect(this.saveButton).toBeVisible();
    await expect(this.resetButton).toBeVisible();
  }

  async expectPricingValue(tier: 'trainee' | 'junior' | 'senior' | 'expert', expectedPrice: string) {
    const input = this.getTierInput(tier);
    await expect(input).toHaveValue(expectedPrice);
  }

  async expectDefaultPrices() {
    await this.expectPricingValue('trainee', '0');
    await this.expectPricingValue('junior', '19900');
    await this.expectPricingValue('senior', '49900');
    await this.expectPricingValue('expert', '79900');
  }
}
