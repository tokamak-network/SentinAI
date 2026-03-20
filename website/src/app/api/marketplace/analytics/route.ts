import { NextResponse } from 'next/server';
import { getAnalytics } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchant');
    
    const result = await getAnalytics(merchantId || undefined);

    if (result.success) {
      return NextResponse.json({ success: true, ...result.data });
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch analytics' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
