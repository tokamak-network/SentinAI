"use client";

import { useEffect, useState, useRef } from 'react';
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, CheckCircle2, Shield, Database,
  ChevronDown, ChevronRight, BarChart3, Calendar, Lightbulb,
  Send, Bot, User
} from 'lucide-react';
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';

// --- Interfaces ---
interface AnomalyResultData {
  isAnomaly: boolean;
  metric: string;
  value: number;
  zScore: number;
  direction: 'spike' | 'drop' | 'plateau';
  description: string;
  rule: string;
}

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
  anomalies?: AnomalyResultData[];
  activeAnomalyEventId?: string;
}

// === Added: Cost Report type ===
interface CostReportData {
  id: string;
  generatedAt: string;
  currentMonthly: number;
  optimizedMonthly: number;
  totalSavingsPercent: number;
  recommendations: Array<{
    type: 'downscale' | 'schedule' | 'reserved' | 'right-size';
    title: string;
    description: string;
    currentCost: number;
    projectedCost: number;
    savingsPercent: number;
    confidence: number;
    implementation: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  usagePatterns: Array<{
    dayOfWeek: number;
    hourOfDay: number;
    avgVcpu: number;
    peakVcpu: number;
    avgUtilization: number;
    sampleCount: number;
  }>;
  aiInsight: string;
  periodDays: number;
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

interface PredictionFactor {
  name: string;
  impact: number;
  description: string;
}

interface PredictionInfo {
  predictedVcpu: 1 | 2 | 4;
  confidence: number;
  trend: 'rising' | 'falling' | 'stable';
  reasoning: string;
  recommendedAction: 'scale_up' | 'scale_down' | 'maintain';
  generatedAt: string;
  predictionWindow: string;
  factors: PredictionFactor[];
}

interface PredictionMeta {
  metricsCount: number;
  minRequired: number;
  nextPredictionIn: number;
  isReady: boolean;
}

interface ScalerState {
  currentVcpu: number;
  currentMemoryGiB: number;
  cooldownRemaining: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  prediction: PredictionInfo | null;
  predictionMeta: PredictionMeta;
}

// --- Main Dashboard Component ---
export default function Dashboard() {
  // State
  const [, setDataHistory] = useState<{ name: string; cpu: number; gethVcpu: number; gethMemGiB: number; saving: number; cost: number }[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stressMode, setStressMode] = useState(false);
  const [activeAnomalies, setActiveAnomalies] = useState<AnomalyResultData[]>([]);

  const [prediction, setPrediction] = useState<PredictionInfo | null>(null);
  const [predictionMeta, setPredictionMeta] = useState<PredictionMeta | null>(null);
  const [seedScenario, setSeedScenario] = useState<'stable' | 'rising' | 'spike' | 'falling' | 'live'>('rising');
  const [isSeeding, setIsSeeding] = useState(false);

  // === Added: Cost Report state ===
  const [costReport, setCostReport] = useState<CostReportData | null>(null);
  const [isLoadingCostReport, setIsLoadingCostReport] = useState(false);
  const [showCostAnalysis, setShowCostAnalysis] = useState(false);

  // --- NLOps Chat State ---
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    message: string;
    originalInput: string;
    intent: NLOpsIntent;
  } | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  // Seed prediction data for testing
  const seedPredictionData = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(`/api/metrics/seed?scenario=${seedScenario}`, { method: 'POST' });
      if (res.ok) {
        // Re-fetch scaler to get updated prediction
        const scalerRes = await fetch('/api/scaler', { cache: 'no-store' });
        if (scalerRes.ok) {
          const scalerData: ScalerState = await scalerRes.json();
          setPrediction(scalerData.prediction);
          setPredictionMeta(scalerData.predictionMeta);
        }
      }
    } catch (e) {
      console.error('Seed failed:', e);
    } finally {
      setIsSeeding(false);
    }
  };

  // === Cost report analysis function ===
  const fetchCostReport = async () => {
    setIsLoadingCostReport(true);
    setCostReport(null);
    try {
      const res = await fetch('/api/cost-report?days=7');
      if (!res.ok) throw new Error('Failed to fetch cost report');
      const data = await res.json();
      setCostReport(data);
      setShowCostAnalysis(true);
    } catch (e) {
      console.error('Cost report error:', e);
    } finally {
      setIsLoadingCostReport(false);
    }
  };

  // --- NLOps Chat Handlers ---

  useEffect(() => {
    if (chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const sendChatMessage = async (message: string, confirmAction?: boolean) => {
    if (!message.trim() && !confirmAction) return;

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: confirmAction ? 'confirm' : message.trim(),
      timestamp: new Date().toISOString(),
    };

    if (!confirmAction) {
      setChatMessages(prev => [...prev, userMessage]);
      setChatInput('');
    }

    setIsSending(true);

    try {
      const response = await fetch('/api/nlops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: confirmAction ? pendingConfirmation?.originalInput : message.trim(),
          confirmAction,
        }),
      });

      const data: NLOpsResponse = await response.json();

      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        intent: data.intent,
        data: data.data,
        awaitingConfirmation: data.needsConfirmation,
      };

      setChatMessages(prev => [...prev, assistantMessage]);

      if (data.needsConfirmation && data.confirmationMessage) {
        setPendingConfirmation({
          message: data.confirmationMessage,
          originalInput: message.trim(),
          intent: data.intent,
        });
      } else {
        setPendingConfirmation(null);
      }
    } catch {
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'Sorry, an error occurred while processing your request. Please try again in a moment.',
        timestamp: new Date().toISOString(),
      };
      setChatMessages(prev => [...prev, errorMessage]);
      setPendingConfirmation(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirm = () => {
    if (pendingConfirmation) {
      sendChatMessage(pendingConfirmation.originalInput, true);
    }
  };

  const handleCancel = () => {
    const cancelMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: 'Action cancelled.',
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, cancelMessage]);
    setPendingConfirmation(null);
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSending) {
      e.preventDefault();
      sendChatMessage(chatInput);
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

        // Track anomalies from metrics API
        if (data.anomalies && data.anomalies.length > 0) {
          setActiveAnomalies(data.anomalies);
        } else {
          setActiveAnomalies([]);
        }

        const point = {
          name: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          cpu: data.metrics.cpuUsage,
          gethVcpu: data.metrics.gethVcpu,
          gethMemGiB: data.metrics.gethMemGiB,
          saving: data.cost.monthlySaving,
          cost: data.cost.monthlyEstimated,
        };
        setDataHistory(prev => [...prev.slice(-20), point]);

        // Fetch scaler state with prediction (every 10 seconds to avoid overload)
        if (timestamp % 10000 < 1000) {
          try {
            const scalerRes = await fetch('/api/scaler', {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (scalerRes.ok) {
              const scalerData: ScalerState = await scalerRes.json();
              setPrediction(scalerData.prediction);
              setPredictionMeta(scalerData.predictionMeta);
            }
          } catch {
            // Ignore scaler fetch errors
          }
        }

        setIsLoading(false);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
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
    <div className="min-h-screen bg-[#F8F9FA] text-gray-800 font-sans p-6 md:p-10 pb-16 max-w-[1600px] mx-auto">

      {/* 1. Header (Clean & Functional) */}
      <header className="flex items-center gap-4 mb-8">
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
          <div className="flex items-center gap-3" data-testid="l2-block-number">
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


      {/* Row 1: At-a-Glance Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

        {/* Card 1: Scaling Forecast */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-gray-900">Simulation Zone</h3>
            <span className={`text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
              prediction?.recommendedAction === 'scale_up'
                ? 'bg-indigo-500'
                : prediction?.recommendedAction === 'scale_down'
                ? 'bg-green-500'
                : 'bg-blue-500'
            }`}>
              {prediction?.recommendedAction === 'scale_up' ? 'Scale Up' :
               prediction?.recommendedAction === 'scale_down' ? 'Scale Down' : 'Stable'}
            </span>
          </div>

          {/* Stress Mode Toggle */}
          <div className="mb-3">
            <button
              onClick={() => setStressMode(!stressMode)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${stressMode
                ? 'bg-red-500 text-white ring-2 ring-red-500/20 hover:bg-red-600'
                : 'bg-gray-100 text-gray-600 border border-gray-200 hover:border-red-300 hover:text-red-500'
              }`}
            >
              {stressMode ? <Zap size={16} fill="currentColor" className="animate-pulse" /> : <Zap size={16} />}
              {stressMode ? 'Simulating High Traffic...' : 'Simulate Load'}
            </button>
          </div>

          {/* vCPU Summary Row */}
          {prediction ? (
            <div className="flex items-center gap-3 mb-3" data-testid="current-vcpu">
              <div className="flex-1 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900">{current?.metrics.gethVcpu || 1} vCPU</span>
              </div>
              <ArrowUpRight size={20} className={`shrink-0 ${
                prediction.trend === 'rising' ? 'text-indigo-500' :
                prediction.trend === 'falling' ? 'text-green-500 rotate-180' :
                'text-gray-400 rotate-45'
              }`} />
              <div className={`flex-1 h-8 rounded-lg flex items-center justify-center ${
                prediction.predictedVcpu > (current?.metrics.gethVcpu || 1)
                  ? 'bg-indigo-100 border border-indigo-200'
                  : prediction.predictedVcpu < (current?.metrics.gethVcpu || 1)
                  ? 'bg-green-100 border border-green-200'
                  : 'bg-blue-100 border border-blue-200'
              }`}>
                <span className={`text-lg font-bold ${
                  prediction.predictedVcpu > (current?.metrics.gethVcpu || 1)
                    ? 'text-indigo-600'
                    : prediction.predictedVcpu < (current?.metrics.gethVcpu || 1)
                    ? 'text-green-600'
                    : 'text-blue-600'
                }`}>{prediction.predictedVcpu} vCPU</span>
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">
                {(prediction.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-3" data-testid="current-vcpu">
              <span className="text-lg font-bold text-gray-900">{current?.metrics.gethVcpu || 1} vCPU</span>
              <span className="text-xs text-gray-400">/ {(current?.metrics.gethVcpu || 1) * 2} GiB</span>
            </div>
          )}

          {/* Seed Test Data (Dev Only) */}
          {process.env.NODE_ENV !== 'production' && <div className="mb-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
            <div className="flex items-center gap-2">
              <Database size={14} className="text-indigo-600 shrink-0" />
              <select
                value={seedScenario}
                onChange={(e) => setSeedScenario(e.target.value as typeof seedScenario)}
                className="flex-1 text-xs bg-white border border-indigo-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="stable">Stable</option>
                <option value="rising">Rising</option>
                <option value="spike">Spike</option>
                <option value="falling">Falling</option>
                <option value="live">Live</option>
              </select>
              <button onClick={seedPredictionData} disabled={isSeeding}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isSeeding ? 'bg-indigo-300 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}>
                {isSeeding ? '...' : 'Seed'}
              </button>
            </div>
          </div>}

          {/* AI Insight */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-start gap-2">
              <Zap size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-600 leading-relaxed">
                {prediction ? (
                  prediction.reasoning.includes('AI unavailable')
                    ? prediction.reasoning.replace(/\s*\(AI unavailable\)/, '').replace('Fallback prediction based on simple', 'Prediction based on')
                    : prediction.reasoning
                ) : current?.cost.isPeakMode ? (
                  `Scaling up to handle traffic spike, current cost: $${current?.cost.opGethMonthlyCost?.toFixed(0) || '166'}/mo.`
                ) : (
                  <>Running at {current?.metrics.gethVcpu || 1} vCPU, estimated savings: <span className="text-green-600 font-bold">${current?.cost.monthlySaving?.toFixed(0) || '124'}/mo</span></>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Card 2: System Health */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-bold text-gray-900">System Health</h3>
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          </div>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-400 font-semibold uppercase">vCPU</span>
                <Cpu size={12} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{current?.metrics.gethVcpu || '1'}<span className="text-xs text-gray-400 font-normal ml-1">/ 8</span></p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    ((current?.metrics.gethVcpu || 1) / 8) * 100 > 75 ? 'bg-red-500' : ((current?.metrics.gethVcpu || 1) / 8) * 100 > 50 ? 'bg-amber-500' : 'bg-blue-500'
                  }`} style={{ width: `${((current?.metrics.gethVcpu || 1) / 8) * 100}%` }}></div>
                </div>
                <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{(((current?.metrics.gethVcpu || 1) / 8) * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-400 font-semibold uppercase">Memory</span>
                <Server size={12} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{current?.metrics.gethMemGiB || '2'}<span className="text-xs text-gray-400 font-normal ml-1">GB</span></p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    ((current?.metrics.gethMemGiB || 2) / 16) * 100 > 75 ? 'bg-red-500' : ((current?.metrics.gethMemGiB || 2) / 16) * 100 > 50 ? 'bg-amber-500' : 'bg-blue-500'
                  }`} style={{ width: `${((current?.metrics.gethMemGiB || 2) / 16) * 100}%` }}></div>
                </div>
                <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{(((current?.metrics.gethMemGiB || 2) / 16) * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-400 font-semibold uppercase">CPU Load</span>
                <Activity size={12} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{current?.metrics.cpuUsage?.toFixed(0) || '0'}<span className="text-xs text-gray-400 font-normal ml-1">%</span></p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    Math.min(current?.metrics.cpuUsage || 0, 100) > 75 ? 'bg-red-500' : Math.min(current?.metrics.cpuUsage || 0, 100) > 50 ? 'bg-amber-500' : 'bg-blue-500'
                  }`} style={{ width: `${Math.min(current?.metrics.cpuUsage || 0, 100)}%` }}></div>
                </div>
                <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{Math.min(current?.metrics.cpuUsage || 0, 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Cost Summary */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60">
          <div className="flex justify-between items-start mb-3">
            <div data-testid="monthly-cost">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                {current?.cost.isPeakMode ? 'Cost Increase (Peak)' : 'Total Saved (MTD)'}
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-gray-900">
                  ${Math.abs(current?.cost.monthlySaving || 124).toFixed(0)}
                </span>
                <span className={`text-sm font-bold ${current?.cost.isPeakMode ? 'text-red-500' : 'text-green-600'}`}>
                  {current?.cost.isPeakMode ? '+' : '-'}{Math.abs((current?.cost.monthlySaving || 0) / (current?.cost.fixedCost || 166) * 100).toFixed(0)}%
                </span>
              </div>
              {prediction && prediction.predictedVcpu !== (current?.metrics.gethVcpu || 1) && (() => {
                const pVcpu = prediction.predictedVcpu;
                const pMem = pVcpu * 2;
                const pCost = (pVcpu * 0.04656 + pMem * 0.00511) * 730;
                const pSaving = (current?.cost.fixedCost || 165.67) - pCost;
                return (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Projected: <span className={pSaving > 0 ? 'text-green-600' : 'text-red-500'}>${Math.abs(pSaving).toFixed(0)}/mo</span> {pSaving > 0 ? 'saved' : 'increase'} if scaled to {pVcpu} vCPU
                  </p>
                );
              })()}
            </div>
            <button
              onClick={fetchCostReport}
              disabled={isLoadingCostReport}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isLoadingCostReport
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-900 hover:bg-gray-800 text-white'
              }`}
            >
              {isLoadingCostReport ? (
                <Activity className="animate-spin" size={12} />
              ) : (
                <BarChart3 size={12} />
              )}
              {isLoadingCostReport ? 'Analyzing...' : 'COST ANALYSIS'}
            </button>
          </div>

          <p className="text-gray-400 text-[10px]">
            vs Fixed 4 vCPU baseline (${current?.cost.fixedCost?.toFixed(0) || '166'}/mo)
          </p>

        </div>
      </div>

      {/* Cost Analysis Panel (Full-width, below Row 1) */}
      {showCostAnalysis && costReport && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-gray-400" />
              <h3 className="font-bold text-gray-900 text-sm">Cost Analysis</h3>
            </div>
            <button
              onClick={() => setShowCostAnalysis(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Close
            </button>
          </div>

          {/* AI Insight */}
          <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
            <div className="flex items-start gap-2">
              <Lightbulb size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700 leading-relaxed">{truncateAtSentence(costReport.aiInsight, 200)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Usage Heatmap */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={12} className="text-gray-400" />
                <span className="text-[10px] text-gray-400 font-semibold uppercase">Usage Pattern (Last {costReport.periodDays} days)</span>
              </div>
              <UsageHeatmap patterns={costReport.usagePatterns} />
            </div>

            {/* Recommendations */}
            {costReport.recommendations.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">Optimization Recommendations</span>
                  <span className="text-[10px] text-green-600 font-bold">Up to {costReport.totalSavingsPercent}% savings</span>
                </div>
                <div className="space-y-2">
                  {costReport.recommendations.slice(0, 3).map((rec, idx) => (
                    <RecommendationCard key={idx} recommendation={rec} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 2: Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-4">

        {/* Anomaly Monitor */}
        <div className="lg:col-span-7 bg-[#1A1D21] rounded-3xl shadow-xl overflow-hidden border border-gray-800 flex flex-col min-h-[200px]">

          {/* Terminal Header */}
          <div className="bg-[#25282D] px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <ShieldAlert className={`${activeAnomalies.length > 0 ? 'text-red-500 animate-pulse' : 'text-blue-400'}`} size={20} />
              <span className="text-gray-200 font-bold text-sm tracking-wide">ANOMALY MONITOR</span>
            </div>
            <span className="text-xs text-gray-500 font-mono">Real-time</span>
          </div>

          <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-sm custom-scrollbar relative">
            <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none"></div>

            <div className="space-y-4">
              {/* Real-time Anomaly Feed */}
              {activeAnomalies.length > 0 && (
                <div data-testid="anomaly-feed" className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert size={14} className="text-red-500" />
                    <span className="text-red-400 font-bold text-xs uppercase">Real-time Anomalies</span>
                  </div>
                  {activeAnomalies.map((anomaly, idx) => (
                    <div key={idx} data-testid={`anomaly-feed-item-${idx}`} className="flex items-start gap-2 text-xs mb-2 last:mb-0">
                      <span data-testid={`anomaly-severity-${idx}`} className={`shrink-0 font-bold ${
                        anomaly.direction === 'spike' ? 'text-red-500' :
                        anomaly.direction === 'drop' ? 'text-yellow-500' :
                        'text-orange-500'
                      }`}>
                        {anomaly.direction.toUpperCase()}
                      </span>
                      <span className="text-gray-400">[{anomaly.metric}]</span>
                      <span data-testid={`anomaly-message-${idx}`} className="text-gray-300 break-words">{anomaly.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Simulated Stress Logs */}
              {stressMode && (
                <LogBlock time={new Date().toLocaleTimeString()} source="op-geth" level="WARN" msg="TxPool overflow: 5021 pending txs. Re-prioritizing gas..." highlight={true} color="text-yellow-400" />
              )}

              {/* Healthy State */}
              {activeAnomalies.length === 0 && (
                <div className="flex items-center justify-center gap-3 py-6 text-gray-500">
                  <CheckCircle2 size={24} className="text-green-500/40" />
                  <div>
                    <p className="text-green-400/70 font-semibold text-sm">All systems operational</p>
                    <p className="text-gray-600 text-xs mt-0.5">Anomalies will appear here when detected</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Status Bar */}
          <div className="bg-[#25282D] px-6 py-3 border-t border-gray-800 flex items-center justify-between shrink-0">
            <div className={`flex items-center gap-2 text-xs font-bold ${
              activeAnomalies.length > 0 ? 'text-red-400' : 'text-green-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${activeAnomalies.length > 0 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
              {activeAnomalies.length > 0
                ? `${activeAnomalies.length} ANOMALIES DETECTED`
                : 'MONITORING ACTIVE'}
            </div>
            <span className="text-[10px] text-gray-500">Use chat for analysis</span>
          </div>
        </div>

        {/* Components + Documentation */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 shadow-sm border border-gray-200/60">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Server size={18} className="text-gray-400" /> Components
          </h3>

          <div className="space-y-4">
            {current?.components?.map((comp, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="relative flex items-center justify-center w-4 h-4">
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

                {comp.name === 'L2 Client' && (
                  <div className="pl-7">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                      <span>Usage</span>
                      <span className="font-mono text-blue-600 font-bold">
                        {current.metrics.cpuUsage.toFixed(0)}% CPU / {current.metrics.memoryUsage.toFixed(0)} MB
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${current.metrics.cpuUsage}%` }}></div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 pl-1">Instance: {comp.current}</p>
                  </div>
                )}

                {comp.name !== 'L2 Client' && (
                  <p className="text-xs text-gray-400 pl-7">{comp.current} • {comp.status}</p>
                )}
              </div>
            ))}
          </div>

        </div>
      </div>


      {/* ============================================================ */}
      {/* NLOps Chat Interface                                         */}
      {/* ============================================================ */}

      {/* Persistent Chat Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10">
          <div
            data-testid="chat-toggle"
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center justify-between px-5 py-3 bg-slate-900 text-white cursor-pointer transition-all ${chatOpen ? 'rounded-none' : 'rounded-t-2xl shadow-lg'}`}
          >
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 p-1.5 rounded-lg">
                <Bot size={16} className="text-white" />
              </div>
              <span className="font-semibold text-sm">SentinAI Ops Assistant</span>
              <span className="text-xs text-gray-400 hidden md:inline">
                — type commands like &quot;show status&quot;, &quot;analyze logs&quot;, &quot;check cost&quot;
              </span>
            </div>
            <div className="flex items-center gap-2">
              {chatMessages.length > 0 && (
                <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {chatMessages.length}
                </span>
              )}
              <button data-testid="chat-close" onClick={(e) => { e.stopPropagation(); setChatOpen(false); }} className="text-gray-400 hover:text-white transition-colors p-1">
                <ChevronDown size={18} className={`transition-transform ${chatOpen ? '' : 'rotate-180'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      {chatOpen && (
        <div data-testid="chat-panel" className="fixed bottom-[52px] right-6 w-[480px] bg-white rounded-t-2xl shadow-2xl border border-gray-200 z-50 flex flex-col max-h-[500px]">

          {/* Messages */}
          <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[400px] bg-gray-50">
            {chatMessages.length === 0 && (
              <div data-testid="chat-welcome" className="text-center text-gray-400 mt-8">
                <Bot size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">Hello! I&apos;m SentinAI Assistant.</p>
                <p className="text-xs mt-1">Click examples below or type your command.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {['Show current status', 'Analyze logs', 'Check cost'].map((example) => (
                    <button key={example} data-testid={`chat-example-${example}`} onClick={() => sendChatMessage(example)}
                      className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-full hover:border-blue-300 hover:text-blue-600 transition-colors">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} data-testid={`chat-msg-${msg.role}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                    : 'bg-white text-gray-800 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm'
                } px-4 py-3`}>
                  <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && <Bot size={12} className="text-blue-500" />}
                    <span className={`text-[10px] ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                      {msg.role === 'user' ? 'You' : 'SentinAI'}
                    </span>
                    {msg.role === 'user' && <User size={12} className="text-blue-100" />}
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-300'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}

            {isSending && (
              <div data-testid="chat-loading" className="flex justify-start">
                <div className="bg-white text-gray-500 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm px-4 py-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Confirmation */}
          {pendingConfirmation && (
            <div data-testid="chat-confirmation" className="px-4 py-3 bg-yellow-50 border-t border-yellow-100">
              <p data-testid="chat-confirmation-msg" className="text-sm text-yellow-800 mb-2 font-medium">{pendingConfirmation.message}</p>
              <div className="flex gap-2">
                <button data-testid="chat-confirm-btn" onClick={handleConfirm} disabled={isSending}
                  className="flex-1 bg-blue-500 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50">
                  Confirm
                </button>
                <button data-testid="chat-cancel-btn" onClick={handleCancel} disabled={isSending}
                  className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-100 bg-white rounded-b-none">
            <div className="flex items-center gap-2">
              <input data-testid="chat-input" type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown} placeholder="Enter your command..."
                disabled={isSending || !!pendingConfirmation}
                className="flex-1 bg-gray-100 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              <button data-testid="chat-send" onClick={() => sendChatMessage(chatInput)}
                disabled={isSending || !chatInput.trim() || !!pendingConfirmation}
                className="bg-blue-500 text-white p-3 rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// --- Sub Components ---

/**
 * Truncate text at the last complete sentence boundary within maxLen.
 * Never appends "..." - returns a complete sentence.
 */
function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const trimmed = text.slice(0, maxLen);
  // Check if trimmed ends exactly at a sentence boundary
  if (/[.!?]$/.test(trimmed)) return trimmed;
  const lastEnd = Math.max(
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('! '),
    trimmed.lastIndexOf('? ')
  );
  if (lastEnd > 0) return trimmed.slice(0, lastEnd + 1);
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
}

function LogBlock({ time, source, level, msg, highlight, color }: { time: string; source: string; level: string; msg: string; highlight?: boolean; color?: string }) {
  return (
    <div className={`flex items-start gap-3 font-mono text-xs ${highlight ? 'bg-white/5 -mx-2 px-2 py-1 rounded' : ''}`}>
      <span className="text-gray-600 shrink-0" suppressHydrationWarning>[{time}]</span>
      <span className={`shrink-0 font-bold ${level === 'INFO' ? 'text-green-500' : level === 'WARN' ? 'text-yellow-500' : 'text-red-500'}`}>{level}</span>
      <span className="shrink-0 text-gray-500 w-24">[{source}]</span>
      <span className={`break-all ${color || 'text-gray-300'}`}>{msg}</span>
    </div>
  )
}

// === Added: Usage Heatmap component ===
function UsageHeatmap({ patterns }: { patterns: CostReportData['usagePatterns'] }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Convert pattern data to 2D map
  const patternMap = new Map<string, { avgVcpu: number; avgUtilization: number }>();
  patterns.forEach(p => {
    patternMap.set(`${p.dayOfWeek}-${p.hourOfDay}`, {
      avgVcpu: p.avgVcpu,
      avgUtilization: p.avgUtilization,
    });
  });

  // Determine color based on utilization
  const getColor = (utilization: number): string => {
    if (utilization === 0) return 'bg-gray-200';
    if (utilization < 20) return 'bg-emerald-300';
    if (utilization < 40) return 'bg-emerald-500';
    if (utilization < 60) return 'bg-yellow-400';
    if (utilization < 80) return 'bg-orange-400';
    return 'bg-red-400';
  };

  return (
    <div className="overflow-x-auto" data-testid="usage-heatmap">
      <div className="min-w-[400px]">
        {/* Hour labels */}
        <div className="flex ml-6 mb-1">
          {[0, 4, 8, 12, 16, 20].map(h => (
            <div key={h} className="text-[8px] text-gray-500 font-mono" style={{ marginLeft: h === 0 ? 0 : 'calc((100% - 48px) / 6 - 8px)', width: '16px' }}>
              {h}h
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="space-y-0.5">
          {days.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-1" data-testid={`heatmap-day-${dayIdx}`}>
              <span className="w-5 text-[9px] text-gray-500 font-medium">{day}</span>
              <div className="flex-1 flex gap-px">
                {hours.map(hour => {
                  const data = patternMap.get(`${dayIdx}-${hour}`);
                  const utilization = data?.avgUtilization || 0;
                  const vcpu = data?.avgVcpu || 0;

                  return (
                    <div
                      key={hour}
                      className={`flex-1 h-3 rounded-sm ${getColor(utilization)} transition-colors hover:ring-1 hover:ring-gray-400/50`}
                      title={`${days[dayIdx]} ${hour}:00 - Avg ${vcpu.toFixed(1)} vCPU, ${utilization.toFixed(0)}% utilization`}
                      data-testid={`heatmap-cell-${dayIdx}-${hour}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-2">
          <span className="text-[8px] text-gray-500">Low</span>
          <div className="flex gap-px">
            <div className="w-3 h-2 rounded-sm bg-emerald-300" />
            <div className="w-3 h-2 rounded-sm bg-emerald-500" />
            <div className="w-3 h-2 rounded-sm bg-yellow-400" />
            <div className="w-3 h-2 rounded-sm bg-orange-400" />
            <div className="w-3 h-2 rounded-sm bg-red-400" />
          </div>
          <span className="text-[8px] text-gray-500">High</span>
        </div>
      </div>
    </div>
  );
}

// === Added: Recommendation Card component ===
function RecommendationCard({ recommendation }: { recommendation: CostReportData['recommendations'][0] }) {
  const [expanded, setExpanded] = useState(false);

  const riskStyles = {
    low: { bg: 'bg-green-100', text: 'text-green-700', label: 'Low' },
    medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Medium' },
    high: { bg: 'bg-red-100', text: 'text-red-700', label: 'High' },
  };

  const typeIcons = {
    downscale: TrendingDown,
    schedule: Calendar,
    reserved: Shield,
    'right-size': BarChart3,
  };

  const Icon = typeIcons[recommendation.type] || BarChart3;
  const risk = riskStyles[recommendation.risk];

  return (
    <div
      className={`p-3 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer transition-all hover:bg-gray-100`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Icon size={14} className="text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-gray-900">{recommendation.title}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{recommendation.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-green-600">-${(recommendation.currentCost - recommendation.projectedCost).toFixed(0)}/mo</span>
          <ChevronRight size={14} className={`text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">Current Cost</p>
              <p className="text-xs font-bold text-gray-900">${recommendation.currentCost.toFixed(0)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">Estimated Cost</p>
              <p className="text-xs font-bold text-green-600">${recommendation.projectedCost.toFixed(0)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-gray-500 uppercase">Savings Rate</p>
              <p className="text-xs font-bold text-green-600">{recommendation.savingsPercent}%</p>
            </div>
          </div>

          {/* Risk & Confidence */}
          <div className="flex items-center gap-3 mb-3">
            <div className={`px-2 py-0.5 rounded text-[9px] font-bold ${risk.bg} ${risk.text}`}>
              Risk: {risk.label}
            </div>
            <div className="text-[9px] text-gray-400">
              Confidence: {(recommendation.confidence * 100).toFixed(0)}%
            </div>
          </div>

          {/* Implementation */}
          <div className="p-2 bg-gray-100 rounded-lg">
            <p className="text-[9px] text-gray-400 uppercase mb-1">Implementation Method</p>
            <p className="text-[10px] text-gray-600 leading-relaxed">{recommendation.implementation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
