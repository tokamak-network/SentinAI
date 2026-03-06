"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
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
          setAnomalyEvents(data.events || []);
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


  if (isLoading) return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50 text-blue-600">
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
    <>
      {/* ── Showcase Banner ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="mx-auto max-w-[1600px] px-6 md:px-10 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Left: Chain + status */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {publicStatus ? (
                  <StatusBadgeIcon status={publicStatus.status} />
                ) : (
                  <span className="inline-block w-3.5 h-3.5 rounded-full bg-gray-200 animate-pulse" />
                )}
                <span className={`text-sm font-bold ${publicStatus ? chainStatusColor(publicStatus.status) : 'text-gray-400'}`}>
                  {publicStatus ? chainStatusLabel(publicStatus.status) : '—'}
                </span>
              </div>
              <span className="text-gray-300">|</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{chainName}</p>
                <p className="text-[11px] text-gray-400">SentinAI Autonomous Guardian</p>
              </div>
            </div>

            {/* Right: Live stats */}
            <div className="flex flex-wrap items-center gap-5">
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900 leading-none">
                  {publicStatus ? `${publicStatus.uptime.h24.toFixed(2)}%` : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">24h uptime</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900 leading-none">
                  {publicStatus ? `${publicStatus.uptime.d7.toFixed(2)}%` : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">7d uptime</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-indigo-600 leading-none">
                  {publicStatus
                    ? (isAgentV2
                        ? (publicStatus.agent.totalOps ?? 0).toLocaleString()
                        : publicStatus.agent.totalCycles.toLocaleString())
                    : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">{isAgentV2 ? 'total ops' : 'agent cycles'}</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700 leading-none">
                  {publicStatus
                    ? formatRelativeTime(isAgentV2 ? publicStatus.agent.lastActivityAt : publicStatus.agent.lastCycleAt)
                    : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">{isAgentV2 ? 'last activity' : 'last cycle'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Info Toast ── */}
      {!toastDismissed && (
        <div className="mx-auto max-w-[1600px] px-6 md:px-10 pt-4">
          <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
            <Activity size={15} className="text-indigo-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-900">You are viewing live operational data</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                All data shown on this dashboard is collected in real-time from {chainName}.
              </p>
              <a
                href="mailto:theo@tokamak.network?subject=SentinAI Connection Inquiry"
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
              >
                Connect your chain →
              </a>
            </div>
            <button
              onClick={dismissToast}
              className="text-indigo-400 hover:text-indigo-600 shrink-0"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Main Dashboard ── */}
    <div className="min-h-screen bg-[#F8F9FA] text-gray-800 font-sans p-4 sm:p-6 md:p-10 pb-16 max-w-[1600px] mx-auto overflow-x-hidden">

      {/* 1. Header (Clean & Functional) */}
      <header className="flex flex-wrap items-center gap-4 mb-8">
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
      {isReadOnlyMode && (
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
      <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full animate-pulse bg-blue-500"></div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">L1 Block</p>
              <p className="text-lg font-bold text-gray-900 font-mono">{current?.metrics.l1BlockHeight?.toLocaleString() || '—'}</p>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-gray-200"></div>
          <div className="flex items-center gap-3" data-testid="l2-block-number">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">L2 Block</p>
              <p className="text-lg font-bold text-gray-900 font-mono">{current?.metrics.blockHeight?.toLocaleString() || '—'}</p>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-gray-200"></div>
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
                <div className="hidden sm:block h-8 w-px bg-gray-200"></div>
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
              <div className="hidden sm:block h-8 w-px bg-gray-200"></div>
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
        <div className="bg-white rounded-2xl px-6 py-4 mb-8 shadow-sm border border-gray-200/60 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${l1Failover.healthy ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">L1 RPC</p>
                  <p className={`text-sm font-bold ${l1Failover.healthy ? 'text-green-600' : 'text-red-600'}`}>
                    {l1Failover.healthy ? 'Available' : 'Unavailable'}
                  </p>
                </div>
              </div>
              <div className="hidden sm:block h-6 w-px bg-gray-200"></div>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Failover Pool</p>
                <p className="text-sm font-bold text-gray-900">{l1Failover.failoverCount} endpoints</p>
              </div>
              <div className="hidden sm:block h-6 w-px bg-gray-200"></div>
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
          {(() => {
            const monthlyCostRaw = current?.cost.opGethMonthlyCost ?? current?.cost.monthlyEstimated;
            const monthlyCost = typeof monthlyCostRaw === 'number' && Number.isFinite(monthlyCostRaw) && monthlyCostRaw >= 0
              ? monthlyCostRaw
              : 42;
            const fixedCostRaw = current?.cost.fixedCost;
            const fixedCost = typeof fixedCostRaw === 'number' && Number.isFinite(fixedCostRaw) && fixedCostRaw > 0
              ? fixedCostRaw
              : 166;
            const vcpu = current?.metrics.gethVcpu ?? 1;
            const memGiB = current?.metrics.gethMemGiB ?? 2;
            const isPeak = current?.cost.isPeakMode ?? false;
            const hourlyRate = monthlyCost / 730;
            const savingsPct = fixedCost > 0 ? ((fixedCost - monthlyCost) / fixedCost * 100) : 0;
            const barPct = Math.min(Math.max((monthlyCost / fixedCost) * 100, 5), 100);
            const scenarioLabel = vcpu >= 8 ? { text: 'Emergency', color: 'text-red-500 bg-red-50' }
              : vcpu >= 4 ? { text: 'High Load',  color: 'text-orange-500 bg-orange-50' }
              : vcpu >= 2 ? { text: 'Moderate',   color: 'text-amber-500 bg-amber-50' }
              :             { text: 'Optimized',  color: 'text-emerald-600 bg-emerald-50' };
            return (
              <>
                <div data-testid="monthly-cost">
                  <div className="flex items-start justify-between">
                    <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Monthly Cost</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${scenarioLabel.color}`}>
                      {scenarioLabel.text}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-4xl font-black text-gray-900">
                      ${monthlyCost.toFixed(0)}
                    </span>
                    <span className="text-base font-bold text-gray-400">/mo</span>
                  </div>
                  <p className="text-gray-400 text-[10px] mt-0.5">
                    {vcpu} vCPU · {memGiB} GiB · ${hourlyRate.toFixed(3)}/hr est.
                  </p>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">vs 4 vCPU Fargate baseline (${fixedCost.toFixed(0)}/mo)</span>
                    <span className={`text-xs font-bold ${isPeak ? 'text-red-500' : 'text-green-600'}`}>
                      {isPeak ? '+' : '-'}{Math.abs(savingsPct).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${isPeak ? 'bg-red-400' : 'bg-emerald-400'}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-gray-400">$0</span>
                    <span className="text-[9px] text-gray-400">${fixedCost.toFixed(0)}</span>
                  </div>
                </div>
              </>
            );
          })()}
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
                      console.error(new Date().toISOString(), 'Cost analysis error:', e);
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
                        <p className={`text-xs text-blue-700 mt-1 leading-relaxed ${!aiInsightExpanded ? 'line-clamp-3' : ''}`}>
                          {costAnalysisData.aiInsight}
                        </p>
                        {costAnalysisData.aiInsight.length > 150 && (
                          <button
                            onClick={() => setAiInsightExpanded(!aiInsightExpanded)}
                            className="text-[10px] text-blue-600 font-semibold mt-1 hover:underline"
                          >
                            {aiInsightExpanded ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Top Recommendations */}
                    {costAnalysisData.recommendations && costAnalysisData.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-600 font-semibold">Recommendations</p>
                        {costAnalysisData.recommendations.map((rec, idx) => (
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

      {/* Autonomy Pipeline (3D Visualization) */}
      <AutonomyPipeline onSeedInjected={handleSeedInjected} />

      {/* Agent Loop Status Panel — hidden when Agent V2 (Parallel Agent Fleet) is active */}
      {!isAgentV2 && <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6" data-testid="agent-loop-panel">
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
            <span className="text-[10px] text-gray-400 font-mono">{agentLoop?.config.intervalSeconds || 60}s cycle</span>
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
                    <p className="text-[10px] text-red-400 break-words">
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
      </div>}

      {/* Parallel Agent Fleet Panel */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6" data-testid="parallel-agent-fleet-panel">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-gray-500" />
            <h3 className="font-bold text-gray-900 text-lg">Parallel Agent Fleet</h3>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">
            {agentFleet?.updatedAt ? `updated ${formatRelativeTime(agentFleet.updatedAt)}` : 'no fleet data'}
          </span>
        </div>

        {agentFleet ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Agents</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{agentFleet.summary.runningAgents}/{agentFleet.summary.totalAgents}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Instances</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{agentFleet.summary.instanceCount}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Success Rate</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{agentFleet.kpi.successRate.toFixed(1)}%</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">P95 Cycle</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{Math.round(agentFleet.kpi.p95CycleMs / 1000)}s</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="text-[10px] text-blue-500 uppercase font-semibold">Throughput</p>
                <p className="text-lg font-bold text-blue-700 font-mono mt-1">{agentFleet.kpi.throughputPerMin.toFixed(2)} tasks/min</p>
              </div>
              <div className={`rounded-xl p-3 border ${
                agentFleet.summary.staleAgents > agentFleet.summary.totalAgents / 2
                  ? 'bg-red-50 border-red-200'
                  : agentFleet.summary.staleAgents > 0
                    ? 'bg-amber-50 border-amber-100'
                    : 'bg-green-50 border-green-100'
              }`}>
                <p className={`text-[10px] uppercase font-semibold ${
                  agentFleet.summary.staleAgents > agentFleet.summary.totalAgents / 2 ? 'text-red-600' : 'text-amber-600'
                }`}>Stale Agents</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {agentFleet.summary.staleAgents > agentFleet.summary.totalAgents / 2 && (
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                  )}
                  <p className={`text-lg font-bold font-mono ${
                    agentFleet.summary.staleAgents > agentFleet.summary.totalAgents / 2
                      ? 'text-red-600'
                      : agentFleet.summary.staleAgents > 0
                        ? 'text-amber-700'
                        : 'text-green-600'
                  }`}>{agentFleet.summary.staleAgents}</p>
                  <span className="text-[10px] text-gray-400">/ {agentFleet.summary.totalAgents}</span>
                </div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                <p className="text-[10px] text-purple-600 uppercase font-semibold">Critical Path</p>
                <p className="text-lg font-bold text-purple-700 font-mono mt-1">{agentFleet.kpi.criticalPathPhase}</p>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Pipeline</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              {(['collector', 'detector', 'analyzer', 'executor', 'verifier'] as const).map((role) => {
                const roleData = agentFleet.roles[role];
                const isRoleStale = roleData.stale > 0;
                return (
                  <div
                    key={role}
                    className={`rounded-lg border px-2 py-2 ${
                      isRoleStale ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <p className="text-[10px] text-gray-500 uppercase font-semibold">{role}</p>
                    <p className="text-sm font-bold text-gray-900 font-mono">{roleData.running}/{roleData.total}</p>
                    <p className={`text-[10px] font-semibold ${isRoleStale ? 'text-amber-700' : 'text-gray-400'}`}>
                      stale {roleData.stale}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Domain Specialists</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              {(['scaling', 'security', 'reliability', 'rca', 'cost'] as const).map((role) => {
                const roleData = agentFleet.roles[role];
                const isRoleStale = roleData.stale > 0;
                return (
                  <div
                    key={role}
                    className={`rounded-lg border px-2 py-2 ${
                      isRoleStale ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-200'
                    }`}
                  >
                    <p className="text-[10px] text-indigo-500 uppercase font-semibold">{role}</p>
                    <p className="text-sm font-bold text-gray-900 font-mono">{roleData.running}/{roleData.total}</p>
                    <p className={`text-[10px] font-semibold ${isRoleStale ? 'text-amber-700' : 'text-gray-400'}`}>
                      stale {roleData.stale}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Action Agents</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(['remediation', 'notifier'] as const).map((role) => {
                const roleData = agentFleet.roles[role];
                const isRoleStale = roleData.stale > 0;
                return (
                  <div
                    key={role}
                    className={`rounded-lg border px-2 py-2 ${
                      isRoleStale ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    <p className="text-[10px] text-emerald-600 uppercase font-semibold">{role}</p>
                    <p className="text-sm font-bold text-gray-900 font-mono">{roleData.running}/{roleData.total}</p>
                    <p className={`text-[10px] font-semibold ${isRoleStale ? 'text-amber-700' : 'text-gray-400'}`}>
                      stale {roleData.stale}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
            <AlertTriangle size={16} />
            <span className="text-sm">No fleet data available yet</span>
          </div>
        )}
      </div>

      {/* Agent Experience Panel */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60 mb-6" data-testid="agent-experience-panel">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-gray-500" />
            <h3 className="font-bold text-gray-900 text-lg">Agent Experience</h3>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">
            {experience ? `${experience.total} total ops` : 'loading...'}
          </span>
        </div>

        {experience && experience.total > 0 ? (
          <>
            {/* KPI Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Ops</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{experience.total}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Success Rate</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{(experience.stats.successRate * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Avg Resolution</p>
                <p className="text-xl font-bold text-gray-900 font-mono mt-1">{Math.round(experience.stats.avgResolutionMs / 1000)}s</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Tier</p>
                <p className={`text-xl font-bold font-mono mt-1 capitalize ${tierColor(experience.tier)}`}>{experience.tier}</p>
              </div>
            </div>

            {/* Domain Activity */}
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Domain Activity</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              {(Object.keys(DOMAIN_CATEGORY_MAP) as Array<keyof typeof DOMAIN_CATEGORY_MAP>).map((domain) => {
                const count = experience.stats.topCategories.find(c => c.category === DOMAIN_CATEGORY_MAP[domain])?.count || 0;
                return (
                  <div key={domain} className="bg-indigo-50 rounded-lg border border-indigo-200 px-2 py-2">
                    <p className="text-[10px] text-indigo-500 uppercase font-semibold">{domain}</p>
                    <p className="text-sm font-bold text-gray-900 font-mono">{count} ops</p>
                  </div>
                );
              })}
            </div>

            {/* Learned Patterns (collapsible, grouped) */}
            {experience.patterns.length > 0 && (() => {
              // Group patterns by their type prefix (e.g., "eoa-balance on proposer_balance")
              const grouped = new Map<string, typeof experience.patterns>();
              for (const p of experience.patterns) {
                const match = p.description.match(/^When (.+?) reaches/);
                const key = match ? match[1] : 'other';
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(p);
              }
              const totalOccurrences = experience.patterns.reduce((s, p) => s + p.occurrences, 0);
              const groupEntries = [...grouped.entries()];
              const displayGroups = patternsExpanded ? groupEntries : groupEntries.slice(0, 2);

              return (
                <>
                  <button
                    onClick={() => setPatternsExpanded(!patternsExpanded)}
                    className="flex items-center justify-between w-full text-left mb-1"
                  >
                    <p className="text-[10px] text-gray-400 uppercase font-semibold">
                      Learned Patterns
                      <span className="ml-1 text-gray-300">({experience.patterns.length} patterns, {totalOccurrences} total occurrences)</span>
                    </p>
                    <ChevronDown size={12} className={`text-gray-400 transition-transform ${patternsExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <div className="space-y-1.5">
                    {displayGroups.map(([groupKey, patterns]) => {
                      const topPattern = patterns[0];
                      const totalGroupOccurrences = patterns.reduce((s, p) => s + p.occurrences, 0);
                      const avgSuccess = patterns.reduce((s, p) => s + p.successRate, 0) / patterns.length;
                      return (
                        <div key={groupKey} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700 truncate">
                              {patterns.length > 1
                                ? `${groupKey} — ${patterns.length} variants`
                                : topPattern.description}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-gray-400 font-mono">{totalGroupOccurrences}x</span>
                            <span className="text-[10px] text-green-600 font-mono font-bold">{(avgSuccess * 100).toFixed(0)}%</span>
                            <span className="w-8 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                              <span className="block h-full rounded-full bg-blue-500" style={{ width: `${topPattern.confidence * 100}%` }} />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {!patternsExpanded && groupEntries.length > 2 && (
                      <p className="text-[10px] text-gray-400 text-center">+{groupEntries.length - 2} more groups</p>
                    )}
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
            <AlertTriangle size={16} />
            <span className="text-sm">No experience data yet</span>
          </div>
        )}
      </div>

      {/* Row 2: Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-4 lg:auto-rows-fr overflow-x-hidden">

        {/* Activity Log */}
        {isAgentV2 ? (() => {
          const v2CategoryColor: Record<string, string> = {
            'scaling-action': 'text-amber-400',
            'cost-optimization': 'text-green-400',
            'rca-diagnosis': 'text-purple-400',
            'security-alert': 'text-red-400',
            'reliability-failover': 'text-blue-400',
            'anomaly-resolution': 'text-cyan-400',
            'remediation': 'text-fuchsia-400',
          };
          const v2CategoryBorder: Record<string, string> = {
            'scaling-action': 'border-l-2 border-amber-500 pl-2',
            'security-alert': 'border-l-2 border-red-500 pl-2',
            'reliability-failover': 'border-l-2 border-blue-500 pl-2',
            'rca-diagnosis': 'border-l-2 border-purple-500 pl-2',
          };
          const v2CategoryLabel: Record<string, string> = {
            'scaling-action': 'SCALING',
            'cost-optimization': 'COST',
            'rca-diagnosis': 'RCA',
            'security-alert': 'SECURITY',
            'reliability-failover': 'FAILOVER',
            'anomaly-resolution': 'ANOMALY',
            'remediation': 'REMEDIATE',
          };
          const v2OutcomeColor: Record<string, string> = {
            success: 'bg-green-500/15 text-green-400 border-green-500/25',
            failure: 'bg-red-500/15 text-red-400 border-red-500/25',
            partial: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
          };
          // Category counts for status bar
          const catCounts = new Map<string, number>();
          for (const a of v2Activities) {
            catCounts.set(a.category, (catCounts.get(a.category) ?? 0) + 1);
          }

          // Group consecutive identical events (same category + action)
          type GroupedEntry = { entries: typeof v2Activities; count: number; first: (typeof v2Activities)[0]; last: (typeof v2Activities)[0] };
          const groupedActivities: GroupedEntry[] = [];
          for (const entry of v2Activities) {
            const prev = groupedActivities[groupedActivities.length - 1];
            if (prev && prev.first.category === entry.category && prev.first.action === entry.action) {
              prev.entries.push(entry);
              prev.count++;
              prev.last = entry;
            } else {
              groupedActivities.push({ entries: [entry], count: 1, first: entry, last: entry });
            }
          }

          return (
          <div className="lg:col-span-7 bg-[#1A1D21] rounded-3xl shadow-xl overflow-hidden border border-gray-800 flex flex-col h-[34rem] lg:h-[38rem]">
            {/* Terminal Header */}
            <div className="bg-[#25282D] px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Zap className="text-blue-400" size={22} />
                <span className="text-gray-200 font-bold text-base tracking-wide">ACTIVITY LOG</span>
              </div>
              <div className="flex items-center gap-3">
                {v2Activities.length > 0 && (
                  <span className="text-[10px] text-gray-500 font-mono">
                    {v2Activities.length} entries
                  </span>
                )}
                {v2Activities.length > 50 && (
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
                <span className="text-xs text-gray-500 font-mono">Agent V2</span>
              </div>
            </div>

            <div className="flex-1 bg-[#0D1117] p-6 overflow-y-auto font-mono text-xs custom-scrollbar relative">
              <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#0D1117] to-transparent pointer-events-none z-10"></div>
              <div className="space-y-1">
                {groupedActivities.length > 0 ? groupedActivities.map((group) => {
                  const entry = group.first;
                  const d = new Date(entry.timestamp);
                  const date = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
                  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                  const color = v2CategoryColor[entry.category] ?? 'text-gray-400';
                  const borderColor = v2CategoryBorder[entry.category] ?? '';
                  const label = v2CategoryLabel[entry.category] ?? entry.category.toUpperCase();
                  const outcomeStyle = v2OutcomeColor[entry.outcome] ?? 'bg-gray-800/40 text-gray-400';

                  return (
                    <div key={entry.id} className={`flex flex-col gap-2 leading-relaxed ${borderColor}`}>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-900/40 border border-gray-800 text-gray-500 text-[10px] tabular-nums shrink-0" suppressHydrationWarning>
                          <span className="text-gray-700">{date}</span> {time}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border border-current/20 bg-black/10 font-bold text-[10px] tracking-wide shrink-0 ${color}`}>{label}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${outcomeStyle}`}>{entry.outcome}</span>
                        {group.count > 1 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-700/50 border border-gray-600 text-gray-300 text-[10px] font-bold shrink-0">
                            ×{group.count}
                          </span>
                        )}
                        <span className="text-gray-400 text-[11px] break-words min-w-0">{entry.action}</span>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex items-center justify-center gap-3 py-8 text-gray-500">
                    <Zap size={20} className="text-blue-400/40" />
                    <div>
                      <p className="text-blue-400/70 font-semibold text-sm font-sans">Waiting for agent activity...</p>
                      <p className="text-gray-600 text-xs mt-0.5 font-sans">Domain agents record experience as they operate</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Status Bar */}
            <div className="bg-[#25282D] px-4 py-2.5 border-t border-gray-800 flex items-center gap-4 shrink-0 text-[10px] font-mono">
              <div className="flex items-center gap-1.5 font-bold shrink-0 text-blue-400">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                AGENT V2
              </div>
              <span className="text-gray-700">|</span>
              <div className="flex items-center gap-1.5 text-gray-500">
                <span>{v2Activities.length} entries</span>
                {[...catCounts.entries()].slice(0, 3).map(([cat, count]) => (
                  <span key={cat}>
                    <span className="text-gray-700">·</span>
                    <span className={v2CategoryColor[cat] ?? 'text-gray-400'}> {v2CategoryLabel[cat] ?? cat} {count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          );
        })() : (() => {
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
                <span className="text-xs text-gray-500 font-mono">60s interval</span>
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
                          reasonSummary = cleanReason;
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
                              title="View decision trace"
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
                    {isAgentV2 ? (
                      <>
                        <Zap size={20} className="text-blue-400/40" />
                        <div>
                          <p className="text-blue-400/70 font-semibold text-sm font-sans">Agent V2 Active</p>
                          <p className="text-gray-600 text-xs mt-0.5 font-sans">Parallel Agent Fleet replaces serial agent loop</p>
                        </div>
                      </>
                    ) : agentLoop?.scheduler.agentLoopEnabled ? (
                      <>
                        <RefreshCw size={20} className="text-blue-400/40" />
                        <div>
                          <p className="text-blue-400/70 font-semibold text-sm font-sans">Waiting for first cycle...</p>
                          <p className="text-gray-600 text-xs mt-0.5 font-sans">Agent loop runs every 60 seconds</p>
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
                <h3 className="text-sm font-bold text-gray-900">Decision Trace</h3>
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
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              {decisionTraceLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <RefreshCw size={14} className="animate-spin text-blue-500" />
                  Loading trace data...
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
                        Verification: {selectedDecisionTrace.verification.passed ? 'passed' : 'failed'}
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
              <button data-testid="chat-close" onClick={(e) => { e.stopPropagation(); setChatOpen(false); }} className="text-gray-400 hover:text-white transition-colors p-1" aria-label="Toggle chat panel">
                <ChevronDown size={18} className={`transition-transform ${chatOpen ? '' : 'rotate-180'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      {chatOpen && (
        <div data-testid="chat-panel" className="fixed bottom-[52px] right-2 sm:right-6 w-[calc(100vw-1rem)] sm:w-[480px] bg-white rounded-t-2xl shadow-2xl border border-gray-200 z-50 flex flex-col max-h-[500px]">

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
    </>
  );
}

// --- Sub Components ---
