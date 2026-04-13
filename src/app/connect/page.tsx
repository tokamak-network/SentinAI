'use client';

import React, { useEffect, useMemo, useState } from 'react';

type NodeType = 'ethereum-el' | 'opstack-l2' | 'arbitrum-nitro';

type AIProviderStatus = {
  provider: 'qwen' | 'anthropic' | 'openai' | 'gemini' | null;
  hasGateway: boolean;
  anthropicAuthType: 'apikey' | 'oauth' | null;
  configured: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  qwen: 'Qwen',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

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
  const [aiStatus, setAiStatus] = useState<AIProviderStatus | null>(null);

  const current = useMemo(() => NODE_TYPES.find((n) => n.type === nodeType)!, [nodeType]);

  useEffect(() => {
    const target = result?.data?.dashboardUrl;
    if (!target) return;
    const t = window.setTimeout(() => window.location.assign(target), 800);
    return () => window.clearTimeout(t);
  }, [result?.data?.dashboardUrl]);

  useEffect(() => {
    fetch('/api/v2/config/ai-provider')
      .then((r) => r.json())
      .then((data: AIProviderStatus) => setAiStatus(data))
      .catch(() => setAiStatus(null));
  }, []);

  async function onTest() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const connectionConfig: Record<string, unknown> = {
        rpcUrl: url.trim(),
        ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
      };

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

        {/* AI Provider Status */}
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">AI Provider</h2>
            {aiStatus === null && (
              <span className="text-xs text-slate-500">Loading...</span>
            )}
            {aiStatus !== null && (
              aiStatus.configured ? (
                <span className="rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs text-emerald-300">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-rose-900/50 px-2.5 py-0.5 text-xs text-rose-300">
                  Not configured
                </span>
              )
            )}
          </div>

          {aiStatus?.configured && aiStatus.provider && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Provider</span>
                <span className="font-mono text-slate-200">{PROVIDER_LABELS[aiStatus.provider] ?? aiStatus.provider}</span>
              </div>
              {aiStatus.hasGateway && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">via</span>
                  <span className="font-mono text-slate-200">AI Gateway</span>
                </div>
              )}
              {aiStatus.provider === 'anthropic' && aiStatus.anthropicAuthType && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Auth</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-mono ${aiStatus.anthropicAuthType === 'oauth' ? 'bg-violet-900/50 text-violet-300' : 'bg-slate-700 text-slate-300'}`}>
                    {aiStatus.anthropicAuthType === 'oauth' ? 'OAuth (subscription)' : 'API key'}
                  </span>
                </div>
              )}
            </div>
          )}

          {aiStatus !== null && !aiStatus.configured && (
            <div className="mt-3 space-y-1.5 text-xs text-slate-400">
              <p>Set one of the following environment variables to enable AI:</p>
              <div className="mt-2 space-y-1 rounded-lg bg-slate-800/60 p-3 font-mono">
                <div><span className="text-amber-300">QWEN_API_KEY</span>=... <span className="text-slate-500"># Recommended — fastest, $30/mo</span></div>
                <div><span className="text-amber-300">ANTHROPIC_API_KEY</span>=sk-ant-... <span className="text-slate-500"># Claude, pay-per-token</span></div>
                <div><span className="text-amber-300">ANTHROPIC_OAUTH_TOKEN</span>=... <span className="text-slate-500"># Claude, subscription</span></div>
                <div><span className="text-amber-300">OPENAI_API_KEY</span>=sk-... <span className="text-slate-500"># GPT</span></div>
                <div><span className="text-amber-300">GEMINI_API_KEY</span>=AIza... <span className="text-slate-500"># Gemini</span></div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
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
