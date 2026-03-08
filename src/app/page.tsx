"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity, Server, Zap,
  CheckCircle2, Shield, Globe, AlertTriangle, XCircle,
  ChevronDown, X,
  Send, Bot, User, RefreshCw, Pause
} from 'lucide-react';
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
import type { CostReport } from '@/types/cost';
import type { ExperienceStats } from '@/types/experience';
import type { ExperienceTier } from '@/types/agent-resume';
import { DOMAIN_CATEGORY_MAP } from '@/types/experience';
import { AutonomyPipeline } from '@/components/autonomy';
import { StatusBar } from '@/components/status-bar';
import { EventStream } from '@/components/event-stream';
import type { StreamEvent } from '@/components/event-stream';
import { ScalingPanel } from '@/components/scaling-panel';
import { NLOpsBar } from '@/components/nlops-bar';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import type { NodeState } from '@/components/agent-network-graph';

const AgentNetworkGraph = dynamic(
  () => import('@/components/agent-network-graph').then((m) => m.AgentNetworkGraph),
  { ssr: false, loading: () => <div className="w-full h-full bg-card animate-pulse rounded-lg" /> }
);

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

interface AgentFleetRoleSummary {
  total: number;
  running: number;
  stale: number;
}

interface AgentFleetData {
  agentV2?: boolean;
  summary: {
    totalAgents: number;
    runningAgents: number;
    staleAgents: number;
    instanceCount: number;
  };
  kpi: {
    throughputPerMin: number;
    successRate: number;
    p95CycleMs: number;
    criticalPathPhase: string;
  };
  roles: Record<
    | 'collector' | 'detector' | 'analyzer' | 'executor' | 'verifier'
    | 'scaling' | 'security' | 'reliability' | 'rca' | 'cost'
    | 'remediation' | 'notifier',
    AgentFleetRoleSummary
  >;
  updatedAt: string;
}

interface ExperienceData {
  stats: ExperienceStats;
  entries: Array<{
    id: string;
    category: string;
    action: string;
    outcome: string;
    timestamp: string;
  }>;
  patterns: Array<{
    id: string;
    description: string;
    occurrences: number;
    successRate: number;
    confidence: number;
  }>;
  tier: ExperienceTier;
  total: number;
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

// --- Public Status Types ---
type ChainOperationalStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown';

interface PublicStatus {
  chain: { name: string; type: string };
  status: ChainOperationalStatus;
  metrics: { blockHeight: number; lastUpdatedAt: string };
  uptime: { h24: number; d7: number };
  incidents: { active: number; last24h: number };
  agent: { running: boolean; totalCycles: number; lastCycleAt?: string; totalOps?: number; lastActivityAt?: string };
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

const TOAST_DISMISSED_KEY = 'sentinai_showcase_toast_dismissed';

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return '—';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}h ago`;
}

function tierColor(tier: ExperienceTier): string {
  switch (tier) {
    case 'expert': return 'text-purple-600';
    case 'senior': return 'text-green-600';
    case 'junior': return 'text-blue-600';
    case 'trainee': return 'text-gray-500';
  }
}

function StatusBadgeIcon({ status }: { status: ChainOperationalStatus }) {
  if (status === 'operational') return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === 'degraded') return <AlertTriangle size={14} className="text-amber-500" />;
  if (status === 'major_outage') return <XCircle size={14} className="text-red-500" />;
  return <Activity size={14} className="text-gray-400" />;
}

function chainStatusLabel(status: ChainOperationalStatus): string {
  if (status === 'operational') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  if (status === 'major_outage') return 'Major Outage';
  return 'Unknown';
}

function chainStatusColor(status: ChainOperationalStatus): string {
  if (status === 'operational') return 'text-green-600';
  if (status === 'degraded') return 'text-amber-600';
  if (status === 'major_outage') return 'text-red-600';
  return 'text-gray-400';
}


/** Metrics API polling interval (ms). Adjusted to reduce L1 RPC load (1s → 60s). */
const METRICS_REFRESH_INTERVAL_MS = 60_000;
/** Accelerated polling when seed scenario is active */
const SEED_ACTIVE_REFRESH_INTERVAL_MS = 5_000;

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
  const [scalerState, setScalerState] = useState<ScalerState | null>(null);

  // --- Anomaly toast ref ---
  const prevAnomaliesRef = useRef<AnomalyEventData[] | null>(null);

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

  // --- Seed Scenario Polling Acceleration ---
  const [isSeedActive, setIsSeedActive] = useState(false);

  // --- Agent Loop State ---
  const [agentLoop, setAgentLoop] = useState<AgentLoopStatus | null>(null);
  const [agentFleet, setAgentFleet] = useState<AgentFleetData | null>(null);
  const [v2Activities, setV2Activities] = useState<ExperienceData['entries']>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [selectedDecisionTrace, setSelectedDecisionTrace] = useState<DecisionTraceData | null>(null);
  const [decisionTraceLoading, setDecisionTraceLoading] = useState(false);
  const [decisionTraceError, setDecisionTraceError] = useState<string | null>(null);

  // --- Cost Analysis State ---
  const [costAnalysisExpanded, setCostAnalysisExpanded] = useState(false);
  const [costAnalysisData, setCostAnalysisData] = useState<CostReport | null>(null);
  const [costAnalysisLoading, setCostAnalysisLoading] = useState(false);
  const [aiInsightExpanded, setAiInsightExpanded] = useState(false);
  const [patternsExpanded, setPatternsExpanded] = useState(false);

  // --- Agent Experience State ---
  const [experience, setExperience] = useState<ExperienceData | null>(null);

  // --- Public Status / Showcase Banner State ---
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null);
  const [toastDismissed, setToastDismissed] = useState(true);

  // --- Seed Injection Trigger (forces immediate metrics re-fetch) ---
  const [seedTrigger, setSeedTrigger] = useState(0);
  const handleSeedInjected = useCallback(() => {
    setIsSeedActive(true);
    setSeedTrigger(Date.now());
  }, []);

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
        throw new Error(data?.error || 'Failed to load decision trace.');
      }
      setSelectedDecisionTrace(data.trace as DecisionTraceData);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load decision trace.';
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

  const refreshPublicStatus = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/public/status`, { cache: 'no-store' });
      if (res.ok) setPublicStatus(await res.json() as PublicStatus);
    } catch {
      // ignore
    }
  };

  const dismissToast = () => {
    setToastDismissed(true);
    try { localStorage.setItem(TOAST_DISMISSED_KEY, 'true'); } catch { /* ignore */ }
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
        setIsSeedActive(data.metrics?.source === 'SEED_SCENARIO');

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
              setScalerState(scalerData);
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
          console.info(new Date().toISOString(), 'Fetch aborted');
          return;
        }
        console.error(new Date().toISOString(), err);
        // Avoid locking the UI on a permanent loading screen in demo/test environments.
        setIsLoading(false);
        setCurrent(null);
      }
    };

    fetchData();
    const metricsInterval = isSeedActive ? SEED_ACTIVE_REFRESH_INTERVAL_MS : METRICS_REFRESH_INTERVAL_MS;
    const interval = setInterval(fetchData, metricsInterval);
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isSeedActive, seedTrigger]);

  // --- Public Status polling (every 30s) ---
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(TOAST_DISMISSED_KEY);
      setToastDismissed(dismissed === 'true');
    } catch {
      setToastDismissed(false);
    }
    refreshPublicStatus();
    const interval = setInterval(refreshPublicStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // --- Agent Loop polling (every 60s) — skipped when Agent V2 is active ---
  const isAgentV2 = agentFleet?.agentV2 === true;
  useEffect(() => {
    if (isAgentV2) return; // Agent V2 uses Goal Manager, not agent loop
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
    const agentInterval = isSeedActive ? SEED_ACTIVE_REFRESH_INTERVAL_MS : AGENT_LOOP_REFRESH_INTERVAL_MS;
    const interval = setInterval(fetchAgentLoop, agentInterval);
    return () => clearInterval(interval);
  }, [showFullHistory, isSeedActive, isAgentV2]);

  // --- V2 Activity polling (every 30s) — only when Agent V2 is active ---
  useEffect(() => {
    if (!isAgentV2) return;
    const fetchV2Activities = async () => {
      try {
        const limit = showFullHistory ? 200 : 50;
        const res = await fetch(`${BASE_PATH}/api/experience?limit=${limit}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as ExperienceData;
          setV2Activities(data.entries ?? []);
        }
      } catch {
        // Silently ignore
      }
    };
    fetchV2Activities();
    const interval = setInterval(fetchV2Activities, AGENT_LOOP_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAgentV2, showFullHistory]);

  // --- Parallel Agent Fleet polling (every 30s) ---
  useEffect(() => {
    const fetchAgentFleet = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/agent-fleet?limit=120`, { cache: 'no-store' });
        if (res.ok) {
          setAgentFleet(await res.json());
        }
      } catch {
        // Silently ignore — fleet panel will show stale data
      }
    };
    fetchAgentFleet();
    const interval = setInterval(fetchAgentFleet, AGENT_LOOP_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // --- Anomaly Events polling (with agent loop) ---
  useEffect(() => {
    const fetchAnomalies = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/anomalies`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const newAnomalies: AnomalyEventData[] = data.events || [];
          setAnomalyEvents(newAnomalies);

          // Notify on new anomalies
          if (newAnomalies.length > (prevAnomaliesRef.current?.length ?? 0)) {
            const latest = newAnomalies[0];
            if (latest) {
              const component = latest.deepAnalysis?.relatedComponents?.[0] ?? 'unknown';
              const description = latest.deepAnalysis?.anomalyType ?? '';
              toast.warning(`Anomaly detected: ${component}`, {
                description,
              });
            }
          }
          prevAnomaliesRef.current = newAnomalies;
        }
      } catch { /* ignore */ }
    };
    fetchAnomalies();
    const anomalyInterval = isSeedActive ? SEED_ACTIVE_REFRESH_INTERVAL_MS : AGENT_LOOP_REFRESH_INTERVAL_MS;
    const interval = setInterval(fetchAnomalies, anomalyInterval);
    return () => clearInterval(interval);
  }, [isSeedActive]);

  // --- Agent Experience polling (30s) ---
  useEffect(() => {
    const fetchExperience = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/experience?limit=10`, { cache: 'no-store' });
        if (res.ok) {
          setExperience(await res.json());
        }
      } catch { /* ignore */ }
    };
    fetchExperience();
    const interval = setInterval(fetchExperience, AGENT_LOOP_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);


  // --- Derived state for new layout components ---

  // Derive componentStates for 3D graph from anomaly events
  const componentStates = useMemo<Record<string, NodeState>>(() => {
    const states: Record<string, NodeState> = {};
    (anomalyEvents ?? []).filter((a) => a.status === 'active').forEach((a) => {
      const severity = a.deepAnalysis?.severity;
      const components = a.deepAnalysis?.relatedComponents ?? [];
      components.forEach((comp) => {
        if (severity === 'critical') {
          states[comp] = 'critical';
        } else if (severity === 'high' && states[comp] !== 'critical') {
          states[comp] = 'anomaly';
        }
      });
    });
    return states;
  }, [anomalyEvents]);

  // Derive StreamEvents from anomaly events
  const streamEvents = useMemo<StreamEvent[]>(() => {
    const events: StreamEvent[] = [];
    (anomalyEvents ?? []).slice(0, 15).forEach((a) => {
      const component = a.deepAnalysis?.relatedComponents?.[0] ?? '';
      const description = a.deepAnalysis?.anomalyType ?? '';
      const severity = a.deepAnalysis?.severity as 'low' | 'medium' | 'high' | 'critical' | undefined;
      events.push({
        id: a.id,
        time: new Date(a.timestamp).toLocaleTimeString(),
        type: 'anomaly',
        message: component ? `${component}: ${description}` : description,
        severity,
      });
    });
    return events.slice(0, 20);
  }, [anomalyEvents]);

  // --- Handler stubs for new layout ---
  const handleRunRca = useCallback(async () => {
    try {
      await fetch(`${BASE_PATH}/api/rca`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({}),
      });
      toast.info('Running RCA...', { description: 'Root cause analysis started.' });
    } catch {
      toast.error('RCA failed');
    }
  }, []);

  const handleRemediate = useCallback(() => {
    toast.info('Remediation triggered', { description: 'Use NLOps to request remediation.' });
  }, []);

  const handleNLOpsSend = useCallback((message: string) => {
    sendChatMessage(message);
  }, [sendChatMessage]);

  if (isLoading) return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <Activity className="animate-spin w-10 h-10" />
        <span className="font-medium font-sans">Connecting to Cluster...</span>
      </div>
    </div>
  );

  const isReadOnlyMode = process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
  const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME || current?.chain?.displayName;
  const eoaRoleEntries = Object.entries(current?.eoaBalances?.roles || {}).filter(([, value]) => value !== null);
  const showL1Failover = Boolean(l1Failover && current?.chain?.capabilities?.l1Failover !== false);
  const showFaultProof = Boolean(current?.chain?.capabilities?.disputeGameMonitoring && current?.disputeGames?.enabled);
  const showProof = Boolean(current?.chain?.capabilities?.proofMonitoring && current?.proof?.enabled);
  const showSettlement = Boolean(current?.chain?.capabilities?.settlementMonitoring && current?.settlement?.enabled);

  // --- Render ---
  const chainName = publicStatus?.chain.name ?? process.env.NEXT_PUBLIC_NETWORK_NAME ?? networkName ?? 'Thanos Sepolia';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Top status bar */}
      <StatusBar
        l1BlockHeight={current?.metrics?.l1BlockHeight ?? 0}
        l2BlockHeight={current?.metrics?.blockHeight ?? 0}
        l1BlockDelta={0}
        l2BlockDelta={0}
        txPoolPending={current?.metrics?.txPoolCount ?? 0}
        agentScore={agentLoop?.lastCycle?.scaling?.score ?? scalerState?.currentVcpu ?? 0}
        agentPhase={agentLoop?.lastCycle?.phase ?? 'idle'}
        isSyncing={false}
        networkName={process.env.NEXT_PUBLIC_NETWORK_NAME ?? current?.chain?.displayName}
      />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: 3D Agent Graph (65%) */}
        <div className="flex-1 min-h-0 p-3">
          <AgentNetworkGraph
            componentStates={componentStates}
            agentPhase={agentLoop?.lastCycle?.phase}
          />
        </div>

        {/* Right panels (35%, max 320px) */}
        <div className="w-80 flex flex-col gap-2 p-3 pl-0 min-h-0">
          <div className="flex-1 min-h-0">
            <EventStream events={streamEvents} />
          </div>
          <ScalingPanel
            score={agentLoop?.lastCycle?.scaling?.score ?? 0}
            currentVcpu={scalerState?.currentVcpu ?? agentLoop?.lastCycle?.scaling?.currentVcpu ?? 2}
            targetVcpu={agentLoop?.lastCycle?.scaling?.targetVcpu ?? scalerState?.currentVcpu ?? 2}
            autoScalingEnabled={scalerState?.autoScalingEnabled ?? agentLoop?.config?.autoScalingEnabled ?? false}
            predictionTier={scalerState?.prediction ? String(scalerState.prediction.predictedVcpu) + ' vCPU' : undefined}
            predictionConfidence={scalerState?.prediction?.confidence}
            lastDecision={agentLoop?.lastCycle?.scaling?.reason}
          />
        </div>
      </div>

      {/* Bottom: NLOps bar */}
      <NLOpsBar
        onSend={handleNLOpsSend}
        onRunRca={handleRunRca}
        onRemediate={handleRemediate}
        isLoading={isSending}
      />

      {/* Sonner toast container */}
      <Toaster position="top-right" theme="dark" />

    </div>
  );
}
