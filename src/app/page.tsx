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
  chain?: {
    type: string;
    displayName: string;
    mode: string;
    capabilities: {
      l1Failover: boolean;
      eoaBalanceMonitoring: boolean;
      disputeGameMonitoring: boolean;
      proofMonitoring: boolean;
      settlementMonitoring: boolean;
    };
  };
  metrics: {
    l1BlockHeight: number;
    blockHeight: number;
    txPoolCount: number;
    cpuUsage: number;
    memoryUsage: number;
    gethVcpu: number;
    gethMemGiB: number;
    syncLag: number;
    syncLagReliable?: boolean;
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
    roles: Record<string, { address: string; balanceEth: number; level: 'normal' | 'warning' | 'critical' } | null>;
    signerAvailable: boolean;
  };
  disputeGames?: {
    enabled: boolean;
    activeGames: number;
    gamesNearDeadline: number;
    claimableBonds: number;
    totalBondsLockedEth: number;
    challengerConfigured: boolean;
    factoryConfigured: boolean;
    lastCheckedAt: string;
    error?: string;
  };
  proof?: {
    enabled: boolean;
    queueDepth: number;
    generationLagSec: number;
    verificationLagSec: number;
  };
  settlement?: {
    enabled: boolean;
    layer: string;
    finalityMode: string;
    postingLagSec: number;
    healthy: boolean;
  };
}

interface L1FailoverStatus {
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

interface AnomalyEventData {
  id: string;
  timestamp: number;
  status: 'active' | 'resolved' | 'acknowledged';
  deepAnalysis?: {
    severity: string;
    anomalyType: string;
    predictedImpact: string;
    suggestedActions: string[];
    relatedComponents: string[];
  };
}

interface DetectionInfo {
  anomalies: {
    isAnomaly: boolean;
    metric: string;
    value: number;
    zScore: number;
    direction: 'spike' | 'drop' | 'plateau';
    description: string;
    rule: string;
  }[];
  activeEventId?: string;
  deepAnalysisTriggered: boolean;
}

interface AgentCycleData {
  timestamp: string;
  phase: 'observe' | 'detect' | 'analyze' | 'plan' | 'act' | 'verify' | 'complete' | 'error';
  decisionId?: string;
  phaseTrace?: {
    phase: 'observe' | 'detect' | 'analyze' | 'plan' | 'act' | 'verify';
    startedAt: string;
    endedAt: string;
    ok: boolean;
    error?: string;
  }[];
  verification?: {
    expected: string;
    observed: string;
    passed: boolean;
    details?: string;
  };
  degraded?: {
    active: boolean;
    reasons: string[];
  };
  metrics: {
    l1BlockHeight: number;
    l2BlockHeight: number;
    cpuUsage: number;
    txPoolPending: number;
    gasUsedRatio: number;
  } | null;
  detection: DetectionInfo | null;
  scaling: {
    score: number;
    currentVcpu: number;
    targetVcpu: number;
    executed: boolean;
    reason: string;
    confidence?: number;
  } | null;
  failover?: {
    triggered: boolean;
    fromUrl: string;
    toUrl: string;
    k8sUpdated: boolean;
  };
  proxydReplacement?: {
    triggered: boolean;
    backendName: string;
    oldUrl: string;
    newUrl: string;
    reason: string;
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
  totalCycles?: number;
  config: {
    intervalSeconds: number;
    autoScalingEnabled: boolean;
    simulationMode: boolean;
    cooldownRemaining: number;
  };
}

interface DecisionTraceData {
  decisionId: string;
  timestamp: string;
  chainType: string;
  reasoningSummary: string;
  chosenAction: string;
  alternatives: string[];
  evidence: Array<{
    type: string;
    key: string;
    value: string;
    source?: string;
  }>;
  phaseTrace: Array<{
    phase: string;
    startedAt: string;
    endedAt: string;
    ok: boolean;
    error?: string;
  }>;
  verification: {
    expected: string;
    observed: string;
    passed: boolean;
    details?: string;
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

/** Component role descriptions for dashboard display */
const COMPONENT_ROLES: Record<string, string> = {
  'Execution Client': 'L2 block execution & state',
  'L2 Client': 'L2 block execution & state',
  'Consensus Node': 'L1 derivation & sequencing',
  'Batcher': 'L2 tx batch submission to L1',
  'Proposer': 'L2 state root proposal to L1',
  'Challenger': 'Fault proof dispute participation',
  'Prover': 'Proof generation and verification pipeline',
};

/** Parse "Fargate (1.0 vCPU / 1792Mi)" into structured resource data */
function parseResourceSpec(current: string): { platform: string; vcpu: number; memory: string; memoryMiB: number } | null {
  const match = current.match(/^(.+?)\s*\((\d+\.?\d*)\s*vCPU\s*\/\s*(\d+\.?\d*)(Mi|Gi)\)$/);
  if (!match) return null;
  const platform = match[1].trim();
  const vcpu = parseFloat(match[2]);
  const memVal = parseFloat(match[3]);
  const memUnit = match[4];
  const memoryMiB = memUnit === 'Gi' ? memVal * 1024 : memVal;
  return { platform, vcpu, memory: `${match[3]}${memUnit}`, memoryMiB };
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

  // --- Anomaly Events State ---
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyEventData[]>([]);

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
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [selectedDecisionTrace, setSelectedDecisionTrace] = useState<DecisionTraceData | null>(null);
  const [decisionTraceLoading, setDecisionTraceLoading] = useState(false);
  const [decisionTraceError, setDecisionTraceError] = useState<string | null>(null);

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

  const openDecisionTrace = async (decisionId: string) => {
    setDecisionTraceLoading(true);
    setDecisionTraceError(null);
    try {
      const response = await fetch(
        `${BASE_PATH}/api/agent-decisions?decisionId=${encodeURIComponent(decisionId)}`,
        { cache: 'no-store' }
      );
      const data = await response.json();
      if (!response.ok || !data.trace) {
        throw new Error(data?.error || '의사결정 추적 정보를 불러오지 못했습니다.');
      }
      setSelectedDecisionTrace(data.trace as DecisionTraceData);
    } catch (error) {
      const message = error instanceof Error ? error.message : '의사결정 추적 정보를 불러오지 못했습니다.';
      setDecisionTraceError(message);
      setSelectedDecisionTrace(null);
    } finally {
      setDecisionTraceLoading(false);
    }
  };

  const closeDecisionTrace = () => {
    setSelectedDecisionTrace(null);
    setDecisionTraceError(null);
    setDecisionTraceLoading(false);
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
          console.info('Fetch aborted');
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

  // --- Agent Loop polling (every 30s) ---
  useEffect(() => {
    const fetchAgentLoop = async () => {
      try {
        const limit = showFullHistory ? 500 : 50;
        const res = await fetch(`${BASE_PATH}/api/agent-loop?limit=${limit}`, { cache: 'no-store' });
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
  }, [showFullHistory]);

  // --- Anomaly Events polling (with agent loop) ---
  useEffect(() => {
    const fetchAnomalies = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/anomalies`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setAnomalyEvents(data.events || []);
        }
      } catch { /* ignore */ }
    };
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, AGENT_LOOP_REFRESH_INTERVAL_MS);
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

  const networkName = current?.chain?.displayName || process.env.NEXT_PUBLIC_NETWORK_NAME;
  const eoaRoleEntries = Object.entries(current?.eoaBalances?.roles || {}).filter(([, value]) => value !== null);
  const showL1Failover = Boolean(l1Failover && current?.chain?.capabilities?.l1Failover !== false);
  const showFaultProof = Boolean(current?.chain?.capabilities?.disputeGameMonitoring && current?.disputeGames?.enabled);
  const showProof = Boolean(current?.chain?.capabilities?.proofMonitoring && current?.proof?.enabled);
  const showSettlement = Boolean(current?.chain?.capabilities?.settlementMonitoring && current?.settlement?.enabled);

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
        {networkName && (
          <div className="ml-auto flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-2.5 shadow-sm border border-gray-200/60">
            <div className="bg-slate-100 p-2 rounded-xl">
              <Globe size={18} className="text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Network</p>
              <p className="text-sm font-bold text-slate-800 whitespace-nowrap">{networkName}</p>
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
          {eoaRoleEntries.map(([role, value]) => {
            if (!value) return null;
            const statusColor = value.level === 'normal'
              ? 'bg-green-500'
              : value.level === 'warning'
                ? 'bg-amber-500'
                : 'bg-red-500 animate-pulse';
            const textColor = value.level === 'normal'
              ? 'text-gray-900'
              : value.level === 'warning'
                ? 'text-amber-600'
                : 'text-red-600';

            return (
              <div key={role} className="contents">
                <div className="h-8 w-px bg-gray-200"></div>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${statusColor}`}></div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-semibold uppercase">{role}</p>
                    <p className={`text-lg font-bold font-mono ${textColor}`}>{value.balanceEth.toFixed(4)} ETH</p>
                  </div>
                </div>
              </div>
            );
          })}
          {current?.metrics.syncLagReliable !== false && (
            <>
              <div className="h-8 w-px bg-gray-200"></div>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Sync Status</p>
                <p className="text-lg font-bold text-green-600 flex items-center gap-1">
                  <CheckCircle2 size={14} />
                  {current?.metrics.syncLag === 0 ? 'Synced' : `Lag: ${current?.metrics.syncLag}`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* L1 RPC Failover Status */}
      {showL1Failover && l1Failover && (
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${l1Failover.healthy ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">L1 RPC</p>
                  <p className={`text-sm font-bold ${l1Failover.healthy ? 'text-green-600' : 'text-red-600'}`}>
                    {l1Failover.healthy ? 'Available' : 'Unavailable'}
                  </p>
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

      {/* Fault Proof Status */}
      {showFaultProof && current?.disputeGames && (
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Fault Proof</p>
            <p className="text-[11px] text-gray-500">
              Last check: {new Date(current.disputeGames.lastCheckedAt).toLocaleTimeString()}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Active Games</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.disputeGames.activeGames}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Near Deadline</p>
              <p className={`text-xl font-bold font-mono ${current.disputeGames.gamesNearDeadline > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {current.disputeGames.gamesNearDeadline}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Claimable Bonds</p>
              <p className={`text-xl font-bold font-mono ${current.disputeGames.claimableBonds > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                {current.disputeGames.claimableBonds}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Locked Bonds</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.disputeGames.totalBondsLockedEth.toFixed(4)} ETH</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Config</p>
              <p className={`text-sm font-bold ${current.disputeGames.factoryConfigured && current.disputeGames.challengerConfigured ? 'text-green-600' : 'text-amber-600'}`}>
                {current.disputeGames.factoryConfigured && current.disputeGames.challengerConfigured ? 'Ready' : 'Partial'}
              </p>
            </div>
          </div>
        </div>
      )}

      {showProof && current?.proof && (
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Proof Pipeline</p>
            <p className="text-[11px] text-gray-500">Mode: {current.chain?.mode || 'unknown'}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Queue Depth</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.proof.queueDepth}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Generation Lag</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.proof.generationLagSec}s</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Verification Lag</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.proof.verificationLagSec}s</p>
            </div>
          </div>
        </div>
      )}

      {showSettlement && current?.settlement && (
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Settlement</p>
            <p className="text-[11px] text-gray-500">{current.settlement.layer} · {current.settlement.finalityMode}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Posting Lag</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.settlement.postingLagSec}s</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Health</p>
              <p className={`text-xl font-bold font-mono ${current.settlement.healthy ? 'text-green-600' : 'text-red-600'}`}>
                {current.settlement.healthy ? 'Healthy' : 'Degraded'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Mode</p>
              <p className="text-xl font-bold text-gray-900 font-mono">{current.chain?.mode || 'unknown'}</p>
            </div>
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-4 lg:auto-rows-fr">

        {/* Activity Log */}
        {(() => {
          const cycles = agentLoop?.recentCycles ? [...agentLoop.recentCycles].reverse() : [];
          const hasScalingAction = cycles.some(c => c.scaling?.executed);

          const getScoreBadge = (score: number) => {
            const bg = score >= 70 ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : score >= 30 ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              : 'bg-green-500/15 text-green-500/80 border-green-500/20';
            const barColor = score >= 70 ? 'bg-red-400' : score >= 30 ? 'bg-blue-400' : 'bg-green-500/60';
            return (
              <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-bold font-mono shrink-0 ${bg}`}>
                <span className="w-6 h-1 rounded-full bg-gray-700 overflow-hidden">
                  <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
                </span>
                {score}
              </span>
            );
          };

          // Anomaly detection summary for status bar
          const anomalyCycles = cycles.filter(c => {
            const det = c.detection;
            return det && det.anomalies?.some(a => a.isAnomaly);
          });
          const lastDeepTriggered = cycles.find(c => c.detection?.deepAnalysisTriggered);
          const hasActiveEvent = cycles.some(c => c.detection?.activeEventId);

          return (
          <div className="lg:col-span-7 bg-[#1A1D21] rounded-3xl shadow-xl overflow-hidden border border-gray-800 flex flex-col h-[34rem] lg:h-[38rem]">

            {/* Terminal Header */}
            <div className="bg-[#25282D] px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Activity className={`${hasScalingAction ? 'text-amber-400' : 'text-blue-400'}`} size={22} />
                <span className="text-gray-200 font-bold text-base tracking-wide">ACTIVITY LOG</span>
              </div>
              <div className="flex items-center gap-3">
                {cycles.length > 0 && (
                  <span className="text-[10px] text-gray-500 font-mono">
                    {cycles.length}{agentLoop?.totalCycles && agentLoop.totalCycles > cycles.length
                      ? ` / ${agentLoop.totalCycles}`
                      : ''} cycles
                  </span>
                )}
                {agentLoop?.totalCycles && agentLoop.totalCycles > 50 && (
                  <button
                    onClick={() => setShowFullHistory(prev => !prev)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                      showFullHistory
                        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        : 'bg-gray-700/30 text-gray-500 border-gray-700 hover:text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {showFullHistory ? 'Recent' : 'Full History'}
                  </button>
                )}
                <span className="text-xs text-gray-500 font-mono">30s interval</span>
              </div>
            </div>

            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-xs custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none z-10"></div>

              <div className="space-y-1">
                {cycles.length > 0 ? cycles.map((cycle, idx) => {
                    const d = new Date(cycle.timestamp);
                    const date = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
                    const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                    const isError = cycle.phase === 'error';
                    const scaling = cycle.scaling;
                    const metrics = cycle.metrics;

                    let event = '';
                    let detail = '';
                    let color = 'text-gray-400';
                    let borderColor = '';

                    if (cycle.proxydReplacement?.triggered) {
                      event = 'PROXYD';
                      detail = `${cycle.proxydReplacement.backendName}: ${cycle.proxydReplacement.oldUrl} → ${cycle.proxydReplacement.newUrl}`;
                      color = 'text-fuchsia-400';
                      borderColor = 'border-l-2 border-fuchsia-500 pl-2';
                    } else if (cycle.failover?.triggered) {
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
                        // Extract main reason (before comma or parenthesis)
                        const reasonMatch = scaling.reason.match(/^(\[[\w\s]+\]\s*)?([^,(]+)/);
                        const cleanReason = reasonMatch ? reasonMatch[2].trim() : scaling.reason;

                        // Determine load level and direction
                        if (cleanReason.includes('Normal Load')) {
                          reasonSummary = 'Normal Load';
                          direction = scaling.targetVcpu > scaling.currentVcpu ? '↑' : scaling.targetVcpu < scaling.currentVcpu ? '↓' : '→';
                        } else if (cleanReason.includes('High Load')) {
                          reasonSummary = 'High Load';
                          direction = '↑';
                        } else if (cleanReason.includes('Critical Load')) {
                          reasonSummary = 'Critical Load';
                          direction = '↑↑';
                        } else if (cleanReason.includes('System Idle')) {
                          reasonSummary = 'System Idle';
                          direction = '↓';
                        } else {
                          // Fallback: use the cleaned reason as-is
                          reasonSummary = cleanReason.length > 20 ? cleanReason.substring(0, 17) + '...' : cleanReason;
                          direction = scaling.targetVcpu > scaling.currentVcpu ? '↑' : scaling.targetVcpu < scaling.currentVcpu ? '↓' : '→';
                        }

                        // Extract metrics (CPU, Gas, TxPool)
                        const cpuMatch = scaling.reason.match(/CPU\s+([\d.]+)%/);
                        const gasMatch = scaling.reason.match(/Gas\s+([\d.]+)%/);
                        const txPoolMatch = scaling.reason.match(/TxPool\s+(\d+)/);
                        const metricsStr = [
                          cpuMatch ? `CPU${cpuMatch[1]}` : null,
                          gasMatch ? `Gas${gasMatch[1]}` : null,
                          txPoolMatch ? `TxPool${txPoolMatch[1]}` : null,
                        ].filter(Boolean).join(' ');
                        detail = `${direction} ${scaling.currentVcpu}→${scaling.targetVcpu}vCPU (${reasonSummary}${metricsStr ? ', ' + metricsStr : ''})`;
                      } else {
                        detail = `${scaling.currentVcpu}→${scaling.targetVcpu} vCPU`;
                      }
                      color = 'text-amber-400';
                      borderColor = 'border-l-2 border-amber-500 pl-2';
                    } else if (scaling && scaling.score >= 70) {
                      event = 'HIGH';
                      detail = '';
                      if (scaling.reason.includes('Cooldown')) detail = 'Cooldown active';
                      else if (scaling.reason.includes('Already at')) detail = `Already at ${scaling.currentVcpu} vCPU`;
                      color = 'text-red-400';
                      borderColor = 'border-l-2 border-red-500/50 pl-2';
                    } else if (scaling && scaling.score >= 30) {
                      event = 'NORMAL';
                      detail = '';
                      if (scaling.reason.includes('Cooldown')) detail = 'Cooldown active';
                      else if (scaling.reason.includes('Already at')) detail = `At ${scaling.currentVcpu} vCPU`;
                      color = 'text-blue-400';
                    } else {
                      event = 'IDLE';
                      detail = '';
                      color = 'text-green-500/90';
                    }

                    const detected = cycle.detection?.anomalies?.filter(a => a.isAnomaly) || [];
                    const eventId = cycle.detection?.activeEventId;
                    const aiResult = eventId ? anomalyEvents.find(e => e.id === eventId)?.deepAnalysis : null;
                    const anomalySummary = detected.map(a => {
                      const name = a.metric.replace('Usage', '').replace('Pending', '').replace('UsedRatio', '');
                      const dir = a.direction === 'spike' ? '↑' : a.direction === 'drop' ? '↓' : '~';
                      return `${name}${dir}`;
                    }).join(' ');
                    const phaseSummary = cycle.phaseTrace?.map((entry) => `${entry.phase}:${entry.ok ? 'ok' : 'err'}`).join(' > ');

                    return (
                      <div key={idx} className={`flex flex-col gap-2 leading-relaxed ${event === 'IDLE' ? 'opacity-70' : ''} ${borderColor}`}>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-900/40 border border-gray-800 text-gray-500 text-[10px] tabular-nums shrink-0" suppressHydrationWarning>
                            <span className="text-gray-700">{date}</span> {time}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border border-current/20 bg-black/10 font-bold text-[10px] tracking-wide shrink-0 ${color}`}>{event}</span>
                          {cycle.decisionId && (
                            <button
                              onClick={() => openDecisionTrace(cycle.decisionId!)}
                              className="inline-flex items-center px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-bold shrink-0 hover:bg-cyan-500/20 transition-colors"
                              title="의사결정 추적 보기"
                            >
                              id {cycle.decisionId.slice(0, 8)}
                            </button>
                          )}
                          {cycle.verification && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${
                              cycle.verification.passed
                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}>
                              verify:{cycle.verification.passed ? 'pass' : 'fail'}
                            </span>
                          )}
                          {cycle.degraded?.active && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold shrink-0">
                              degraded
                            </span>
                          )}
                          {metrics && event !== 'ERROR' && (
                            <>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded bg-gray-800/40 text-[10px] shrink-0 ${event === 'IDLE' ? 'text-gray-600' : 'text-gray-400'}`}>cpu {metrics.cpuUsage.toFixed(1)}%</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded bg-gray-800/40 text-[10px] shrink-0 ${event === 'IDLE' ? 'text-gray-600' : 'text-gray-400'}`}>tx {metrics.txPoolPending}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded bg-gray-800/40 text-[10px] shrink-0 ${event === 'IDLE' ? 'text-gray-600' : 'text-gray-400'}`}>gas {(metrics.gasUsedRatio * 100).toFixed(1)}%</span>
                              {(() => {
                                const prevCycle = idx > 0 ? cycles[idx - 1] : null;
                                const blockDelta = prevCycle?.metrics ? metrics.l2BlockHeight - prevCycle.metrics.l2BlockHeight : null;
                                return (
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded bg-gray-800/40 text-[10px] ${event === 'IDLE' ? 'text-gray-600' : 'text-gray-400'} shrink-0`}>
                                    {metrics.l2BlockHeight.toLocaleString()}
                                    {blockDelta !== null && blockDelta > 0 && (
                                      <span className="text-green-500/60 ml-1">+{blockDelta}</span>
                                    )}
                                  </span>
                                );
                              })()}
                            </>
                          )}
                          {scaling?.score !== undefined && !scaling.executed && getScoreBadge(Math.round(scaling.score))}
                          {detected.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/25 text-[10px] font-bold font-mono text-amber-400 shrink-0">
                              ⚠ {anomalySummary}
                            </span>
                          )}
                          {aiResult && (
                            <span className="inline-flex items-center gap-1 text-[10px] min-w-0 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                              <span className={`px-1 py-0.5 rounded font-bold shrink-0 ${
                                aiResult.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                aiResult.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                aiResult.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-blue-500/20 text-blue-400'
                              }`}>{aiResult.severity}</span>
                              <span className="text-purple-400/80 break-words">{aiResult.predictedImpact}</span>
                            </span>
                          )}
                          {!aiResult && cycle.detection?.deepAnalysisTriggered && (
                            <span className="text-[10px] text-purple-400 font-mono shrink-0">AI analyzing...</span>
                          )}
                          {!aiResult && !cycle.detection?.deepAnalysisTriggered && detected.length > 0 && (
                            <span className="text-amber-500/70 text-[10px] break-words">{detected[0].description}</span>
                          )}
                          {!detected.length && cycle.detection?.deepAnalysisTriggered && (
                            <span className="text-[10px] text-purple-400 font-mono shrink-0">AI▸</span>
                          )}
                          {scaling?.executed && <Zap size={12} className="text-amber-500 shrink-0" />}
                        </div>
                        {detail && <div className="text-gray-500 break-words text-[11px] pl-0.5">{detail}</div>}
                        {phaseSummary && <div className="text-gray-600 break-words text-[10px] pl-0.5">trace {phaseSummary}</div>}
                        {cycle.degraded?.active && cycle.degraded.reasons.length > 0 && (
                          <div className="text-amber-400/80 break-words text-[10px] pl-0.5">
                            degraded reason: {cycle.degraded.reasons.join(' | ')}
                          </div>
                        )}
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
            <div className="bg-[#25282D] px-4 py-2.5 border-t border-gray-800 flex items-center gap-4 shrink-0 text-[10px] font-mono">
              <div className={`flex items-center gap-1.5 font-bold shrink-0 ${
                hasScalingAction ? 'text-amber-400' : 'text-green-400'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  hasScalingAction ? 'bg-amber-500' :
                  agentLoop?.scheduler.agentLoopEnabled ? 'bg-green-500' : 'bg-gray-500'
                }`} />
                {hasScalingAction ? 'SCALED' : agentLoop?.scheduler.agentLoopEnabled ? 'ACTIVE' : 'OFF'}
              </div>
              <span className="text-gray-700">|</span>
              <div className="flex items-center gap-1.5 text-gray-500">
                <span>
                  {cycles.length}{agentLoop?.totalCycles && agentLoop.totalCycles > cycles.length
                    ? <span className="text-gray-600"> / {agentLoop.totalCycles}</span>
                    : null} cycles
                </span>
                <span className="text-gray-700">·</span>
                {anomalyCycles.length > 0 ? (
                  <span className="text-amber-400 font-bold">{anomalyCycles.length} anomal{anomalyCycles.length === 1 ? 'y' : 'ies'}</span>
                ) : (
                  <span>no anomalies</span>
                )}
                {lastDeepTriggered && <span className="text-purple-400 font-bold">· AI</span>}
                {hasActiveEvent && <span className="text-red-400 font-bold">· event active</span>}
              </div>
            </div>
          </div>
          );
        })()}

        {/* Components + Documentation */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 shadow-sm border border-gray-200/60 flex flex-col h-[34rem] lg:h-[38rem]">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Server size={18} className="text-gray-400" /> Components
            </h3>
            {current?.components && current.components.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">vCPU</span>
                  <span className="text-xs font-bold text-gray-700 font-mono">
                    {current.components.reduce((sum, c) => sum + (c.rawCpu || 0), 0).toFixed(1)}
                  </span>
                </div>
                <div className="w-px h-3 bg-gray-200" />
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    current.components.every(c => c.status === 'Running') ? 'bg-green-500' : 'bg-amber-500'
                  }`} />
                  <span className="text-[10px] font-bold text-gray-500">
                    {current.components.filter(c => c.status === 'Running').length}/{current.components.length}
                  </span>
                </div>
              </div>
            )}
          </div>

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
                ) : (() => {
                  const spec = parseResourceSpec(comp.current);
                  const displayName = comp.name === 'L2 Client' ? 'Execution Client' : comp.name;
                  const role = COMPONENT_ROLES[displayName] || '';
                  if (spec) {
                    const vcpuPercent = Math.min((spec.vcpu / 4) * 100, 100);
                    const memPercent = Math.min((spec.memoryMiB / (16 * 1024)) * 100, 100);
                    return (
                      <div className="pl-7 space-y-1.5">
                        {role && <p className="text-[10px] text-gray-400 italic">{role}</p>}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 w-8 shrink-0">CPU</span>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${vcpuPercent}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-gray-500 w-16 text-right">{spec.vcpu} vCPU</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 w-8 shrink-0">MEM</span>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-400 rounded-full" style={{ width: `${memPercent}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-gray-500 w-16 text-right">{spec.memory}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            spec.platform.includes('Fargate') ? 'bg-orange-50 text-orange-500' : 'bg-gray-100 text-gray-500'
                          }`}>{spec.platform}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            comp.status === 'Running' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                          }`}>{comp.status}</span>
                        </div>
                      </div>
                    );
                  }
                  return <p className="text-xs text-gray-400 pl-7">{comp.current} &middot; {comp.status}</p>;
                })()}
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Decision Trace Modal */}
      {(decisionTraceLoading || decisionTraceError || selectedDecisionTrace) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <div>
                <h3 className="text-sm font-bold text-gray-900">의사결정 추적</h3>
                {selectedDecisionTrace?.decisionId && (
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                    {selectedDecisionTrace.decisionId}
                  </p>
                )}
              </div>
              <button
                onClick={closeDecisionTrace}
                className="text-xs font-semibold text-gray-500 hover:text-gray-800"
              >
                닫기
              </button>
            </div>

            <div className="p-5 space-y-4">
              {decisionTraceLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <RefreshCw size={14} className="animate-spin text-blue-500" />
                  추적 데이터를 불러오는 중입니다...
                </div>
              )}

              {!decisionTraceLoading && decisionTraceError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {decisionTraceError}
                </div>
              )}

              {!decisionTraceLoading && selectedDecisionTrace && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase">Reasoning</p>
                      <p className="text-xs text-gray-700 mt-1 leading-relaxed break-words">
                        {selectedDecisionTrace.reasoningSummary}
                      </p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase">Action</p>
                      <p className="text-xs text-gray-700 mt-1 font-mono">{selectedDecisionTrace.chosenAction}</p>
                      <p className={`text-[11px] mt-2 font-semibold ${selectedDecisionTrace.verification.passed ? 'text-green-600' : 'text-red-600'}`}>
                        검증: {selectedDecisionTrace.verification.passed ? '성공' : '실패'}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        expected={selectedDecisionTrace.verification.expected}, observed={selectedDecisionTrace.verification.observed}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase mb-2">Evidence</p>
                    <div className="space-y-1.5">
                      {selectedDecisionTrace.evidence.map((item, index) => (
                        <div key={`${item.key}-${index}`} className="text-xs text-gray-700 flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            {item.type}
                          </span>
                          <span className="font-mono text-gray-500">{item.key}</span>
                          <span className="break-words">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase mb-2">Phase Trace</p>
                    <div className="space-y-1.5">
                      {selectedDecisionTrace.phaseTrace.map((entry, index) => (
                        <div key={`${entry.phase}-${index}`} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-gray-500 w-16">{entry.phase}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                            {entry.ok ? 'ok' : 'error'}
                          </span>
                          <span className="text-gray-500 font-mono">
                            {new Date(entry.startedAt).toLocaleTimeString()} - {new Date(entry.endedAt).toLocaleTimeString()}
                          </span>
                          {entry.error && <span className="text-red-500 break-words">{entry.error}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
