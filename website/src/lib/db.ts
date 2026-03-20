import { sql } from '@vercel/postgres';

export async function saveTransaction(data: {
  buyer: string;
  merchant: string;
  productId: string;
  amount: string;
  network: string;
  status: string;
  settlementId?: string;
  txHash?: string;
  receiptJson?: string;
}) {
  try {
    const { rows } = await sql`
      INSERT INTO marketplace_transactions (
        buyer, merchant, product_id, amount, network, status,
        settlement_id, tx_hash, receipt_json
      ) VALUES (
        ${data.buyer}, ${data.merchant}, ${data.productId}, ${data.amount},
        ${data.network}, ${data.status}, ${data.settlementId || null},
        ${data.txHash || null}, ${data.receiptJson || null}
      )
      RETURNING id;
    `;
    return { success: true, id: rows[0].id };
  } catch (error) {
    console.error('Error saving transaction:', error);
    return { success: false, error };
  }
}

export async function getTransactions(filters?: {
  status?: string;
  merchant?: string;
  buyer?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    let query = `SELECT * FROM marketplace_transactions WHERE 1=1`;
    const values: any[] = [];
    let idx = 1;

    if (filters?.status && filters.status !== 'all') {
      query += ` AND status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters?.merchant && filters.merchant !== 'all') {
      query += ` AND merchant = $${idx++}`;
      values.push(filters.merchant);
    }
    if (filters?.buyer) {
      query += ` AND buyer ILIKE $${idx++}`;
      values.push(`%${filters.buyer}%`);
    }

    query += ` ORDER BY created_at DESC`;

    const limit = filters?.limit || 10;
    const offset = filters?.offset || 0;
    
    query += ` LIMIT $${idx++} OFFSET $${idx++}`;
    values.push(limit, offset);

    // Also get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM marketplace_transactions WHERE 1=1`;
    const countValues: any[] = [];
    let countIdx = 1;

    if (filters?.status && filters.status !== 'all') {
      countQuery += ` AND status = $${countIdx++}`;
      countValues.push(filters.status);
    }
    if (filters?.merchant && filters.merchant !== 'all') {
      countQuery += ` AND merchant = $${countIdx++}`;
      countValues.push(filters.merchant);
    }
    if (filters?.buyer) {
      countQuery += ` AND buyer ILIKE $${countIdx++}`;
      countValues.push(`%${filters.buyer}%`);
    }

    const { rows } = await sql.query(query, values);
    const { rows: countRows } = await sql.query(countQuery, countValues);
    
    return { 
      success: true, 
      transactions: rows,
      total: parseInt(countRows[0].count)
    };
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return { success: false, error, transactions: [], total: 0 };
  }
}

export async function getAnalytics(merchantId?: string) {
  try {
    // Determine base condition
    const merchantFilter = merchantId && merchantId !== 'all' 
      ? `WHERE merchant = '${merchantId}'` 
      : '';
      
    const andMerchantFilter = merchantId && merchantId !== 'all' 
      ? `AND merchant = '${merchantId}'` 
      : '';

    // 1. Total Stats
    const { rows: statsRows } = await sql.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CAST(amount AS NUMERIC)) as total_volume,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        AVG(CAST(amount AS NUMERIC)) as avg_amount
      FROM marketplace_transactions
      ${merchantFilter}
    `);

    // 2. Daily Volume (last 30 days)
    const { rows: dailyRows } = await sql.query(`
      SELECT 
        DATE(created_at) as date,
        SUM(CAST(amount AS NUMERIC)) as volume,
        COUNT(*) as count
      FROM marketplace_transactions
      WHERE created_at >= NOW() - INTERVAL '30 days'
      ${andMerchantFilter}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // 3. Product Breakdown
    const { rows: productRows } = await sql.query(`
      SELECT 
        product_id as name,
        SUM(CAST(amount AS NUMERIC)) as value
      FROM marketplace_transactions
      ${merchantFilter}
      GROUP BY product_id
    `);
    
    // 4. Status Breakdown
    const { rows: statusRows } = await sql.query(`
      SELECT 
        status as name,
        COUNT(*) as value
      FROM marketplace_transactions
      ${merchantFilter}
      GROUP BY status
    `);

    const stats = statsRows[0];
    const totalTransactions = parseInt(stats.total_transactions || '0');
    const completedCount = parseInt(stats.completed_count || '0');
    
    return {
      success: true,
      data: {
        totalTransactions,
        totalVolume: parseFloat(stats.total_volume || '0'),
        successRate: totalTransactions > 0 ? (completedCount / totalTransactions) * 100 : 0,
        avgAmount: parseFloat(stats.avg_amount || '0'),
        dailyVolume: dailyRows.map(r => ({ 
          date: r.date.toISOString().split('T')[0], 
          volume: parseFloat(r.volume || '0'),
          count: parseInt(r.count || '0')
        })),
        productBreakdown: productRows.map(r => ({
          name: r.name,
          value: parseFloat(r.value || '0')
        })),
        statusBreakdown: statusRows.map(r => ({
          name: r.name,
          value: parseInt(r.value || '0')
        }))
      }
    };
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return { success: false, error };
  }
}
