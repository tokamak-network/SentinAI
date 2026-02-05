"use client";

import { useEffect, useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, ComposedChart, Bar
} from 'recharts';
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield
} from 'lucide-react';

// --- Interfaces ---
interface MetricData {
  timestamp: string;
  metrics: {
    l1BlockHeight: number;
    blockHeight: number;
    txPoolCount: number;
    cpuUsage: number;
    memoryUsage: number;
    gethVcpu: number;
    gethMemGiB: number;
    syncLag: number;
  };
  components?: ComponentData[];
  cost: {
    hourlyRate: number;
    opGethMonthlyCost?: number;
    currentSaving?: number;
    dynamicMonthlyCost?: number;
    maxMonthlySaving?: number;
    fixedCost?: number;
    monthlyEstimated: number;
    monthlySaving: number;
    isPeakMode: boolean;
  };
}

interface ComponentData {
  name: string;
  type: string;
  strategy?: string;
  current: string;
  status: string;
  icon: string;
  rawCpu?: number;
  metrics?: {
    cpuReq: string;
    memReq: string;
    node: string;
  };
}

// --- Main Dashboard Component ---
export default function Dashboard() {
  // State
  const [dataHistory, setDataHistory] = useState<any[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stressMode, setStressMode] = useState(false);
  const [logInsight, setLogInsight] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Logic
  const checkLogs = async (mode: string) => {
    setLogInsight(null);
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/analyze-logs?mode=${mode}`);
      const data = await res.json();
      setLogInsight(data.analysis);
    } catch (e) {
      console.error(e);
      setLogInsight({ summary: "Failed to connect to AI Gateway.", severity: "critical" })
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Track current stressMode for async operations
  const stressModeRef = useRef(stressMode);
  // Track active abort controller to cancel pending requests
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stressModeRef.current = stressMode;
    // Clear history when mode changes
    setDataHistory([]);

    // Cancel any pending request from previous mode
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const fetchData = async () => {
      // Create new controller for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const timestamp = Date.now();
      const currentMode = stressModeRef.current; // Use ref for latest access inside async
      const url = `/api/metrics?t=${timestamp}${currentMode ? '&stress=true' : ''}`;

      try {
        const res = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await res.json();

        // Skip if stressMode changed during request (Double check)
        if (currentMode !== stressModeRef.current) {
          return;
        }

        setCurrent(data);

        const point = {
          name: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          cpu: data.metrics.cpuUsage,
          gethVcpu: data.metrics.gethVcpu,
          gethMemGiB: data.metrics.gethMemGiB,
          saving: data.cost.monthlySaving,
          cost: data.cost.monthlyEstimated,
        };
        setDataHistory(prev => [...prev.slice(-20), point]);
        setIsLoading(false);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Fetch aborted');
        } else {
          console.error(err);
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [stressMode]);


  if (isLoading) return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50 text-blue-600">
      <div className="flex flex-col items-center gap-4">
        <Activity className="animate-spin w-10 h-10" />
        <span className="font-medium font-sans">Connecting to Cluster...</span>
      </div>
    </div>
  );

  // --- Render ---
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-gray-800 font-sans p-6 md:p-10 max-w-[1600px] mx-auto">

      {/* 1. Header (Clean & Functional) */}
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 p-3 rounded-2xl shadow-xl shadow-slate-200 text-white flex items-center justify-center">
            <Shield size={32} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
              SentinAI
            </h1>
            <p className="text-sm mt-1 font-medium text-gray-500">
              Autonomous Node Guardian for Optimism L2
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Stress Mode Toggle */}
          <button
            onClick={() => setStressMode(!stressMode)}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-all ${stressMode
              ? 'bg-red-500 text-white ring-4 ring-red-500/20 hover:bg-red-600 scale-105'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600'
              }`}
          >
            {stressMode ? <Zap size={18} fill="currentColor" className="animate-pulse" /> : <Zap size={18} />}
            {stressMode ? 'Simulating High Traffic...' : 'Simulate Load'}
          </button>
        </div>
      </header>

      {/* Network Stats Bar */}
      <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">L1 Block</p>
              <p className="text-lg font-bold text-gray-900 font-mono">{current?.metrics.l1BlockHeight?.toLocaleString() || '—'}</p>
            </div>
          </div>
          <div className="h-8 w-px bg-gray-200"></div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">L2 Block</p>
              <p className="text-lg font-bold text-gray-900 font-mono">{current?.metrics.blockHeight?.toLocaleString() || '—'}</p>
            </div>
          </div>
          <div className="h-8 w-px bg-gray-200"></div>
          <div>
            <p className="text-[10px] text-gray-400 font-semibold uppercase">TxPool Pending</p>
            <p className="text-lg font-bold text-gray-900 font-mono">{current?.metrics.txPoolCount || 0}</p>
          </div>
          <div className="h-8 w-px bg-gray-200"></div>
          <div>
            <p className="text-[10px] text-gray-400 font-semibold uppercase">Sync Status</p>
            <p className="text-lg font-bold text-green-600 flex items-center gap-1">
              <CheckCircle2 size={14} />
              {current?.metrics.syncLag === 0 ? 'Synced' : `Lag: ${current?.metrics.syncLag}`}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Top Section: Core Metrics & AI Monitor (5:5 Split) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

        {/* Left: Resource Center */}
        <div className="bg-[#F8F9FA] rounded-3xl p-6 shadow-sm border border-gray-200/60 relative overflow-hidden min-h-[520px] flex flex-col">

          {/* Header */}
          <div className="mb-5">
            <h2 className="text-2xl font-bold text-gray-900">Resource Center</h2>
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mt-1">
              Optimization Active
            </p>
          </div>

          {/* Scaling Forecast Card */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Scaling Forecast</h3>
              </div>
              <span className="bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">Live</span>
            </div>

            {/* AI Insight Box */}
            <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-start gap-2">
                <Zap size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-gray-600 leading-relaxed">
                  {current?.cost.isPeakMode
                    ? `Scaling up to handle traffic spike, current cost: $${current?.cost.opGethMonthlyCost?.toFixed(0) || '166'}/mo.`
                    : `Running at ${current?.metrics.gethVcpu || 1} vCPU, estimated savings: `}
                  {!current?.cost.isPeakMode && <span className="text-green-600 font-bold">${current?.cost.monthlySaving?.toFixed(0) || '124'}/mo</span>}
                </p>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <h4 className="font-semibold text-gray-900 text-sm">System Health</h4>
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">vCPU</span>
                  <Cpu size={12} className="text-gray-300" />
                </div>
                <p className="text-xl font-bold text-gray-900">{current?.metrics.gethVcpu || '1'}<span className="text-xs text-gray-400 font-normal ml-1">/ 8</span></p>
                <div className="w-full h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${((current?.metrics.gethVcpu || 1) / 8) * 100}%` }}></div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">Memory</span>
                  <Server size={12} className="text-gray-300" />
                </div>
                <p className="text-xl font-bold text-gray-900">{current?.metrics.gethMemGiB || '2'}<span className="text-xs text-gray-400 font-normal ml-1">GB</span></p>
                <div className="w-full h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${((current?.metrics.gethMemGiB || 2) / 16) * 100}%` }}></div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">CPU Load</span>
                  <Activity size={12} className="text-gray-300" />
                </div>
                <p className="text-xl font-bold text-gray-900">{current?.metrics.cpuUsage?.toFixed(0) || '0'}<span className="text-xs text-gray-400 font-normal ml-1">%</span></p>
                <div className="w-full h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(current?.metrics.cpuUsage || 0, 100)}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Total Saved Card (Dark) */}
          <div className="mt-auto bg-[#1A1D21] rounded-2xl p-5 text-white">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                {current?.cost.isPeakMode ? 'Cost Increase (Peak)' : 'Total Saved (MTD)'}
              </span>
              {current?.cost.isPeakMode
                ? <ArrowUpRight size={18} className="text-red-400" />
                : <TrendingDown size={18} className="text-green-400" />
              }
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black">
                ${Math.abs(current?.cost.monthlySaving || 124).toFixed(0)}
              </span>
              <span className={`text-sm font-bold ${current?.cost.isPeakMode ? 'text-red-400' : 'text-green-400'}`}>
                {current?.cost.isPeakMode ? '+' : '-'}{Math.abs((current?.cost.monthlySaving || 0) / (current?.cost.fixedCost || 166) * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2 leading-relaxed">
              <span className="text-gray-300">vs Fixed 4 vCPU (${current?.cost.fixedCost?.toFixed(0) || '166'}/mo)</span> — {current?.cost.isPeakMode ? 'Scaling up to handle traffic spike.' : 'AI-driven scaling reduced Fargate costs.'}
            </p>
          </div>
        </div>

        {/* Right: AI Monitor */}
        <div className="bg-[#1A1D21] rounded-3xl shadow-xl overflow-hidden border border-gray-800 flex flex-col min-h-[520px]">

          {/* Terminal Header */}
          <div className="bg-[#25282D] px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <ShieldAlert className={`${logInsight?.severity === 'critical' ? 'text-red-500 animate-pulse' : 'text-blue-400'}`} size={20} />
              <span className="text-gray-200 font-bold text-sm tracking-wide">ONE-CLICK CHECKUP MONITOR</span>
            </div>
            <span className="text-xs text-gray-500 font-mono">Real-time Analysis</span>
          </div>

          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

            {/* 1. Log Stream (Left) */}
            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-sm custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none"></div>

              <div className="space-y-4">

                {/* Simulated Stress Logs (Only show when stress mode is active) */}
                {stressMode && (
                  <LogBlock time={new Date().toLocaleTimeString()} source="op-geth" level="WARN" msg="TxPool overflow: 5021 pending txs. Re-prioritizing gas..." highlight={true} color="text-yellow-400" />
                )}

                {/* Analyzing State */}
                {isAnalyzing && (
                  <div className="flex flex-col items-center justify-center py-10 animate-pulse">
                    <div className="w-full max-w-xs bg-gray-800 rounded-full h-1.5 mb-4 overflow-hidden">
                      <div className="bg-blue-500 h-1.5 rounded-full animate-loading-bar"></div>
                    </div>
                    <p className="text-blue-400 font-mono text-xs animate-pulse">Running Diagnostics & Log Analysis...</p>
                  </div>
                )}

                {!logInsight && !isAnalyzing && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-50 mt-10">
                    <Activity size={32} className="mb-2" />
                    <p>System Ready... Waiting for checkup.</p>
                  </div>
                )}

                {/* AI Result Injection */}
                {logInsight && !isAnalyzing && (
                  <div className="my-6 p-4 rounded-lg bg-gray-800/50 border-l-4 border-blue-500 animate-slideIn">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-blue-400 font-bold text-xs uppercase">AI Analysis Report</span>
                      <span className="text-gray-500 text-[10px]">{new Date(logInsight.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap font-sans text-sm">
                      {logInsight.summary}
                    </p>
                    {logInsight.action_item && (
                      <div className="mt-3 pt-3 border-t border-gray-700/50">
                        <p className="text-green-400 font-bold text-xs flex items-center gap-2">
                          <CheckCircle2 size={12} /> SUGGESTED ACTION:
                        </p>
                        <p className="text-gray-400 text-xs mt-1 pl-5">
                          {logInsight.action_item}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Controls & Status (Right) */}
            <div className="w-full lg:w-80 bg-[#1A1D21] p-6 border-l border-gray-800 flex flex-col justify-between shrink-0">
              <div>
                <h4 className="text-gray-400 text-xs font-bold uppercase mb-4">Diagnostics Controls</h4>

                <button
                  onClick={() => checkLogs('live')}
                  disabled={isAnalyzing}
                  className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 mb-4 group ${isAnalyzing
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40'
                    }`}
                >
                  {isAnalyzing ? (
                    <Activity className="animate-spin" size={18} />
                  ) : (
                    <Activity className="group-hover:animate-spin" size={18} />
                  )}
                  {isAnalyzing ? 'ANALYZING...' : 'CHECK HEALTH'}
                </button>
              </div>

              <div className="mt-8">
                <p className="text-gray-500 text-xs text-center mb-2">System Status</p>
                <div className={`text-center py-2 rounded-lg font-bold text-sm border ${logInsight?.severity === 'critical'
                  ? 'bg-red-500/10 text-red-500 border-red-500/30'
                  : 'bg-green-500/10 text-green-500 border-green-500/30'
                  }`}>
                  {isAnalyzing ? 'RUNNING CHECKS...' : (logInsight?.severity?.toUpperCase() || 'MONITORING ACTIVE')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Section: Info Modules (3 Cols) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* Component Status */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200/60 h-full">
          <h3 className="font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Server size={18} className="text-gray-400" /> Components
          </h3>

          <div className="space-y-6">
            {current?.components?.map((comp, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {/* On/Off Icon */}
                    <div className={`relative flex items-center justify-center w-4 h-4`}>
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${comp.status.includes('Stopped') ? 'bg-gray-400 hidden' : 'bg-green-400'}`}></span>
                      <span className={`relative inline-flex rounded-full h-3 w-3 ${comp.status.includes('Stopped') ? 'bg-gray-400' : 'bg-green-500'}`}></span>
                    </div>
                    <span className="font-bold text-gray-700 text-sm">{comp.name === 'L2 Client' ? 'Execution Client' : comp.name}</span>
                  </div>
                  {comp.strategy && (
                    <span className="text-[10px] text-gray-400 font-bold bg-gray-100 px-2 py-0.5 rounded uppercase">
                      {comp.strategy}
                    </span>
                  )}
                </div>

                {/* Resource Bar for L2 Client */}
                {comp.name === 'L2 Client' && (
                  <div className="pl-7">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                      <span>Usage</span>
                      <span className="font-mono text-blue-600 font-bold">
                        {current.metrics.cpuUsage.toFixed(0)}% CPU / {current.metrics.memoryUsage.toFixed(0)} MB
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-1000"
                        style={{ width: `${current.metrics.cpuUsage}%` }}
                      ></div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 pl-1">
                      Instance: {comp.current}
                    </p>
                  </div>
                )}

                {/* Generic Status for others */}
                {comp.name !== 'L2 Client' && (
                  <p className="text-xs text-gray-400 pl-7">{comp.current} • {comp.status}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Quick Stats Grid - Vertical Stack */}
        <div className="flex flex-col gap-4 h-full">
          <div className="bg-white p-6 rounded-3xl border border-gray-200/60 shadow-sm flex flex-col items-center justify-center h-full">
            <Activity className="text-blue-500 mb-2" size={24} />
            <p className="text-xs text-gray-400 font-bold uppercase">Network Latency</p>
            <p className="text-3xl font-black text-gray-800 mt-1">24ms</p>
            <p className="text-[10px] text-green-500 mt-1 bg-green-50 px-2 rounded">Optimal</p>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-gray-200/60 shadow-sm flex flex-col items-center justify-center h-full">
            <CheckCircle2 className="text-green-500 mb-2" size={24} />
            <p className="text-xs text-gray-400 font-bold uppercase">System Uptime</p>
            <p className="text-3xl font-black text-green-600 mt-1">99.99%</p>
            <p className="text-[10px] text-gray-400 mt-1">Last 30 days</p>
          </div>
        </div>

        {/* Resources / Docs */}
        <div className="bg-gradient-to-br from-[#2D33EB] to-[#1E23A0] rounded-3xl p-8 text-white shadow-lg shadow-blue-900/20 relative overflow-hidden group h-full flex flex-col justify-between">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-all"></div>

          <div>
            <h3 className="text-xl font-bold mb-3 relative z-10">Documentation</h3>
            <p className="text-blue-200 text-sm mb-6 leading-relaxed relative z-10">
              Explore Tokamak Network technical docs for deeper insights into L2 optimization and infrastructure.
            </p>
          </div>

          <a
            href="https://docs.tokamak.network/home"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-white text-blue-800 font-bold py-3.5 rounded-xl hover:bg-blue-50 transition-all text-sm text-center shadow-lg relative z-10"
          >
            View Documentation
          </a>
        </div>

      </div>
    </div>
  );
}

// --- Sub Components ---

function LogBlock({ time, source, level, msg, highlight, color }: any) {
  return (
    <div className={`flex items-start gap-3 font-mono text-xs ${highlight ? 'bg-white/5 -mx-2 px-2 py-1 rounded' : ''}`}>
      <span className="text-gray-600 shrink-0" suppressHydrationWarning>[{time}]</span>
      <span className={`shrink-0 font-bold ${level === 'INFO' ? 'text-green-500' : level === 'WARN' ? 'text-yellow-500' : 'text-red-500'}`}>{level}</span>
      <span className="shrink-0 text-gray-500 w-24">[{source}]</span>
      <span className={`break-all ${color || 'text-gray-300'}`}>{msg}</span>
    </div>
  )
}
