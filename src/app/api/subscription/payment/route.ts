import { NextRequest, NextResponse } from 'next/server'
import { paymentProvider } from '@/lib/payment-stub'
import type { PaymentCycle, DiscountMethod } from '@/lib/payment-interface'

export async function POST(req: NextRequest) {
  const body = await req.json() as { chainId?: string; cycle?: PaymentCycle; discountMethod?: DiscountMethod }
  const { chainId = 'default', cycle = 'monthly', discountMethod } = body

  const invoice = await paymentProvider.createInvoice(chainId, cycle, discountMethod)
  return NextResponse.json(invoice, { status: 201 })
}

export async function GET(req: NextRequest) {
  const invoiceId = req.nextUrl.searchParams.get('invoiceId')
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })
  }
  const status = await paymentProvider.verifyPayment(invoiceId)
  return NextResponse.json(status)
}
