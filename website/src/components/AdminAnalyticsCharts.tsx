'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CFE'];

export default function AdminAnalyticsCharts() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState('all');

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const url = merchant === 'all' 
        ? '/api/marketplace/analytics'
        : `/api/marketplace/analytics?merchant=${merchant}`;
        
      const res = await fetch(url);
      const json = await res.json();
      
      if (json.success) {
        setData(json);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [merchant]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500 font-mono">Loading analytics...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center text-red-500 font-mono">Failed to load analytics</div>;
  }

  // Calculate cumulative revenue
  let cumulative = 0;
  const cumulativeData = data.dailyVolume?.map((day: any) => {
    cumulative += day.volume;
    return { ...day, cumulative };
  }) || [];

  return (
    <div className="flex flex-col space-y-8 font-mono">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <select
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white font-mono"
        >
          <option value="all">All Merchants</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm mb-2">Total Transactions</div>
          <div className="text-3xl font-bold text-white">{data.totalTransactions}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm mb-2">Total Volume</div>
          <div className="text-3xl font-bold text-green-400">${data.totalVolume.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm mb-2">Success Rate</div>
          <div className="text-3xl font-bold text-white">{data.successRate.toFixed(1)}%</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <div className="text-gray-400 text-sm mb-2">Avg Amount</div>
          <div className="text-3xl font-bold text-white">${data.avgAmount.toFixed(2)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-6">Daily Volume</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <BarChart data={data.dailyVolume}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#888" />
                <YAxis stroke="#888" />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Bar dataKey="volume" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-6">Cumulative Revenue</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#888" />
                <YAxis stroke="#888" />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Line type="monotone" dataKey="cumulative" stroke="#8B5CF6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-6">Revenue by Product</h2>
          <div className="h-80 w-full flex justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.productBreakdown}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {data.productBreakdown?.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-6">Transaction Status</h2>
          <div className="h-80 w-full flex justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.statusBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {data.statusBreakdown?.map((entry: any, index: number) => {
                    const color = entry.name === 'completed' ? '#10B981' : 
                                  entry.name === 'failed' ? '#EF4444' : '#F59E0B';
                    return <Cell key={`cell-${index}`} fill={color} />;
                  })}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
