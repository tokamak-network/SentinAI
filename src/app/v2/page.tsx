'use client';

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Server, 
  Activity, 
  MessageSquare, 
  Settings, 
  Bell, 
  Search, 
  Menu,
  Cpu,
  Zap,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Terminal
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// --- Mock Data ---
const COST_DATA = [
  { name: 'Mon', cost: 120, projected: 125 },
  { name: 'Tue', cost: 132, projected: 130 },
  { name: 'Wed', cost: 101, projected: 140 },
  { name: 'Thu', cost: 134, projected: 138 },
  { name: 'Fri', cost: 90, projected: 145 },
  { name: 'Sat', cost: 230, projected: 150 },
  { name: 'Sun', cost: 210, projected: 155 },
];

const PERFORMANCE_DATA = [
  { time: '00:00', cpu: 45, memory: 60 },
  { time: '04:00', cpu: 55, memory: 65 },
  { time: '08:00', cpu: 75, memory: 80 },
  { time: '12:00', cpu: 85, memory: 85 },
  { time: '16:00', cpu: 70, memory: 75 },
  { time: '20:00', cpu: 60, memory: 70 },
  { time: '23:59', cpu: 50, memory: 65 },
];

const LOGS = [
  { id: 1, type: 'info', message: 'Op-node sync completed', time: '10:30:05' },
  { id: 2, type: 'warning', message: 'High memory usage detected (85%)', time: '10:28:12' },
  { id: 3, type: 'success', message: 'Auto-scaled to 4 vCPU', time: '10:15:00' },
  { id: 4, type: 'info', message: 'L1 connection established', time: '10:00:00' },
];

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active = false }: { icon: any, label: string, active?: boolean }) => (
  <div className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors ${active ? 'bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </div>
);

const StatCard = ({ title, value, subtext, icon: Icon, trend, status = 'neutral' }: { title: string, value: string, subtext: string, icon: any, trend?: string, status?: 'neutral' | 'success' | 'warning' | 'danger' }) => {
  const statusColor = {
    neutral: 'text-slate-400',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    danger: 'text-rose-400',
  }[status];

  const bgStatus = {
    neutral: 'bg-slate-800/50',
    success: 'bg-emerald-500/10',
    warning: 'bg-amber-500/10',
    danger: 'bg-rose-500/10',
  }[status];

  return (
    <div className={`p-6 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm hover:border-slate-700 transition-all`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2 rounded-lg ${bgStatus}`}>
          <Icon className={statusColor} size={24} />
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
            <TrendingUp size={12} />
            {trend}
          </div>
        )}
      </div>
      <h3 className="text-slate-400 text-sm font-medium mb-1">{title}</h3>
      <div className="text-2xl font-bold text-slate-100 mb-1">{value}</div>
      <div className="text-xs text-slate-500">{subtext}</div>
    </div>
  );
};

export default function DashboardV2() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [nlopsInput, setNlopsInput] = useState('');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
      {/* --- Sidebar --- */}
      <aside className={`fixed left-0 top-0 h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 z-20 ${isSidebarOpen ? 'w-64' : 'w-20'}`}>
        <div className="flex items-center gap-3 p-6 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="text-white" size={20} />
          </div>
          {isSidebarOpen && <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">SentinAI</span>}
        </div>

        <nav className="p-4 space-y-2">
          <SidebarItem icon={LayoutDashboard} label={isSidebarOpen ? "Overview" : ""} active />
          <SidebarItem icon={Server} label={isSidebarOpen ? "Nodes" : ""} />
          <SidebarItem icon={Activity} label={isSidebarOpen ? "Analytics" : ""} />
          <SidebarItem icon={DollarSign} label={isSidebarOpen ? "Cost" : ""} />
          <div className="my-4 border-t border-slate-800" />
          <SidebarItem icon={MessageSquare} label={isSidebarOpen ? "NLOps" : ""} />
          <SidebarItem icon={Settings} label={isSidebarOpen ? "Settings" : ""} />
        </nav>

        <div className="absolute bottom-0 w-full p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <span className="font-bold text-cyan-400">T</span>
            </div>
            {isSidebarOpen && (
              <div className="overflow-hidden">
                <div className="font-medium text-sm text-slate-200">Theo Bros</div>
                <div className="text-xs text-slate-500">Admin</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className={`transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-20'}`}>
        
        {/* Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10 px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
              <Menu size={20} className="text-slate-400" />
            </button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input 
                type="text" 
                placeholder="Search resources..." 
                className="bg-slate-900 border border-slate-800 rounded-full pl-10 pr-4 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 w-64"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-400">System Healthy</span>
            </div>
            <button className="relative p-2 hover:bg-slate-800 rounded-lg transition-colors">
              <Bell size={20} className="text-slate-400" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-slate-950" />
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-6 space-y-6">
          
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard 
              title="vCPU Usage" 
              value="4 vCPU" 
              subtext="Auto-scaled from 2 vCPU" 
              icon={Cpu} 
              status="success"
              trend="+100%"
            />
            <StatCard 
              title="Memory Load" 
              value="6.2 GB" 
              subtext="85% of allocated capacity" 
              icon={Server} 
              status="warning"
            />
            <StatCard 
              title="TPS (L2)" 
              value="1,245" 
              subtext="Peak: 2,400 TPS" 
              icon={Zap} 
              status="neutral"
              trend="+12%"
            />
            <StatCard 
              title="Est. Daily Cost" 
              value="$4.20" 
              subtext="-15% vs last week" 
              icon={DollarSign} 
              status="success"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Chart */}
            <div className="lg:col-span-2 p-6 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-slate-200">System Performance</h3>
                <div className="flex gap-2">
                  <select className="bg-slate-800 border border-slate-700 text-xs rounded-md px-2 py-1 text-slate-300">
                    <option>Last 24h</option>
                    <option>Last 7d</option>
                  </select>
                </div>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={PERFORMANCE_DATA}>
                    <defs>
                      <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                      itemStyle={{ color: '#cbd5e1' }}
                    />
                    <Area type="monotone" dataKey="cpu" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" name="CPU %" />
                    <Area type="monotone" dataKey="memory" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorMem)" name="Mem %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Side Panel: NLOps / Logs */}
            <div className="space-y-6">
              {/* Cost Widget */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50">
                <h3 className="font-semibold text-slate-200 mb-4">Cost Projection</h3>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={COST_DATA}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                      />
                      <Line type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="projected" stroke="#64748b" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent Logs */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-200">Live Logs</h3>
                  <button className="text-xs text-cyan-400 hover:text-cyan-300">View All</button>
                </div>
                <div className="space-y-3">
                  {LOGS.map(log => (
                    <div key={log.id} className="flex gap-3 items-start text-sm">
                      <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        log.type === 'info' ? 'bg-blue-400' : 
                        log.type === 'warning' ? 'bg-amber-400' : 
                        'bg-emerald-400'
                      }`} />
                      <div className="flex-1">
                        <div className="text-slate-300">{log.message}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{log.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* NLOps Floating Bar */}
          <div className="fixed bottom-6 right-6 w-96">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4">
              <div className="flex items-center gap-2 mb-3 text-slate-400 text-xs uppercase font-bold tracking-wider">
                <Terminal size={12} />
                NLOps Assistant
              </div>
              <div className="h-48 overflow-y-auto mb-3 space-y-2 text-sm custom-scrollbar">
                <div className="bg-slate-800/50 p-2 rounded-lg text-slate-300 max-w-[85%]">
                  Hello! I'm monitoring the system. No anomalies detected in the last hour.
                </div>
                <div className="bg-cyan-500/10 p-2 rounded-lg text-cyan-100 max-w-[85%] ml-auto">
                  Show me the cost report.
                </div>
                <div className="bg-slate-800/50 p-2 rounded-lg text-slate-300 max-w-[85%]">
                  Current daily cost is $4.20. You can save ~15% by enabling aggressive downscaling during off-peak hours.
                </div>
              </div>
              <div className="relative">
                <input 
                  type="text" 
                  value={nlopsInput}
                  onChange={(e) => setNlopsInput(e.target.value)}
                  placeholder="Ask SentinAI..." 
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-slate-800 rounded-md text-cyan-400 transition-colors">
                  <Zap size={16} />
                </button>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
