'use client';

import { useState, useEffect } from 'react';

export default function AdminTransactionsTable() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  
  // Filters
  const [status, setStatus] = useState('all');
  const [merchant, setMerchant] = useState('all');
  const [buyer, setBuyer] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const limit = 10;

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      
      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (status !== 'all') queryParams.append('status', status);
      if (merchant !== 'all') queryParams.append('merchant', merchant);
      if (buyer) queryParams.append('buyer', buyer);

      const res = await fetch(`/api/marketplace/transactions?${queryParams.toString()}`);
      const data = await res.json();
      
      if (data.success) {
        setTransactions(data.transactions);
        setTotal(data.total);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [page, status, merchant]);

  // Handle buyer search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTransactions();
    }, 500);
    return () => clearTimeout(timer);
  }, [buyer]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold font-mono text-white">Transactions</h1>
      </div>

      <div className="flex space-x-4 mb-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by buyer address..."
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white font-mono"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white font-mono"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={merchant}
          onChange={(e) => { setMerchant(e.target.value); setPage(1); }}
          className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white font-mono"
        >
          <option value="all">All Merchants</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-left border-collapse text-sm font-mono">
          <thead className="bg-gray-900">
            <tr>
              <th className="p-3 border-b border-gray-800">ID</th>
              <th className="p-3 border-b border-gray-800">Buyer</th>
              <th className="p-3 border-b border-gray-800">Product</th>
              <th className="p-3 border-b border-gray-800">Amount</th>
              <th className="p-3 border-b border-gray-800">Status</th>
              <th className="p-3 border-b border-gray-800">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">Loading...</td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">No transactions found</td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-900 transition-colors">
                  <td className="p-3 border-b border-gray-800 truncate max-w-xs" title={tx.id}>{tx.id.substring(0, 8)}...</td>
                  <td className="p-3 border-b border-gray-800 truncate max-w-xs" title={tx.buyer}>{tx.buyer.substring(0, 10)}...</td>
                  <td className="p-3 border-b border-gray-800">{tx.product_id}</td>
                  <td className="p-3 border-b border-gray-800">{tx.amount}</td>
                  <td className="p-3 border-b border-gray-800">
                    <span className={`px-2 py-1 rounded text-xs ${
                      tx.status === 'completed' ? 'bg-green-900 text-green-300' :
                      tx.status === 'failed' ? 'bg-red-900 text-red-300' :
                      'bg-yellow-900 text-yellow-300'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="p-3 border-b border-gray-800 text-gray-400">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4">
        <div className="text-gray-500 font-mono text-sm">
          Showing {transactions.length > 0 ? (page - 1) * limit + 1 : 0} to {Math.min(page * limit, total)} of {total} entries
        </div>
        <div className="flex space-x-2">
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 bg-gray-900 rounded text-white disabled:opacity-50"
          >
            Prev
          </button>
          <span className="px-4 py-2 bg-gray-800 rounded text-white">{page} / {Math.max(1, totalPages)}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 bg-gray-900 rounded text-white disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
