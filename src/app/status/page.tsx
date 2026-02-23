"use client";

/**
 * Public Chain SLA Status Page
 * /status — No authentication required
 *
 * Displays real-time chain health, uptime metrics, and recent incidents.
 * Auto-refreshes every 30 seconds to match the agent loop interval.
 */

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Activity, Clock, Zap, RefreshCw, Shield } from 'lucide-react';
import type { PublicStatusResponse, ChainOperationalStatus } from '@/app/api/public/status/route';

const REFRESH_INTERVAL_MS = 30_000;

// ============================================================================
// Status config
// ============================================================================

interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  Icon: React.ElementType;
  description: string;
}

const STATUS_CONFIG: Record<ChainOperationalStatus, StatusConfig> = {
  operational: {
    label: '정상 운영',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    Icon: CheckCircle2,
    description: '모든 시스템이 정상적으로 작동 중입니다.',
  },
  degraded: {
    label: '성능 저하',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    Icon: AlertTriangle,
    description: '일부 메트릭에서 이상이 감지되었습니다. 모니터링 중입니다.',
  },
  major_outage: {
    label: '주요 장애',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    Icon: XCircle,
    description: '심각한 이상이 감지되었습니다. 즉시 대응 중입니다.',
  },
  unknown: {
    label: '상태 확인 중',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/30',
    Icon: HelpCircle,
    description: '상태 정보를 수집 중입니다.',
  },
};

// ============================================================================
// Uptime bar component
// ============================================================================

function UptimeBar({ percentage }: { percentage: number }) {
  const color =
    percentage >= 99.9 ? 'bg-green-500' :
    percentage >= 99 ? 'bg-green-400' :
    percentage >= 95 ? 'bg-yellow-400' :
    'bg-red-400';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <span className={`text-sm font-mono font-semibold tabular-nums ${
        percentage >= 99 ? 'text-green-400' :
        percentage >= 95 ? 'text-yellow-400' :
        'text-red-400'
      }`}>
        {percentage.toFixed(2)}%
      </span>
    </div>
  );
}

// ============================================================================
// Incident row component
// ============================================================================

function IncidentRow({
  incident,
  nowMs,
}: {
  incident: PublicStatusResponse['incidents']['recent'][0];
  nowMs: number;
}) {
  const isActive = incident.status === 'active';
  const detectedAt = new Date(incident.detectedAt).toLocaleString('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const duration = incident.resolvedAt
    ? Math.round((new Date(incident.resolvedAt).getTime() - new Date(incident.detectedAt).getTime()) / 60000)
    : Math.round((nowMs - new Date(incident.detectedAt).getTime()) / 60000);

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-700/50 last:border-0">
      <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-red-400 animate-pulse' : 'bg-gray-500'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200">{incident.summary}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {incident.affectedArea} · {detectedAt}
          {incident.resolvedAt
            ? ` · ${duration}분 후 해결`
            : ` · ${duration}분 경과`}
        </p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
        isActive ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400'
      }`}>
        {isActive ? '진행 중' : '해결됨'}
      </span>
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function StatusPage() {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/public/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.chain || !json.status || !json.metrics) {
        throw new Error(typeof json.error === 'string' ? json.error : '응답 형식이 올바르지 않습니다');
      }
      setData(json as PublicStatusResponse);
      setError(null);
      setLastRefreshed(new Date());
      setCountdown(REFRESH_INTERVAL_MS / 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 정보를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const statusConfig = data ? STATUS_CONFIG[data.status] : STATUS_CONFIG.unknown;
  const { Icon } = statusConfig;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-gray-100">SentinAI</span>
            <span className="text-gray-500 text-sm">/ 체인 상태</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <RefreshCw className="w-3 h-3" />
            <span>{countdown}초 후 갱신</span>
            {lastRefreshed && (
              <span className="text-gray-600">
                · 마지막 갱신 {lastRefreshed.toLocaleTimeString('ko-KR')}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Loading state */}
        {loading && (
          <div className="text-center py-16 text-gray-500">
            <Activity className="w-8 h-8 mx-auto mb-3 animate-pulse" />
            <p>상태 정보를 불러오는 중...</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            <p className="font-medium">상태 정보를 불러올 수 없습니다</p>
            <p className="text-sm mt-1 text-red-400/70">{error}</p>
          </div>
        )}

        {/* Main content */}
        {!loading && data && (
          <>
            {/* Overall Status Card */}
            <div className={`rounded-xl border ${statusConfig.borderColor} ${statusConfig.bgColor} p-6`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                      {data.chain.name}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                      {data.chain.type}
                    </span>
                  </div>
                  <div className={`flex items-center gap-2 ${statusConfig.color}`}>
                    <Icon className="w-6 h-6" />
                    <span className="text-2xl font-semibold">{statusConfig.label}</span>
                  </div>
                  <p className="text-sm text-gray-400 mt-2">{statusConfig.description}</p>
                </div>
                {data.incidents.active > 0 && (
                  <div className="text-center flex-shrink-0">
                    <div className="text-2xl font-bold text-red-400">{data.incidents.active}</div>
                    <div className="text-xs text-gray-400">활성 이상</div>
                  </div>
                )}
              </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-4">
                <div className="flex items-center gap-1.5 text-gray-400 mb-2">
                  <Activity className="w-3.5 h-3.5" />
                  <span className="text-xs uppercase tracking-wider">L2 블록 높이</span>
                </div>
                <p className="text-xl font-mono font-semibold text-gray-100">
                  {data.metrics.blockHeight > 0
                    ? data.metrics.blockHeight.toLocaleString()
                    : '—'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(data.metrics.lastUpdatedAt).toLocaleTimeString('ko-KR')} 기준
                </p>
              </div>

              <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-4">
                <div className="flex items-center gap-1.5 text-gray-400 mb-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs uppercase tracking-wider">블록 간격</span>
                </div>
                <p className="text-xl font-mono font-semibold text-gray-100">
                  {data.metrics.blockIntervalSec.toFixed(1)}s
                </p>
                <p className="text-xs text-gray-500 mt-1">현재 블록 생산 속도</p>
              </div>

              <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-4">
                <div className="flex items-center gap-1.5 text-gray-400 mb-2">
                  <Zap className="w-3.5 h-3.5" />
                  <span className="text-xs uppercase tracking-wider">에이전트</span>
                </div>
                <p className={`text-xl font-semibold ${data.agent.running ? 'text-green-400' : 'text-gray-400'}`}>
                  {data.agent.running ? '활성' : '대기'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  총 {data.agent.totalCycles.toLocaleString()}회 사이클
                </p>
              </div>
            </div>

            {/* Uptime */}
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-5">
              <h2 className="text-sm font-medium text-gray-300 mb-4">가동률</h2>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                    <span>최근 24시간</span>
                    <span className="text-gray-500">{data.incidents.last24h}건 감지</span>
                  </div>
                  <UptimeBar percentage={data.uptime.h24} />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                    <span>최근 7일</span>
                  </div>
                  <UptimeBar percentage={data.uptime.d7} />
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-3">
                * 가동률은 이상 탐지 이벤트 발생 시간을 기준으로 계산됩니다.
              </p>
            </div>

            {/* Recent Incidents */}
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-gray-300">최근 이상 이벤트</h2>
                <span className="text-xs text-gray-500">최대 5건</span>
              </div>

              {data.incidents.recent.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-500/50" />
                  <p className="text-sm">최근 이상 이벤트가 없습니다.</p>
                </div>
              ) : (
                <div>
                  {data.incidents.recent.map(incident => (
                    <IncidentRow
                      key={incident.id}
                      incident={incident}
                      nowMs={lastRefreshed?.getTime() ?? Date.now()}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-gray-600 pb-4">
              <p>
                이 페이지는 SentinAI 자율 에이전트가 실시간으로 모니터링하는 데이터를 기반으로 합니다.
              </p>
              <p className="mt-1">
                생성 시각: {new Date(data.generatedAt).toLocaleString('ko-KR')}
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
