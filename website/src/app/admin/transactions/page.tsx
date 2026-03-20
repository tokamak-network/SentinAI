"use client";

import { useState, useEffect } from 'react';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    // Mock fetch for now
    setTransactions([]);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Transactions</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="py-2 px-4 border-b">Buyer</th>
              <th className="py-2 px-4 border-b">Merchant</th>
              <th className="py-2 px-4 border-b">Product</th>
              <th className="py-2 px-4 border-b">Amount</th>
              <th className="py-2 px-4 border-b">Status</th>
              <th className="py-2 px-4 border-b">Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-4">No transactions found.</td></tr>
            ) : (
              transactions.map((tx: any, i) => (
                <tr key={i}>
                  <td className="py-2 px-4 border-b">{tx.buyer}</td>
                  <td className="py-2 px-4 border-b">{tx.merchant}</td>
                  <td className="py-2 px-4 border-b">{tx.productId}</td>
                  <td className="py-2 px-4 border-b">{tx.amount}</td>
                  <td className="py-2 px-4 border-b">{tx.status}</td>
                  <td className="py-2 px-4 border-b">{tx.date}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
