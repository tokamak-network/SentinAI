'use client';

import React, { useEffect, useMemo, useState } from 'react';

type NodeType = 'ethereum-el' | 'opstack-l2' | 'arbitrum-nitro' | 'ethereum-cl';

type OnboardingCompleteResponse = {
  data?: {
    instanceId: string;
    dashboardUrl?: string;
    detectedClient?: unknown;
    mappedCapabilities?: unknown;
    warnings?: string[];
  };
  error?: string;
};

const NODE_TYPES: Array<{ type: NodeType; label: string; placeholder: string; hasAuth: boolean }> = [
  { type: 'ethereum-el', label: 'Ethereum EL', placeholder: 'http://localhost:8545', hasAuth: true },
  { type: 'opstack-l2', label: 'OP Stack L2', placeholder: 'https://...', hasAuth: true },
  { type: 'arbitrum-nitro', label: 'Arbitrum Nitro', placeholder: 'https://...', hasAuth: true },
  { type: 'ethereum-cl', label: 'Ethereum CL (Beacon API)', placeholder: 'http://localhost:5052', hasAuth: false },
];

function pretty(obj: unknown): string {
  return JSON.stringify(obj ?? {}, null, 2);
}

export default function ConnectPage() {
  const [nodeType, setNodeType] = useState<NodeType>('ethereum-el');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OnboardingCompleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(() => NODE_TYPES.find((n) => n.type === nodeType)!, [nodeType]);

  useEffect(() => {
    const target = result?.data?.dashboardUrl;
    if (!target) return;
    const t = window.setTimeout(() => window.location.assign(target), 800);
    return () => window.clearTimeout(t);
  }, [result?.data?.dashboardUrl]);

  async function onTest() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const connectionConfig: Record<string, unknown> =
        nodeType === 'ethereum-cl'
          ? { rpcUrl: url.trim(), beaconApiUrl: url.trim() }
          : { rpcUrl: url.trim(), ...(authToken.trim() ? { authToken: authToken.trim() } : {}) };

      const apiKey = process.env.NEXT_PUBLIC_SENTINAI_API_KEY || '';

      const res = await fetch('/api/v2/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey.trim() ? { 'x-api-key': apiKey.trim() } : {}),
        },
        body: JSON.stringify({ nodeType, connectionConfig, operatorId: 'default', label: 'Connect' }),
      });

      const json = (await res.json()) as OnboardingCompleteResponse;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Connect</h1>
        <p className="mt-2 text-slate-400">Test connection, auto-detect client, then redirect to dashboard.</p>

        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <label htmlFor="node-type" className="block text-sm text-slate-300">Node type</label>
          <select
            id="node-type"
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as NodeType)}
          >
            {NODE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>

          <label htmlFor="node-url" className="mt-4 block text-sm text-slate-300">URL</label>
          <input
            id="node-url"
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={current.placeholder}
          />

          {current.hasAuth && (
            <>
              <label htmlFor="auth-token" className="mt-4 block text-sm text-slate-300">Auth token (optional)</label>
              <input
                id="auth-token"
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Bearer ..."
              />
            </>
          )}

          <button
            className="mt-6 inline-flex items-center rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={onTest}
            disabled={loading || !url.trim()}
          >
            {loading ? 'Testing...' : 'Test + Onboard'}
          </button>

          {error && <div className="mt-4 text-sm text-rose-300">{error}</div>}
        </div>

        {result?.data && (
          <div className="mt-6 grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-sm text-emerald-300">Connected: {result.data.instanceId}</div>
              {result.data.warnings?.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-amber-200">
                  {result.data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">detectedClient</div>
              <pre className="mt-2 overflow-x-auto text-xs text-slate-200">{pretty(result.data.detectedClient)}</pre>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">mappedCapabilities</div>
              <pre className="mt-2 overflow-x-auto text-xs text-slate-200">{pretty(result.data.mappedCapabilities)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
