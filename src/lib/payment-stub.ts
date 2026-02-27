/**
 * Stub Payment Provider
 * No real blockchain transactions — always returns pending.
 * Replace with TonPaymentProvider when real payment is needed.
 */
import { randomUUID } from 'crypto'
import type { PaymentProvider, PaymentCycle, DiscountMethod, Invoice, PaymentStatus } from './payment-interface'
import { applyDiscount, PREMIUM_PRICE_USD } from './payment-interface'

export class StubPaymentProvider implements PaymentProvider {
  async createInvoice(chainId: string, cycle: PaymentCycle, discountMethod?: DiscountMethod): Promise<Invoice> {
    const now = new Date()
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24h
    const discounted = applyDiscount(PREMIUM_PRICE_USD, discountMethod, cycle)

    return {
      invoiceId: `stub-${randomUUID()}`,
      chainId,
      cycle,
      baseAmountUsd: PREMIUM_PRICE_USD,
      discountedAmountUsd: discounted,
      discountMethod,
      address: '0xSTUB_ADDRESS_NOT_CONNECTED',
      expiresAt: expires.toISOString(),
      createdAt: now.toISOString(),
    }
  }

  async verifyPayment(invoiceId: string): Promise<PaymentStatus> {
    return {
      invoiceId,
      status: 'pending',
      note: '실결제 미연동 — SaaS 플랫폼화 결정 후 TonPaymentProvider로 교체 예정',
    }
  }
}

/** Singleton stub instance */
export const paymentProvider: PaymentProvider = new StubPaymentProvider()
