/**
 * Payment Provider Interface
 * Adapter pattern — swap StubPaymentProvider for real provider when SaaS decision is made.
 */

export type PaymentCycle = 'monthly' | 'annual'
export type DiscountMethod = 'ton' | 'card'

export interface Invoice {
  invoiceId: string
  chainId: string
  cycle: PaymentCycle
  baseAmountUsd: number
  discountedAmountUsd: number
  discountMethod?: DiscountMethod
  address?: string        // payment address (TON wallet, etc.)
  expiresAt: string       // ISO 8601
  createdAt: string
}

export type PaymentStatusCode = 'pending' | 'confirmed' | 'expired' | 'failed'

export interface PaymentStatus {
  invoiceId: string
  status: PaymentStatusCode
  paidAt?: string
  txHash?: string
  note?: string
}

export interface PaymentProvider {
  createInvoice(chainId: string, cycle: PaymentCycle, discountMethod?: DiscountMethod): Promise<Invoice>
  verifyPayment(invoiceId: string): Promise<PaymentStatus>
}

/**
 * Apply tier discount.
 * ton + monthly → 15%, ton + annual → 25%
 * card + annual → 10%
 */
export function applyDiscount(
  basePrice: number,
  method: DiscountMethod | undefined,
  cycle: PaymentCycle
): number {
  if (method === 'ton' && cycle === 'annual') return basePrice * 0.75
  if (method === 'ton' && cycle === 'monthly') return basePrice * 0.85
  if (method === 'card' && cycle === 'annual') return basePrice * 0.90
  return basePrice
}

/** Base monthly price per chain in USD */
export const PREMIUM_PRICE_USD = 299
