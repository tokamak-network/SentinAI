'use client';

import { useEffect, useState } from 'react';
import { Bot, X, Activity, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { AutonomyLevel, RuntimeAutonomyPolicy } from '@/types/policy';

// --- View-layer types ---

interface GoalManagerQueueItemData {
  goalId: string;
  status: string;
  goal: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  score: { total: number };
}

interface GoalManagerStatusData {
  config: {
    enabled: boolean;
    dispatchEnabled: boolean;
    llmEnhancerEnabled: boolean;
    dispatchDryRun: boolean;
    dispatchAllowWrites: boolean;
  };
  activeGoalId: string | null;
  queueDepth: number;
  queue: GoalManagerQueueItemData[];
  dlq: Array<{ id: string; goalId: string; reason: string; attempts: number }>;
  suppression: Array<{ id: string; reasonCode: string; timestamp: string }>;
}

interface AgentLoopStatus {
  scheduler: {
    initialized: boolean;
    agentLoopEnabled: boolean;
    agentTaskRunning: boolean;
  };
  lastCycle: {
    verification?: { passed: boolean };
    degraded?: { active: boolean; reasons: string[] };
  } | null;
}

type AutonomyDemoAction =
  | 'seed-stable'
  | 'seed-rising'
  | 'seed-spike'
  | 'goal-tick'
  | 'goal-dispatch-dry-run';

type ChainOperationalStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown';

interface PublicStatus {
  chain: { name: string; type: string };
  status: ChainOperationalStatus;
  metrics: { blockHeight: number; lastUpdatedAt: string };
  uptime: { h24: number; d7: number };
  incidents: { active: number; last24h: number };
  agent: { running: boolean; totalCycles: number; lastCycleAt?: string };
}

// --- Constants ---

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const API_KEY = process.env.NEXT_PUBLIC_SENTINAI_API_KEY || '';
const POLLING_INTERVAL_MS = 30_000;
const TOAST_DISMISSED_KEY = 'sentinai_showcase_toast_dismissed';

function writeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

function shortId(value?: string | null, visible = 8): string {
  if (!value) return '—';
  return value.length > visible ? `${value.slice(0, visible)}...` : value;
}

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

const AUTONOMY_LEVEL_OPTIONS: AutonomyLevel[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

const AUTONOMY_LEVEL_GUIDE: Record<AutonomyLevel, { permission: string; guardrail: string }> = {
  A0: {
    permission: 'Observe only, no autonomous execution',
    guardrail: 'All executions require manual operator approval',
  },
  A1: {
    permission: 'Can generate recommendations; execution is manually triggered',
    guardrail: 'Automatic dispatch remains disabled',
  },
  A2: {
    permission: 'Allows autonomous dry-run execution',
    guardrail: 'Write execution blocked, approval token required',
  },
  A3: {
    permission: 'Allows write execution for low-risk goals',
    guardrail: 'Switches to degraded mode on verification failure',
  },
  A4: {
    permission: 'Extends autonomous execution to medium-risk goals',
    guardrail: 'Enforces approval, verification, and audit logging',
  },
  A5: {
    permission: 'Maximum autonomy including high-risk goals',
    guardrail: 'Automatically rolls back on post-verification failure',
  },
};

// --- Sub-components ---

function StatusIcon({ status }: { status: ChainOperationalStatus }) {
  if (status === 'operational') return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === 'degraded') return <AlertTriangle size={14} className="text-amber-500" />;
  if (status === 'major_outage') return <XCircle size={14} className="text-red-500" />;
  return <Activity size={14} className="text-gray-400" />;
}

function statusLabel(status: ChainOperationalStatus): string {
  if (status === 'operational') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  if (status === 'major_outage') return 'Major Outage';
  return 'Unknown';
}

function statusColor(status: ChainOperationalStatus): string {
  if (status === 'operational') return 'text-green-600';
  if (status === 'degraded') return 'text-amber-600';
  if (status === 'major_outage') return 'text-red-600';
  return 'text-gray-400';
}

// --- Page Component ---

export default function CockpitPage() {
  // Showcase banner state
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null);
  const [toastDismissed, setToastDismissed] = useState(true); // start hidden, show after mount

  // Cockpit state
  const [goalManager, setGoalManager] = useState<GoalManagerStatusData | null>(null);
  const [autonomyPolicy, setAutonomyPolicy] = useState<RuntimeAutonomyPolicy | null>(null);
  const [agentLoop, setAgentLoop] = useState<AgentLoopStatus | null>(null);
  const [autonomyActionRunning, setAutonomyActionRunning] = useState<AutonomyDemoAction | null>(null);
  const [autonomyPolicyUpdating, setAutonomyPolicyUpdating] = useState<AutonomyLevel | null>(null);
  const [autonomyActionFeedback, setAutonomyActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // --- Data fetching ---

  const refreshPublicStatus = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/public/status`, { cache: 'no-store' });
      if (res.ok) setPublicStatus(await res.json() as PublicStatus);
    } catch {
      // ignore
    }
  };

  const refreshAutonomyPanels = async () => {
    try {
      const [goalManagerRes, policyRes] = await Promise.all([
        fetch(`${BASE_PATH}/api/goal-manager?limit=20`, { cache: 'no-store' }),
        fetch(`${BASE_PATH}/api/policy/autonomy-level`, { cache: 'no-store' }),
      ]);
      if (goalManagerRes.ok) {
        const data = await goalManagerRes.json() as GoalManagerStatusData;
        setGoalManager(data);
      }
      if (policyRes.ok) {
        const data = await policyRes.json() as { policy?: RuntimeAutonomyPolicy };
        if (data.policy) setAutonomyPolicy(data.policy);
      }
    } catch {
      // ignore
    }
  };

  const refreshAgentLoopPanel = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/agent-loop?limit=1`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as AgentLoopStatus;
        setAgentLoop(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    // Check if toast was previously dismissed
    try {
      const dismissed = localStorage.getItem(TOAST_DISMISSED_KEY);
      setToastDismissed(dismissed === 'true');
    } catch {
      setToastDismissed(false);
    }

    const refresh = async () => {
      await Promise.allSettled([
        refreshPublicStatus(),
        refreshAutonomyPanels(),
        refreshAgentLoopPanel(),
      ]);
      setIsLoading(false);
    };
    refresh();
    const interval = setInterval(refresh, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const dismissToast = () => {
    setToastDismissed(true);
    try { localStorage.setItem(TOAST_DISMISSED_KEY, 'true'); } catch { /* ignore */ }
  };

  // --- Actions ---

  const runAutonomyDemoAction = async (action: AutonomyDemoAction) => {
    if (autonomyActionRunning) return;
    setAutonomyActionRunning(action);
    setAutonomyActionFeedback(null);
    try {
      if (action === 'seed-stable' || action === 'seed-rising' || action === 'seed-spike') {
        const scenario = action.replace('seed-', '');
        const res = await fetch(`${BASE_PATH}/api/metrics/seed?scenario=${scenario}`, {
          method: 'POST',
          headers: writeHeaders(),
        });
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to inject scenario.');
        const injectedCount = typeof body.injectedCount === 'number' ? body.injectedCount : null;
        setAutonomyActionFeedback({
          type: 'success',
          message: injectedCount !== null
            ? `Scenario ${scenario} injected (${injectedCount} data points)`
            : `Scenario ${scenario} injected`,
        });
      } else if (action === 'goal-tick') {
        const res = await fetch(`${BASE_PATH}/api/goal-manager/tick`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({}),
        });
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to execute goal tick.');
        const generated = typeof body.generatedCount === 'number' ? body.generatedCount : 0;
        const queued = typeof body.queuedCount === 'number' ? body.queuedCount : 0;
        const depth = typeof body.queueDepth === 'number' ? body.queueDepth : 0;
        setAutonomyActionFeedback({
          type: 'success',
          message: `Goal tick completed (generated ${generated}, queued ${queued}, queue depth ${depth})`,
        });
      } else {
        const res = await fetch(`${BASE_PATH}/api/goal-manager/dispatch`, {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ dryRun: true, allowWrites: false }),
        });
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to execute dry-run dispatch.');
        const status = typeof body.status === 'string'
          ? body.status
          : typeof body.reason === 'string' ? body.reason : 'unknown';
        setAutonomyActionFeedback({
          type: 'success',
          message: `Dry-run dispatch completed (status: ${status})`,
        });
      }
      await Promise.all([refreshAgentLoopPanel(), refreshAutonomyPanels()]);
    } catch (error) {
      setAutonomyActionFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'An error occurred.',
      });
    } finally {
      setAutonomyActionRunning(null);
    }
  };

  const updateAutonomyPolicyLevel = async (level: AutonomyLevel) => {
    if (autonomyPolicyUpdating || autonomyActionRunning) return;
    if (!API_KEY || API_KEY.trim().length === 0) {
      setAutonomyActionFeedback({
        type: 'error',
        message: 'Changing policy level requires `NEXT_PUBLIC_SENTINAI_API_KEY`.',
      });
      return;
    }
    setAutonomyPolicyUpdating(level);
    setAutonomyActionFeedback(null);
    try {
      const response = await fetch(`${BASE_PATH}/api/policy/autonomy-level`, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ level }),
      });
      const body = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to update autonomy policy level.');
      const policy = (body as { policy?: RuntimeAutonomyPolicy }).policy;
      if (policy) setAutonomyPolicy(policy);
      setAutonomyActionFeedback({ type: 'success', message: `Autonomy level changed to ${level}.` });
      await refreshAutonomyPanels();
    } catch (error) {
      setAutonomyActionFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'An error occurred.',
      });
    } finally {
      setAutonomyPolicyUpdating(null);
    }
  };

  // --- Derived state ---

  const isReadOnlyMode = process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
  const activeQueueItem = goalManager?.queue?.find((item) =>
    item.status === 'running' || item.status === 'scheduled' || item.status === 'queued'
  );
  const latestVerificationPassed = agentLoop?.lastCycle?.verification?.passed;
  const latestDegradedReasons = agentLoop?.lastCycle?.degraded?.reasons || [];
  const activeAutonomyLevel = autonomyPolicy?.level ?? 'A2';
  const activeAutonomyGuide = AUTONOMY_LEVEL_GUIDE[activeAutonomyLevel];
  const chainName = publicStatus?.chain.name ?? process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Thanos Sepolia';

  return (
    <main className="min-h-screen bg-gray-50">
      {/* ── Showcase Banner ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-5xl px-4 md:px-8 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Left: Chain + status */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {publicStatus ? (
                  <StatusIcon status={publicStatus.status} />
                ) : (
                  <span className="inline-block w-3.5 h-3.5 rounded-full bg-gray-200 animate-pulse" />
                )}
                <span className={`text-sm font-bold ${publicStatus ? statusColor(publicStatus.status) : 'text-gray-400'}`}>
                  {publicStatus ? statusLabel(publicStatus.status) : '—'}
                </span>
              </div>
              <span className="text-gray-300">|</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{chainName}</p>
                <p className="text-[11px] text-gray-400">SentinAI 24/7 자율 운영 중</p>
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
                  {publicStatus ? publicStatus.agent.totalCycles.toLocaleString() : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">agent cycles</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700 leading-none">
                  {publicStatus ? formatRelativeTime(publicStatus.agent.lastCycleAt) : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">last cycle</p>
              </div>
              {publicStatus && (
                <div className="text-center">
                  <p className="text-sm font-mono font-semibold text-gray-700 leading-none">
                    #{publicStatus.metrics.blockHeight.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">block height</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Read-only toast ── */}
      {!toastDismissed && (
        <div className="mx-auto max-w-5xl px-4 md:px-8 pt-4">
          <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
            <Activity size={15} className="text-indigo-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-900">실제 운영 데이터를 보고 있습니다</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                이 대시보드에 표시되는 모든 데이터는 Thanos Sepolia에서 실시간으로 수집된 운영 데이터입니다.
              </p>
              <a
                href="mailto:contact@tokamak.network?subject=SentinAI 연결 문의"
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
              >
                내 체인에도 연결하려면 →
              </a>
            </div>
            <button
              onClick={dismissToast}
              className="text-indigo-400 hover:text-indigo-600 shrink-0"
              aria-label="닫기"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Autonomy Cockpit ── */}
      <div className="mx-auto max-w-5xl px-4 md:px-8 py-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Bot size={18} className="text-indigo-500" />
          <h1 className="text-base font-bold text-gray-900">Autonomy Cockpit</h1>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200/60 flex items-center justify-center">
            <p className="text-sm text-gray-400 animate-pulse">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200/60" data-testid="autonomy-cockpit-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-indigo-500" />
                <h3 className="font-bold text-gray-900">Autonomous Operations</h3>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-bold"
                  data-testid="autonomy-current-level-badge"
                >
                  {autonomyPolicy?.level || 'A?'}
                </span>
                <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                  agentLoop?.scheduler.agentLoopEnabled
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {agentLoop?.scheduler.agentLoopEnabled ? 'loop:on' : 'loop:off'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Engine Status */}
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Engine Status</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Goal Manager</span>
                      <span className={`text-xs font-bold ${goalManager?.config.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                        {goalManager?.config.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Dispatch</span>
                      <span className={`text-xs font-bold ${goalManager?.config.dispatchEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
                        {goalManager?.config.dispatchEnabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Dispatch Mode</span>
                      <span className="text-xs font-bold text-gray-700">
                        {goalManager?.config.dispatchDryRun ? 'dry-run' : 'write'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Goal Queue */}
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Goal Queue</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Queue Depth</span>
                      <span className="text-sm font-bold text-gray-900 font-mono">{goalManager?.queueDepth ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Active Goal</span>
                      <span className="text-xs font-bold text-gray-700 font-mono">{shortId(goalManager?.activeGoalId)}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate" title={activeQueueItem?.goal || ''}>
                      top: {activeQueueItem?.goal || 'No queued goal'}
                    </p>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                        suppression {goalManager?.suppression?.length ?? 0}
                      </span>
                      <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                        dlq {goalManager?.dlq?.length ?? 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Guardrails */}
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Guardrails</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Read-Only</span>
                      <span className={`text-xs font-bold ${isReadOnlyMode ? 'text-amber-600' : 'text-green-600'}`}>
                        {isReadOnlyMode ? 'On' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Verify</span>
                      <span className={`text-xs font-bold ${
                        latestVerificationPassed === undefined ? 'text-gray-400'
                          : latestVerificationPassed ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {latestVerificationPassed === undefined ? 'N/A' : latestVerificationPassed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Approval (Write)</span>
                      <span className="text-xs font-bold text-indigo-600">Required</span>
                    </div>
                    <p className={`text-[11px] truncate ${latestDegradedReasons.length > 0 ? 'text-amber-600' : 'text-gray-400'}`}
                      title={latestDegradedReasons.join(' | ')}>
                      degraded: {latestDegradedReasons[0] || 'none'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Demo Controls */}
              <div className="lg:col-span-4 bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Demo Controls</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Inject a scenario, then run tick/dispatch to observe the autonomous flow.
                </p>

                <div className="mt-3">
                  <p className="text-[10px] text-gray-500 font-semibold uppercase">Autonomy Level</p>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {AUTONOMY_LEVEL_OPTIONS.map((level) => {
                      const isActive = autonomyPolicy?.level === level;
                      const isUpdating = autonomyPolicyUpdating === level;
                      const levelGuide = AUTONOMY_LEVEL_GUIDE[level];
                      return (
                        <div key={level} className="relative group">
                          <button
                            onClick={() => updateAutonomyPolicyLevel(level)}
                            disabled={autonomyActionRunning !== null || autonomyPolicyUpdating !== null || !API_KEY}
                            className={`w-full px-2 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                              isActive
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                            }`}
                            data-testid={`autonomy-level-btn-${level}`}
                            aria-describedby={`autonomy-level-tooltip-${level}`}
                          >
                            {isUpdating ? 'Updating' : level}
                          </button>
                          <div
                            id={`autonomy-level-tooltip-${level}`}
                            role="tooltip"
                            data-testid={`autonomy-level-tooltip-${level}`}
                            className="pointer-events-none absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1.5 w-52 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-lg text-[10px] text-gray-600 invisible opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                          >
                            <p className="font-bold text-gray-800">{level} Permissions / Guardrails</p>
                            <p className="mt-0.5">Permission: {levelGuide.permission}</p>
                            <p>Guardrail: {levelGuide.guardrail}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    dry-run threshold {autonomyPolicy?.minConfidenceDryRun?.toFixed(2) ?? '0.00'} · write threshold {autonomyPolicy?.minConfidenceWrite?.toFixed(2) ?? '0.00'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Current {activeAutonomyLevel}: {activeAutonomyGuide.permission} / {activeAutonomyGuide.guardrail}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  {(['seed-stable', 'seed-rising', 'seed-spike'] as const).map((action) => {
                    const label = action.replace('seed-', '');
                    const colorMap = { stable: 'bg-blue-50 text-blue-700 hover:bg-blue-100', rising: 'bg-amber-50 text-amber-700 hover:bg-amber-100', spike: 'bg-red-50 text-red-700 hover:bg-red-100' };
                    return (
                      <button
                        key={action}
                        onClick={() => runAutonomyDemoAction(action)}
                        disabled={autonomyActionRunning !== null || autonomyPolicyUpdating !== null}
                        className={`px-2 py-2 text-[11px] font-semibold rounded-lg disabled:opacity-50 capitalize ${colorMap[label as keyof typeof colorMap]}`}
                      >
                        {autonomyActionRunning === action ? 'Running' : label.charAt(0).toUpperCase() + label.slice(1)}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => runAutonomyDemoAction('goal-tick')}
                    disabled={autonomyActionRunning !== null || autonomyPolicyUpdating !== null}
                    className="px-2 py-2 text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {autonomyActionRunning === 'goal-tick' ? 'Running Tick' : 'Goal Tick'}
                  </button>
                  <button
                    onClick={() => runAutonomyDemoAction('goal-dispatch-dry-run')}
                    disabled={autonomyActionRunning !== null || autonomyPolicyUpdating !== null}
                    className="px-2 py-2 text-[11px] font-semibold rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                  >
                    {autonomyActionRunning === 'goal-dispatch-dry-run' ? 'Running' : 'Dispatch Dry-run'}
                  </button>
                </div>

                {autonomyActionFeedback && (
                  <div
                    className={`mt-3 text-[11px] px-2.5 py-2 rounded-lg border ${
                      autonomyActionFeedback.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}
                    data-testid="autonomy-action-feedback"
                  >
                    {autonomyActionFeedback.message}
                  </div>
                )}

                {(!API_KEY || API_KEY.trim().length === 0) && (
                  <p className="mt-2 text-[10px] text-amber-600">
                    Note: policy level changes require <code className="font-mono">NEXT_PUBLIC_SENTINAI_API_KEY</code>.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
