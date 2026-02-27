import { NextResponse } from 'next/server'
import { getTierInfo } from '@/lib/subscription-manager'

export async function GET() {
  return NextResponse.json(getTierInfo())
}
