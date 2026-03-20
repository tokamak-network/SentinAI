import { NextResponse } from 'next/server';
import { saveTransaction, getTransactions } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const data = await req.json();
    
    // Required fields check
    if (!data.buyer || !data.merchant || !data.productId || !data.amount || !data.network) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const result = await saveTransaction({
      buyer: data.buyer,
      merchant: data.merchant,
      productId: data.productId,
      amount: data.amount,
      network: data.network,
      status: data.status || 'pending',
      settlementId: data.settlementId,
      txHash: data.txHash,
      receiptJson: data.receiptJson ? JSON.stringify(data.receiptJson) : undefined
    });

    if (result.success) {
      return NextResponse.json({ success: true, id: result.id });
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to save transaction' },
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const merchant = searchParams.get('merchant');
    const buyer = searchParams.get('buyer');
    
    const filters = {
      limit,
      offset,
      ...(status && { status }),
      ...(merchant && { merchant }),
      ...(buyer && { buyer })
    };

    const result = await getTransactions(filters);

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions' },
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
