import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    authRequired: Boolean(process.env.SENTINAI_API_KEY && process.env.SENTINAI_API_KEY.trim().length > 0),
    readOnly: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
  });
}

