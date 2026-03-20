"use client";

import { useState, useEffect } from 'react';

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    // Mock
    setMetrics({
        volume: 120,
        revenue: '250 TON',
        successRate: '99.5%',
        avgTx: '2.1 TON'
    });
  }, []);

  if (!metrics) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Analytics Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-4 rounded shadow border">
            <h3 className="text-gray-500 text-sm">Total Volume</h3>
            <p className="text-2xl font-bold">{metrics.volume}</p>
        </div>
        <div className="bg-white p-4 rounded shadow border">
            <h3 className="text-gray-500 text-sm">Total Revenue</h3>
            <p className="text-2xl font-bold">{metrics.revenue}</p>
        </div>
        <div className="bg-white p-4 rounded shadow border">
            <h3 className="text-gray-500 text-sm">Success Rate</h3>
            <p className="text-2xl font-bold">{metrics.successRate}</p>
        </div>
        <div className="bg-white p-4 rounded shadow border">
            <h3 className="text-gray-500 text-sm">Avg Tx Amount</h3>
            <p className="text-2xl font-bold">{metrics.avgTx}</p>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded shadow border">
        <h2 className="text-lg font-bold mb-4">Daily Transaction Volume</h2>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded text-gray-400">
            [Chart Placeholder]
        </div>
      </div>
    </div>
  );
}
