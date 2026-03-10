"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Activity } from 'lucide-react';
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
import type { ExperienceStats } from '@/types/experience';
import type { ExperienceTier } from '@/types/agent-resume';
import { NLOpsBar } from '@/components/nlops-bar';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { AgentInteractionGraph } from '@/components/agent-interaction-graph';
import { AgentRosterPanel } from '@/components/agent-roster-panel';
import { OperationsPanel } from '@/components/operations-panel';

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
  lastScalingTime: string | null;
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

interface AgentDecisionEntry {
  decisionId: string;
  timestamp: string;
  severity?: string;
  chosenAction: string;
  reasoningSummary: string;
  evidence: Array<{ key: string; value: string }>;
  phaseTrace: Array<{ phase: string; startedAt: string; endedAt: string; ok: boolean }>;
  verification: { passed: boolean };
  inputs: { scalingScore?: number; anomalyCount: number };
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

  // --- vCPU change tracking ---
  const prevVcpuRef = useRef<number | null>(null);

  // --- Phase replay: re-animate last cycle's phaseTrace locally ---
  const [replayPhase, setReplayPhase] = useState<string | null>(null);
  const prevCycleTsRef = useRef<string | null>(null);

  // --- L1 RPC Failover State ---
  const [l1Failover, setL1Failover] = useState<L1FailoverStatus | null>(null);

  // --- Anomaly Events State ---
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyEventData[]>([]);

  // --- Agent Decisions State ---
  const [agentDecisions, setAgentDecisions] = useState<AgentDecisionEntry[]>([]);

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

  // --- Agent Experience State ---
  const [experience, setExperience] = useState<ExperienceData | null>(null);

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
              const newVcpu = scalerData.currentVcpu;
              const oldVcpu = prevVcpuRef.current;
              if (oldVcpu !== null && newVcpu !== oldVcpu) {
                const direction = newVcpu > oldVcpu ? '⬆' : '⬇';
                const msg = `${direction} Scaling: ${oldVcpu}→${newVcpu} vCPU`;
                if (newVcpu >= 8) {
                  toast.error(msg, { description: 'EMERGENCY tier — all hands on deck' });
                } else if (newVcpu > oldVcpu) {
                  toast.warning(msg, { description: newVcpu >= 4 ? 'HIGH tier activated' : 'NORMAL tier activated' });
                } else {
                  toast.success(msg, { description: 'Load reduced — scaled down' });
                }
              }
              prevVcpuRef.current = newVcpu;
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

  // --- Agent Loop polling (every 30s) ---
  // V2 mode: /api/agent-loop returns a synthetic snapshot via v2-cycle-adapter
  // (reads from MetricsStore → includes seeded data, computes real scalingScore)
  const isAgentV2 = agentFleet?.agentV2 === true;
  useEffect(() => {
    const fetchAgentLoop = async () => {
      try {
        const limit = 50;
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
  }, [isSeedActive]);

  // --- V2 Activity polling (every 30s) — only when Agent V2 is active ---
  useEffect(() => {
    if (!isAgentV2) return;
    const fetchV2Activities = async () => {
      try {
        const limit = 50;
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
  }, [isAgentV2]);

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

  // --- Agent Decisions polling (30s) ---
  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/agent-decisions?limit=20`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setAgentDecisions(data.traces || []);
        }
      } catch { /* ignore */ }
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, AGENT_LOOP_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

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
  const componentStates = useMemo<Record<string, 'normal' | 'anomaly' | 'critical' | 'inactive'>>(() => {
    const states: Record<string, 'normal' | 'anomaly' | 'critical' | 'inactive'> = {};
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

  const scalingScore = agentLoop?.lastCycle?.scaling?.score ?? 0;

  // Derive agentPhase for 3D graph:
  // lastCycle.phase is always 'complete' by the time UI polls (cycle finishes in ~2s).
  // Instead, derive a meaningful phase from anomaly event state.
  const graphAgentPhase = useMemo(() => {
    const rawPhase = agentLoop?.lastCycle?.phase;
    const activeAnomalies = (anomalyEvents ?? []).filter((a) => a.status === 'active');
    // If there are active anomalies with deep analysis → show 'analyze'
    if (activeAnomalies.some((a) => a.deepAnalysis)) return 'analyze';
    // If there are active anomalies without deep analysis yet → show 'detect'
    if (activeAnomalies.length > 0) return 'detect';
    // If a scaling event occurred within the last 30s → show 'act' (captures
    // scale-down after TTL expiry, which the UI poll might otherwise miss)
    if (scalerState?.lastScalingTime) {
      const elapsedMs = Date.now() - new Date(scalerState.lastScalingTime).getTime();
      if (elapsedMs < 30_000) return 'act';
    }
    // While seed is active, derive phase from metric intensity so edges stay
    // animated for the full seed TTL (80s), not just the anomaly lifetime.
    if (isSeedActive) {
      if (scalingScore >= 70) return 'act';     // SPIKE: executor/scaling edges
      if (scalingScore >= 30) return 'detect';  // RISING: detector→analyzer edges
      return 'observe';                         // STABLE: collector→detector edge
    }
    // Fall back to raw phase (may be 'complete', 'error', etc.)
    return rawPhase ?? 'idle';
  }, [agentLoop?.lastCycle?.phase, anomalyEvents, scalerState?.lastScalingTime, isSeedActive, scalingScore]);

  // Replay last cycle's phaseTrace locally so the map shows the real sequence.
  // Each phase is displayed for ~2s; after all phases shown, replay clears and
  // graphAgentPhase (heuristic) resumes.
  useEffect(() => {
    const cycleTs = agentLoop?.lastCycle?.timestamp;
    if (!cycleTs || cycleTs === prevCycleTsRef.current) return;
    prevCycleTsRef.current = cycleTs;

    const trace = agentLoop?.lastCycle?.phaseTrace;
    if (!trace || trace.length === 0) return;

    const PHASE_MS = 2000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    trace.forEach((p, i) => {
      timers.push(setTimeout(() => setReplayPhase(p.phase), i * PHASE_MS));
    });
    timers.push(setTimeout(() => setReplayPhase(null), trace.length * PHASE_MS));
    return () => timers.forEach(clearTimeout);
  }, [agentLoop?.lastCycle?.timestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effective phase for the interaction map: replay takes priority over heuristic
  const effectiveAgentPhase = replayPhase ?? graphAgentPhase;

  // --- Handler stubs for new layout ---
  const handleRunRca = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/rca`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) {
        toast.info('RCA skipped', { description: data.message });
        return;
      }
      toast.info('Running RCA...', { description: 'Root cause analysis started.' });
    } catch {
      toast.error('RCA request failed');
    }
  }, []);

  const handleRemediate = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/remediation`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ trigger: 'auto' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Remediation failed', { description: data.error });
        return;
      }
      if (data.success) {
        toast.success('Remediation complete', { description: `Playbook: ${data.execution?.playbookName}` });
      } else {
        toast.info('Remediation skipped', { description: data.execution?.playbookName === 'none' ? 'No matching playbook for current anomaly.' : data.message ?? 'Blocked by safety gate.' });
      }
    } catch {
      toast.error('Remediation request failed');
    }
  }, []);

  const handleNLOpsSend = useCallback((message: string) => {
    sendChatMessage(message);
  }, [sendChatMessage]);

  const handleInjectScenario = useCallback(async (scenario: string) => {
    try {
      await fetch(`${BASE_PATH}/api/metrics/seed?scenario=${scenario}`, {
        method: 'POST',
        headers: writeHeaders(),
      });
      setIsSeedActive(scenario !== 'live');
      setSeedTrigger(Date.now());
      toast.success(`Scenario: ${scenario}`, { description: scenario === 'live' ? 'Switched to live RPC data.' : 'Injected. Agent loop will detect anomalies within 30s.' });
    } catch {
      toast.error('Scenario injection failed');
    }
  }, []);

  const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
  const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME || current?.chain?.displayName;
  const chainName = networkName ?? 'Thanos Sepolia';
  const l1Block = current?.metrics?.l1BlockHeight ?? 0;
  const l2Block = current?.metrics?.blockHeight ?? 0;
  const txPool = current?.metrics?.txPoolCount ?? 0;
  const gasUsed = agentLoop?.lastCycle?.metrics?.gasUsedRatio ?? 0;
  const successRate = agentFleet?.kpi.successRate ?? 100; // 0–100 (percent, already multiplied in agent-fleet.ts)
  const vcpu = scalerState?.currentVcpu ?? agentLoop?.lastCycle?.scaling?.currentVcpu ?? 2;
  const p95 = agentFleet?.kpi.p95CycleMs ?? 0;

  // Derive scaling event for interaction graph banner
  const lastScaling = agentLoop?.lastCycle?.scaling;
  const scalingEvent = lastScaling && lastScaling.targetVcpu !== lastScaling.currentVcpu
    ? { from: lastScaling.currentVcpu, to: lastScaling.targetVcpu, score: lastScaling.score }
    : null;
  const p95Str = p95 >= 1000 ? `${(p95 / 1000).toFixed(1)}s` : `${p95}ms`;

  // Ticker items (duplicated for seamless scroll)
  const tickerItems = [
    { label: 'L2 BLOCK', value: l2Block.toLocaleString() },
    { label: 'L1 BLOCK', value: l1Block.toLocaleString() },
    { label: 'GAS RATIO', value: `${(gasUsed * 100).toFixed(0)}%` },
    { label: 'SUCCESS', value: `${successRate.toFixed(1)}%` },
    { label: 'P95', value: p95Str },
    { label: 'vCPU', value: `${vcpu} ACTIVE`, warn: vcpu >= 4 },
    { label: 'ANOMALIES', value: `${anomalyEvents.filter(e => e.status === 'active').length} OPEN`, neg: anomalyEvents.filter(e => e.status === 'active').length > 0 },
    { label: 'SCORE', value: String(scalingScore) },
  ];
  const tickerAll = [...tickerItems, ...tickerItems]; // duplicate for seamless loop

  if (isLoading) return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', color: '#0A0A0A', fontFamily: FONT }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '3px solid #D40000', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 12, letterSpacing: '0.1em' }}>CONNECTING TO CLUSTER...</span>
      </div>
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#FFFFFF', color: '#0A0A0A', overflow: 'hidden',
      fontFamily: FONT,
    }}>
      {/* ── Top Bar ── */}
      <div style={{
        background: '#D40000', color: 'white', height: 28, display: 'flex',
        alignItems: 'center', flexShrink: 0, borderBottom: '2px solid #8B0000',
      }}>
        <div style={{ background: '#8B0000', padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', borderRight: '2px solid #6B0000', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>SENTINAI</span>
        </div>
        {[
          { dot: graphAgentPhase !== 'error' && graphAgentPhase !== 'idle', label: 'CLUSTER ONLINE' },
          { dot: true, label: 'L2 SYNC' },
        ].map(({ dot, label }) => (
          <div key={label} style={{ padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot ? '#00FF88' : '#FF6060', boxShadow: `0 0 4px ${dot ? '#00FF88' : '#FF6060'}` }} />
            {label}
          </div>
        ))}
        <div style={{ padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
          {chainName.toUpperCase()}
        </div>
        {scalerState?.simulationMode && (
          <div style={{ padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
            SIMULATION MODE
          </div>
        )}
        <div style={{ marginLeft: 'auto', padding: '0 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.9)' }}>
          {new Date().toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).toUpperCase()}
        </div>
      </div>

      {/* ── Ticker ── */}
      <div style={{ background: '#0A0A0A', color: 'white', height: 22, display: 'flex', alignItems: 'center', overflow: 'hidden', flexShrink: 0, fontSize: 11, fontWeight: 500, letterSpacing: '0.04em' }}>
        <div style={{ background: '#0055AA', padding: '0 10px', height: '100%', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', flexShrink: 0 }}>
          LIVE
        </div>
        <div style={{ display: 'flex', animation: 'tickerScroll 28s linear infinite', whiteSpace: 'nowrap' }}>
          {tickerAll.map((item, i) => (
            <div key={i} style={{ padding: '0 18px', borderRight: '1px solid #333', display: 'flex', gap: 8 }}>
              <span style={{ color: '#888' }}>{item.label}</span>
              <span style={{ color: item.neg ? '#FF6060' : item.warn ? '#FFD700' : '#00FF88' }}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main 3-column ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 280px', flex: 1, overflow: 'hidden', borderTop: '1px solid #D0D0D0' }}>
        {/* Left: Agent Roster */}
        <AgentRosterPanel
          agentFleet={agentFleet ? {
            kpi: { successRate: agentFleet.kpi.successRate, criticalPathPhase: agentFleet.kpi.criticalPathPhase },
            roles: agentFleet.roles,
            summary: agentFleet.summary,
          } : null}
          experience={experience ? {
            tier: experience.tier,
            stats: { successRate: experience.stats.successRate ?? 1, totalOps: experience.stats.totalOperations ?? 0 },
            total: experience.total,
          } : null}
        />

        {/* Center: Interaction Graph */}
        <AgentInteractionGraph
          agentFleet={agentFleet ? {
            kpi: { throughputPerMin: agentFleet.kpi.throughputPerMin, successRate: agentFleet.kpi.successRate, p95CycleMs: agentFleet.kpi.p95CycleMs },
            roles: agentFleet.roles,
          } : null}
          anomalyEvents={anomalyEvents}
          agentPhase={effectiveAgentPhase}
          decisions={agentDecisions}
          scaling={scalingEvent}
        />

        {/* Right: Operations */}
        <OperationsPanel
          metrics={current}
          scalerState={scalerState}
          agentFleet={agentFleet ? { kpi: { throughputPerMin: agentFleet.kpi.throughputPerMin } } : null}
          l1Failover={l1Failover}
          scalingScore={scalingScore}
          currentVcpu={vcpu}
        />
      </div>

      {/* ── NLOps Bar ── */}
      <NLOpsBar
        onSend={handleNLOpsSend}
        onRunRca={handleRunRca}
        onRemediate={handleRemediate}
        onInjectScenario={handleInjectScenario}
        isLoading={isSending}
        chatMessages={chatMessages}
        chatMessagesEndRef={chatMessagesEndRef}
        pendingConfirmation={pendingConfirmation}
        onConfirm={handleConfirm}
        onDismiss={handleCancel}
      />

      <Toaster position="top-right" theme="light" />
    </div>
  );
}
