"use client";

import { useEffect, useState, useRef } from 'react';
import {
  Activity, Server, Zap,
  CheckCircle2, Shield, Globe,
  ChevronDown,
  Send, Bot, User, RefreshCw, Pause
} from 'lucide-react';
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
import type { CostReport } from '@/types/cost';

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
  l2NodesL1Rpc?: Array<{
    component: string;
    l1RpcUrl: string;
    healthy: boolean;
  }>;
  eoaBalances?: {
    batcher: { address: string; balanceEth: number; level: string } | null;
    proposer: { address: string; balanceEth: number; level: string } | null;
    signerAvailable: boolean;
  };
}

interface L1FailoverStatus {
  activeUrl: string;
  failoverCount: number;
  spareUrlCount: number;
  healthy: boolean;
  lastFailover: string | null;
  lastFailoverReason?: string | null;
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
  usage?: {
    cpuPercent: number;
    memoryMiB: number;
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

interface AgentCycleData {
  timestamp: string;
  phase: 'observe' | 'detect' | 'decide' | 'act' | 'complete' | 'error';
  metrics: {
    l1BlockHeight: number;
    l2BlockHeight: number;
    cpuUsage: number;
    txPoolPending: number;
    gasUsedRatio: number;
  } | null;
  detection: unknown;
  scaling: {
    score: number;
    currentVcpu: number;
    targetVcpu: number;
    executed: boolean;
    reason: string;
  } | null;
  failover?: {
    triggered: boolean;
    fromUrl: string;
    toUrl: string;
    k8sUpdated: boolean;
  };
  error?: string;
}

interface AgentLoopStatus {
  scheduler: {
    initialized: boolean;
    agentLoopEnabled: boolean;
    agentTaskRunning: boolean;
  };
  lastCycle: AgentCycleData | null;
  recentCycles: AgentCycleData[];
  config: {
    intervalSeconds: number;
    autoScalingEnabled: boolean;
    simulationMode: boolean;
    cooldownRemaining: number;
  };
}

// --- Configuration Constants ---
/** Base path for API fetch calls (must match next.config.ts basePath) */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
/** API key for write endpoints (optional, must match SENTINAI_API_KEY on server) */
const API_KEY = process.env.NEXT_PUBLIC_SENTINAI_API_KEY || '';
/** Build headers for write (POST/PATCH) API calls */
function writeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

/** Metrics API polling interval (ms). Adjusted to reduce L1 RPC load (1s → 60s). */
const METRICS_REFRESH_INTERVAL_MS = 60_000;

/** Agent Loop status polling interval (ms) */
const AGENT_LOOP_REFRESH_INTERVAL_MS = 30_000;

// --- Main Dashboard Component ---
export default function Dashboard() {
  // State
  const [, setDataHistory] = useState<{ name: string; cpu: number; gethVcpu: number; gethMemGiB: number; saving: number; cost: number }[]>([]);
  const [current, setCurrent] = useState<MetricData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [, setPrediction] = useState<PredictionInfo | null>(null);
  const [, setPredictionMeta] = useState<PredictionMeta | null>(null);

  // --- L1 RPC Failover State ---
  const [l1Failover, setL1Failover] = useState<L1FailoverStatus | null>(null);

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

  // --- Agent Loop State ---
  const [agentLoop, setAgentLoop] = useState<AgentLoopStatus | null>(null);

  // --- Cost Analysis State ---
  const [costAnalysisExpanded, setCostAnalysisExpanded] = useState(false);
  const [costAnalysisData, setCostAnalysisData] = useState<CostReport | null>(null);
  const [costAnalysisLoading, setCostAnalysisLoading] = useState(false);

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
      const response = await fetch(`${BASE_PATH}/api/nlops`, {
        method: 'POST',
        headers: writeHeaders(),
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

  // Track active abort controller to cancel pending requests
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const timestamp = Date.now();
      const url = `${BASE_PATH}/api/metrics?t=${timestamp}`;

      try {
        const res = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await res.json();

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

        // Fetch scaler state with prediction (every 10 seconds to avoid overload)
        if (timestamp % 10000 < 1000) {
          try {
            const scalerRes = await fetch(`${BASE_PATH}/api/scaler`, {
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

        // Fetch L1 Failover status
        try {
          const l1Response = await fetch(`${BASE_PATH}/api/l1-failover`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (l1Response.ok) {
            const l1Data: L1FailoverStatus = await l1Response.json();
            setL1Failover(l1Data);
          }
        } catch {
          // Ignore l1-failover fetch errors
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
    const interval = setInterval(fetchData, METRICS_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // --- Agent Loop polling (every 5s) ---
  useEffect(() => {
    const fetchAgentLoop = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/agent-loop`, { cache: 'no-store' });
        if (res.ok) {
          setAgentLoop(await res.json());
        }
      } catch {
        // Silently ignore — agent loop panel will show stale data
      }
    };
    fetchAgentLoop();
    const interval = setInterval(fetchAgentLoop, AGENT_LOOP_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);



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
            Autonomous Node Guardian
          </p>
        </div>
        {process.env.NEXT_PUBLIC_NETWORK_NAME && (
          <div className="ml-auto flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-2.5 shadow-sm border border-gray-200/60">
            <div className="bg-slate-100 p-2 rounded-xl">
              <Globe size={18} className="text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Network</p>
              <p className="text-sm font-bold text-slate-800 whitespace-nowrap">{process.env.NEXT_PUBLIC_NETWORK_NAME}</p>
            </div>
          </div>
        )}
      </header>

      {/* Read-Only Mode Banner */}
      {process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <span className="text-yellow-600 text-lg shrink-0">⚠️</span>
          <div>
            <h3 className="font-semibold text-yellow-800 text-sm">Read-Only Mode</h3>
            <p className="text-xs text-yellow-700 mt-1">
              Public demo mode is active. Metric queries are allowed, but scaling and configuration changes are disabled.
            </p>
          </div>
        </div>
      )}

      {/* Network Stats Bar */}
      <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full animate-pulse bg-blue-500"></div>
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
          {current?.eoaBalances?.batcher && (
            <>
              <div className="h-8 w-px bg-gray-200"></div>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  current.eoaBalances.batcher.level === 'normal' ? 'bg-green-500' :
                  current.eoaBalances.batcher.level === 'warning' ? 'bg-amber-500' :
                  'bg-red-500 animate-pulse'
                }`}></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Batcher</p>
                  <p className={`text-lg font-bold font-mono ${
                    current.eoaBalances.batcher.level === 'normal' ? 'text-gray-900' :
                    current.eoaBalances.batcher.level === 'warning' ? 'text-amber-600' :
                    'text-red-600'
                  }`}>{current.eoaBalances.batcher.balanceEth.toFixed(4)} ETH</p>
                </div>
              </div>
            </>
          )}
          {current?.eoaBalances?.proposer && (
            <>
              <div className="h-8 w-px bg-gray-200"></div>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  current.eoaBalances.proposer.level === 'normal' ? 'bg-green-500' :
                  current.eoaBalances.proposer.level === 'warning' ? 'bg-amber-500' :
                  'bg-red-500 animate-pulse'
                }`}></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Proposer</p>
                  <p className={`text-lg font-bold font-mono ${
                    current.eoaBalances.proposer.level === 'normal' ? 'text-gray-900' :
                    current.eoaBalances.proposer.level === 'warning' ? 'text-amber-600' :
                    'text-red-600'
                  }`}>{current.eoaBalances.proposer.balanceEth.toFixed(4)} ETH</p>
                </div>
              </div>
            </>
          )}
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

      {/* L1 RPC Failover Status */}
      {l1Failover && (
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${l1Failover.healthy ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">L1 RPC (L2 Nodes)</p>
                  <p className="text-sm font-bold text-gray-900 font-mono">{l1Failover.activeUrl}</p>
                </div>
              </div>
              <div className="h-6 w-px bg-gray-200"></div>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Failover Pool</p>
                <p className="text-sm font-bold text-gray-900">{l1Failover.failoverCount} endpoints</p>
              </div>
              <div className="h-6 w-px bg-gray-200"></div>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Spare URLs</p>
                <p className="text-sm font-bold text-gray-900">{l1Failover.spareUrlCount} ready</p>
              </div>
            </div>
            {l1Failover.lastFailover && (
              <div className="text-xs text-gray-500">
                Last failover: {new Date(l1Failover.lastFailover).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 1: At-a-Glance Status */}
      <div className="grid grid-cols-1 gap-6 mb-6">

        {/* Card 1: Monthly Cost */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60">
          <div data-testid="monthly-cost">
            <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Monthly Cost</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-black text-gray-900">
                ${(current?.cost.opGethMonthlyCost || current?.cost.monthlyEstimated || 42).toFixed(0)}
              </span>
              <span className="text-base font-bold text-gray-400">/mo</span>
            </div>
            <p className="text-gray-400 text-[10px] mt-1">
              {current?.metrics.gethVcpu || 1} vCPU · {current?.metrics.gethMemGiB || 2} GiB
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">vs Fixed 4 vCPU (${current?.cost.fixedCost?.toFixed(0) || '166'}/mo)</span>
              <span className={`text-xs font-bold ${current?.cost.isPeakMode ? 'text-red-500' : 'text-green-600'}`}>
                {current?.cost.isPeakMode ? '+' : ''}{((current?.cost.monthlySaving || 0) / (current?.cost.fixedCost || 166) * -100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${current?.cost.isPeakMode ? 'bg-red-400' : 'bg-green-400'}`}
                style={{ width: `${Math.min(Math.max(((current?.cost.opGethMonthlyCost || 42) / (current?.cost.fixedCost || 166)) * 100, 5), 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-gray-400">$0</span>
              <span className="text-[9px] text-gray-400">${current?.cost.fixedCost?.toFixed(0) || '166'}</span>
            </div>
            <button
              onClick={() => {
                if (costAnalysisExpanded) {
                  setCostAnalysisExpanded(false);
                } else {
                  setCostAnalysisExpanded(true);
                  setCostAnalysisLoading(true);
                  fetch(`${BASE_PATH}/api/cost-report`)
                    .then(r => {
                      if (!r.ok) throw new Error(`HTTP ${r.status}`);
                      return r.json();
                    })
                    .then(data => {
                      setCostAnalysisData(data);
                      setCostAnalysisLoading(false);
                    })
                    .catch(e => {
                      console.error('Cost analysis error:', e);
                      setCostAnalysisLoading(false);
                    });
                }
              }}
              className="w-full mt-3 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium rounded-lg transition-colors"
              data-testid="cost-analysis-btn"
            >
              {costAnalysisExpanded ? 'Hide Analysis' : 'Cost Analysis'}
            </button>

            {/* Cost Analysis Results (Expandable) */}
            {costAnalysisExpanded && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                {costAnalysisLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw size={16} className="text-blue-500 animate-spin mr-2" />
                    <span className="text-xs text-gray-600">Loading analysis...</span>
                  </div>
                ) : costAnalysisData ? (
                  <div className="space-y-3">
                    {/* Savings Summary */}
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <p className="text-xs text-green-700 font-semibold">Potential Monthly Savings</p>
                      <p className="text-lg font-black text-green-600 mt-1">
                        ${Math.abs((costAnalysisData.currentMonthly - costAnalysisData.optimizedMonthly) || 0).toFixed(0)}
                        <span className="text-xs font-normal ml-1">({costAnalysisData.totalSavingsPercent?.toFixed(0) || 0}%)</span>
                      </p>
                    </div>

                    {/* AI Insight */}
                    {costAnalysisData.aiInsight && (
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <p className="text-xs text-blue-700 font-semibold">AI Insight</p>
                        <p className="text-xs text-blue-700 mt-1 leading-relaxed">{costAnalysisData.aiInsight}</p>
                      </div>
                    )}

                    {/* Top Recommendations */}
                    {costAnalysisData.recommendations && costAnalysisData.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-600 font-semibold">Top Recommendations</p>
                        {costAnalysisData.recommendations.slice(0, 2).map((rec, idx) => (
                          <div key={idx} className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-xs font-semibold text-amber-900">{rec.title}</p>
                                <p className="text-xs text-amber-700 mt-0.5">{rec.description}</p>
                              </div>
                              <span className="text-xs font-bold text-green-600 whitespace-nowrap">
                                -{rec.savingsPercent?.toFixed(0) || 0}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 text-center py-3">No data available</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent Loop Status Panel */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6" data-testid="agent-loop-panel">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className={`text-gray-400 ${agentLoop?.scheduler.agentTaskRunning ? 'animate-spin' : ''}`} />
            <h3 className="font-bold text-gray-900 text-lg">Agent Loop</h3>
          </div>
          <div className="flex items-center gap-3">
            {agentLoop?.scheduler.agentLoopEnabled ? (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs font-semibold text-green-600">Running</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-gray-400 rounded-full" />
                <span className="text-xs font-semibold text-gray-400">Disabled</span>
              </div>
            )}
            <span className="text-[10px] text-gray-400 font-mono">{agentLoop?.config.intervalSeconds || 30}s cycle</span>
          </div>
        </div>

        {!agentLoop?.scheduler.agentLoopEnabled ? (
          <div className="flex items-center justify-center gap-3 py-6 text-gray-400">
            <Pause size={20} />
            <div>
              <p className="text-sm font-medium">Agent Loop Disabled</p>
              <p className="text-xs text-gray-400 mt-0.5">Set L2_RPC_URL or AGENT_LOOP_ENABLED=true to enable</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Section 1: Last Cycle */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <span className="text-[10px] text-gray-400 font-semibold uppercase">Last Cycle</span>
              {agentLoop?.lastCycle ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-lg font-bold text-gray-900 font-mono">
                    {new Date(agentLoop.lastCycle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">Phase:</span>
                    <span className={`text-xs font-bold ${
                      agentLoop.lastCycle.phase === 'complete' ? 'text-green-600' :
                      agentLoop.lastCycle.phase === 'error' ? 'text-red-500' :
                      'text-blue-500'
                    }`}>
                      {agentLoop.lastCycle.phase}
                    </span>
                  </div>
                  {agentLoop.lastCycle.error && (
                    <p className="text-[10px] text-red-400 truncate" title={agentLoop.lastCycle.error}>
                      {agentLoop.lastCycle.error}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {agentLoop.config.autoScalingEnabled ? (
                      <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">AUTO</span>
                    ) : (
                      <span className="text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-bold">MANUAL</span>
                    )}
                    {agentLoop.config.simulationMode && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">SIM</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">Waiting for first cycle...</p>
              )}
            </div>

            {/* Section 2: Metrics */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <span className="text-[10px] text-gray-400 font-semibold uppercase">Metrics</span>
              {agentLoop?.lastCycle?.metrics ? (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">L2 Block</span>
                    <span className="text-xs font-bold text-gray-900 font-mono">
                      {agentLoop.lastCycle.metrics.l2BlockHeight.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">TxPool</span>
                    <span className="text-xs font-bold text-gray-900 font-mono">
                      {agentLoop.lastCycle.metrics.txPoolPending}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Gas Used</span>
                    <span className="text-xs font-bold text-gray-900 font-mono">
                      {(agentLoop.lastCycle.metrics.gasUsedRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">CPU</span>
                    <span className="text-xs font-bold text-gray-900 font-mono">
                      {agentLoop.lastCycle.metrics.cpuUsage.toFixed(3)}%
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">No data yet</p>
              )}
            </div>

            {/* Section 3: Scaling */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <span className="text-[10px] text-gray-400 font-semibold uppercase">Scaling</span>
              {agentLoop?.lastCycle?.scaling ? (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">vCPU</span>
                    <span className="text-xs font-bold text-gray-900 font-mono">
                      {agentLoop.lastCycle.scaling.currentVcpu} → {agentLoop.lastCycle.scaling.targetVcpu}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Executed</span>
                    {agentLoop.lastCycle.scaling.executed ? (
                      <CheckCircle2 size={14} className="text-green-500" />
                    ) : (
                      <span className="text-[10px] text-gray-400">—</span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Cooldown</span>
                    <span className="text-xs font-mono text-gray-700">
                      {agentLoop.config.cooldownRemaining}s
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">No decision yet</p>
              )}
            </div>

          </div>
        )}
      </div>

      {/* Row 2: Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-4">

        {/* Activity Log */}
        {(() => {
          const cycles = agentLoop?.recentCycles ? [...agentLoop.recentCycles].reverse() : [];
          const hasScalingAction = cycles.some(c => c.scaling?.executed);

          return (
          <div className="lg:col-span-7 bg-[#1A1D21] rounded-3xl shadow-xl overflow-hidden border border-gray-800 flex flex-col max-h-[320px]">

            {/* Terminal Header */}
            <div className="bg-[#25282D] px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Activity className={`${hasScalingAction ? 'text-amber-400' : 'text-blue-400'}`} size={22} />
                <span className="text-gray-200 font-bold text-base tracking-wide">ACTIVITY LOG</span>
              </div>
              <div className="flex items-center gap-3">
                {cycles.length > 0 && (
                  <span className="text-[10px] text-gray-500 font-mono">{cycles.length} cycles</span>
                )}
                <span className="text-xs text-gray-500 font-mono">30s interval</span>
              </div>
            </div>

            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-xs custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none z-10"></div>

              <div className="space-y-0.5">
                {cycles.length > 0 ? cycles.map((cycle, idx) => {
                    const time = new Date(cycle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const isError = cycle.phase === 'error';
                    const scaling = cycle.scaling;
                    const metrics = cycle.metrics;

                    let event = '';
                    let detail = '';
                    let color = 'text-gray-400';
                    let borderColor = '';

                    if (cycle.failover?.triggered) {
                      event = 'FAILOVER';
                      detail = `L1 RPC: ${cycle.failover.fromUrl} → ${cycle.failover.toUrl}`;
                      if (cycle.failover.k8sUpdated) detail += ' (K8s updated)';
                      color = 'text-purple-400';
                      borderColor = 'border-l-2 border-purple-500 pl-2';
                    } else if (isError) {
                      event = 'ERROR';
                      detail = cycle.error || 'Unknown error';
                      color = 'text-red-400';
                      borderColor = 'border-l-2 border-red-500 pl-2';
                    } else if (scaling?.executed) {
                      event = 'SCALED';
                      let reasonSummary = '';
                      let direction = '';
                      if (scaling.reason) {
                        if (scaling.reason.includes('Normal Load')) {
                          reasonSummary = 'Normal Load';
                          direction = scaling.targetVcpu > scaling.currentVcpu ? '↑' : scaling.targetVcpu < scaling.currentVcpu ? '↓' : '→';
                        } else if (scaling.reason.includes('High Load')) {
                          reasonSummary = 'High Load';
                          direction = '↑';
                        } else if (scaling.reason.includes('Critical')) {
                          reasonSummary = 'Critical Load';
                          direction = '↑↑';
                        } else if (scaling.reason.includes('System Idle')) {
                          reasonSummary = 'System Idle';
                          direction = '↓';
                        }
                        const cpuMatch = scaling.reason.match(/CPU (\d+\.?\d*%)/);
                        const gasMatch = scaling.reason.match(/Gas (\d+\.?\d*%)/);
                        const metricsStr = [
                          cpuMatch ? `CPU${cpuMatch[1]}` : null,
                          gasMatch ? `Gas${gasMatch[1]}` : null,
                        ].filter(Boolean).join(' ');
                        detail = `${direction} ${scaling.currentVcpu}→${scaling.targetVcpu}vCPU (${reasonSummary}, score:${scaling.score?.toFixed(0) || '?'}/100${metricsStr ? ', ' + metricsStr : ''})`;
                      } else {
                        detail = `${scaling.currentVcpu}→${scaling.targetVcpu} vCPU (score:${scaling.score?.toFixed(0) || '?'}/100)`;
                      }
                      color = 'text-amber-400';
                      borderColor = 'border-l-2 border-amber-500 pl-2';
                    } else if (scaling && scaling.score >= 70) {
                      event = 'HIGH';
                      detail = `score:${scaling.score.toFixed(0)}`;
                      if (scaling.reason.includes('Cooldown')) detail += ' · Cooldown active';
                      else if (scaling.reason.includes('Already at')) detail += ` · Already at ${scaling.currentVcpu} vCPU`;
                      color = 'text-red-400';
                      borderColor = 'border-l-2 border-red-500/50 pl-2';
                    } else if (scaling && scaling.score >= 30) {
                      event = 'NORMAL';
                      detail = `score:${scaling.score.toFixed(0)}`;
                      if (scaling.reason.includes('Cooldown')) detail += ' · Cooldown active';
                      else if (scaling.reason.includes('Already at')) detail += ` · At ${scaling.currentVcpu} vCPU`;
                      color = 'text-blue-400';
                    } else {
                      event = 'IDLE';
                      detail = `score:${scaling?.score?.toFixed(0) ?? '0'}`;
                      color = 'text-green-500/70';
                    }

                    return (
                      <div key={idx} className={`flex items-baseline leading-relaxed ${event === 'IDLE' ? 'opacity-50' : ''} ${borderColor}`}>
                        <span className="text-gray-500 shrink-0 w-[76px] text-right pr-2" suppressHydrationWarning>{time}</span>
                        <span className={`shrink-0 w-[80px] font-bold ${color}`}>{event}</span>
                        {metrics && event !== 'ERROR' && (
                          <span className="text-gray-500 shrink-0 w-[68px] text-right pr-3">cpu {metrics.cpuUsage.toFixed(1)}%</span>
                        )}
                        {metrics && event !== 'ERROR' && (
                          <span className="text-gray-500 shrink-0 w-[52px] text-right pr-3">tx {metrics.txPoolPending}</span>
                        )}
                        {metrics && event !== 'ERROR' && (
                          <span className="text-gray-500 shrink-0 w-[100px] text-right pr-3">blk {metrics.l2BlockHeight.toLocaleString()}</span>
                        )}
                        <span className="text-gray-400 flex-1 pl-1 truncate">
                          {detail}
                        </span>
                        {scaling?.executed && <Zap size={12} className="text-amber-500 shrink-0 mt-0.5 ml-1" />}
                      </div>
                    );
                  }) : (
                  <div className="flex items-center justify-center gap-3 py-8 text-gray-500">
                    {agentLoop?.scheduler.agentLoopEnabled ? (
                      <>
                        <RefreshCw size={20} className="text-blue-400/40" />
                        <div>
                          <p className="text-blue-400/70 font-semibold text-sm font-sans">Waiting for first cycle...</p>
                          <p className="text-gray-600 text-xs mt-0.5 font-sans">Agent loop runs every 30 seconds</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Pause size={20} className="text-gray-500/40" />
                        <div>
                          <p className="text-gray-400/70 font-semibold text-sm font-sans">Agent Loop Disabled</p>
                          <p className="text-gray-600 text-xs mt-0.5 font-sans">Set L2_RPC_URL to enable autonomous monitoring</p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Status Bar */}
            <div className="bg-[#25282D] px-6 py-3 border-t border-gray-800 flex items-center justify-between shrink-0">
              <div className={`flex items-center gap-2 text-xs font-bold ${
                hasScalingAction ? 'text-amber-400' : 'text-green-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  hasScalingAction ? 'bg-amber-500' :
                  agentLoop?.scheduler.agentLoopEnabled ? 'bg-green-500' : 'bg-gray-500'
                }`} />
                {hasScalingAction
                  ? `SCALING EXECUTED`
                  : agentLoop?.scheduler.agentLoopEnabled
                  ? 'MONITORING ACTIVE'
                  : 'DISABLED'}
              </div>
              <span className="text-[10px] text-gray-500">
                {cycles.length > 0 ? `${cycles.filter(c => c.scaling?.score && c.scaling.score >= 30).length}/${cycles.length} elevated` : ''}
              </span>
            </div>
          </div>
          );
        })()}

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

                {comp.usage ? (
                  <div className="pl-7">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                      <span>Usage</span>
                      <span className="font-mono text-blue-600 font-bold">
                        {comp.usage.cpuPercent.toFixed(1)}% CPU / {comp.usage.memoryMiB.toFixed(0)} MB
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${Math.min(comp.usage.cpuPercent, 100)}%` }}></div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 pl-1">Instance: {comp.current}</p>
                  </div>
                ) : (
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


