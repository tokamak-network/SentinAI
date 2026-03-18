'use client';

import { useState } from 'react';
import { getServiceCatalog, formatTONPrice } from '@/lib/agent-marketplace';
import PurchaseModal from '@/components/PurchaseModal';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EndpointOption {
  label: string;
  url: string;
  paid: boolean;
  price?: string;
  description: string;
  serviceKey?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEndpointOptions(): EndpointOption[] {
  const catalog = getServiceCatalog();
  const base = catalog.agent.baseUrl;

  const free: EndpointOption[] = [
    {
      label: 'Ops Snapshot',
      url: `${base}/api/agent-marketplace/ops-snapshot.json`,
      paid: false,
      description: 'Instance metrics, scaling state, and anomaly data',
    },
    {
      label: 'Operator Info',
      url: `${base}/api/agent-marketplace/ops/operator-info`,
      paid: false,
      description: 'Operator wallet, registration status, and agent identity',
    },
    {
      label: 'Ops Summary',
      url: `${base}/api/agent-marketplace/ops/summary`,
      paid: false,
      description: 'Aggregated request stats and service breakdown',
    },
  ];

  const paid: EndpointOption[] = catalog.services.map((svc) => ({
    label: svc.displayName,
    url: `${base}/api/agent-marketplace/${svc.key.replace(/_/g, '-')}`,
    paid: true,
    price: formatTONPrice(svc.payment.amount),
    description: svc.description,
    serviceKey: svc.key,
  }));

  return [...free, ...paid];
}

function renderColoredJson(json: string): React.ReactNode {
  const lines = json.split('\n');
  const colors: Record<string, string> = {
    KEY: '#7B2D8B',
    STR: '#007A00',
    BOOL: '#D40000',
    NULL: '#888',
    NUM: '#0050A0',
  };

  return lines.map((line, i) => {
    const re = /<(KEY|STR|BOOL|NULL|NUM)>(.*?)<\/\1>/g;
    const tagged = line
      .replace(/("(?:[^"\\]|\\.)*")\s*:/g, (m) => `<KEY>${m}</KEY>`)
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, (m) => `<STR>${m}</STR>`)
      .replace(/:\s*(true|false)/g, (m) => `<BOOL>${m}</BOOL>`)
      .replace(/:\s*(null)/g, (m) => `<NULL>${m}</NULL>`)
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, (m) => `<NUM>${m}</NUM>`);

    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re2 = new RegExp(re.source, 'g');
    while ((m = re2.exec(tagged)) !== null) {
      if (m.index > last) parts.push(<span key={last}>{tagged.slice(last, m.index)}</span>);
      parts.push(<span key={m.index} style={{ color: colors[m[1]] }}>{m[2]}</span>);
      last = m.index + m[0].length;
    }
    if (last < tagged.length) parts.push(<span key={last}>{tagged.slice(last)}</span>);

    return <div key={i} style={{ minHeight: '1.2em' }}>{parts}</div>;
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SandboxPanel() {
  const endpoints = buildEndpointOptions();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  const selected = endpoints[selectedIdx];

  const handleSelect = (idx: number) => {
    setSelectedIdx(idx);
    setStatusCode(null);
    setResponseBody(null);
    setFetchError(null);
  };

  const handleTry = async () => {
    if (selected.paid) {
      // Paid endpoints → open the purchase modal (real on-chain tx flow)
      setPurchaseOpen(true);
      return;
    }

    // Free endpoints → fetch and display response
    setLoading(true);
    setResponseBody(null);
    setFetchError(null);
    setStatusCode(null);

    try {
      const res = await fetch(selected.url);
      setStatusCode(res.status);
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        setResponseBody(JSON.stringify(parsed, null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const statusColor =
    statusCode === null ? '#707070'
      : statusCode === 200 ? '#007A00'
        : statusCode === 402 ? '#E8A000'
          : '#D40000';

  const statusLabel =
    statusCode === null ? null
      : statusCode === 200 ? `${statusCode} OK`
        : statusCode === 402 ? `${statusCode} Payment Required`
          : `${statusCode} Error`;

  return (
    <>
      <div style={{ background: '#F7F7F7', border: '1px solid #D0D0D0' }}>

        {/* Header */}
        <div style={{
          background: '#0A0A0A', color: 'white', padding: '3px 14px',
          fontFamily: FONT, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.15em', textTransform: 'uppercase',
        }}>
          x402 API Explorer
        </div>

        {/* Endpoint Selector */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0' }}>
          <div style={{
            fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
            letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Select Endpoint
          </div>
          <select
            value={selectedIdx}
            onChange={(e) => handleSelect(Number(e.target.value))}
            style={{
              width: '100%', fontFamily: FONT, fontSize: 10, color: '#0A0A0A',
              background: 'white', border: '1px solid #C0C0C0', padding: '8px 10px',
              outline: 'none', cursor: 'pointer', appearance: 'none',
            }}
          >
            <optgroup label="── Free Endpoints ──">
              {endpoints.filter((e) => !e.paid).map((ep, i) => (
                <option key={i} value={i}>
                  [FREE] {ep.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="── Paid Endpoints (x402) ──">
              {endpoints.filter((e) => e.paid).map((ep, i) => {
                const realIdx = endpoints.indexOf(ep);
                return (
                  <option key={realIdx} value={realIdx}>
                    [PAID] {ep.label} — {ep.price}
                  </option>
                );
              })}
            </optgroup>
          </select>
          <div style={{ fontFamily: FONT, fontSize: 9, color: '#707070', marginTop: 6 }}>
            {selected.description}
          </div>
        </div>

        {/* Request Preview */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0' }}>
          <div style={{
            fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
            letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Request
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{
              fontFamily: FONT, fontSize: 9, fontWeight: 700, color: '#0050A0',
              background: '#E8F0FF', padding: '2px 6px', borderRadius: 2, flexShrink: 0,
            }}>
              GET
            </span>
            <span style={{
              fontFamily: FONT, fontSize: 9, color: '#0A0A0A',
              wordBreak: 'break-all', lineHeight: 1.6,
            }}>
              {selected.url}
            </span>
          </div>
          {selected.paid && (
            <div style={{
              marginTop: 8, fontFamily: FONT, fontSize: 9, color: '#707070',
              borderLeft: '2px solid #E8A000', paddingLeft: 10,
            }}>
              <span style={{ color: '#D40000' }}>X-PAYMENT</span>:{' '}
              {'<EIP-712 signed authorization — required>'}
              <br />
              <span style={{ color: '#E8A000' }}>Price: {selected.price} TON</span>
            </div>
          )}
        </div>

        {/* TRY IT Button */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={handleTry}
            disabled={loading}
            style={{
              fontFamily: FONT, fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              background: loading ? '#707070' : '#D40000', color: 'white',
              border: 'none', padding: '10px 24px', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Fetching...' : selected.paid ? 'Try It — Pay with TON' : 'Try It'}
          </button>
          {selected.paid && (
            <span style={{ fontFamily: FONT, fontSize: 8, color: '#707070' }}>
              Opens MetaMask · EIP-712 sign · on-chain settlement
            </span>
          )}
        </div>

        {/* Free endpoint response */}
        {(statusCode !== null || fetchError !== null) && !selected.paid && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
                letterSpacing: '0.15em', textTransform: 'uppercase',
              }}>
                Response
              </div>
              {statusLabel && (
                <span style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700,
                  color: 'white', background: statusColor,
                  padding: '2px 8px', borderRadius: 2,
                }}>
                  {statusLabel}
                </span>
              )}
              {fetchError && (
                <span style={{ fontFamily: FONT, fontSize: 9, color: '#D40000' }}>
                  {fetchError}
                </span>
              )}
            </div>
            {responseBody && (
              <pre style={{
                fontFamily: FONT, fontSize: 9, lineHeight: 1.7,
                color: '#0A0A0A', background: 'white',
                border: '1px solid #E0E0E0', padding: '12px 14px',
                overflow: 'auto', maxHeight: 360, margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {renderColoredJson(responseBody)}
              </pre>
            )}
          </div>
        )}

        {/* x402 Protocol Guide */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{
            background: '#0A0A0A', color: 'white', padding: '3px 14px',
            fontFamily: FONT, fontSize: 9, fontWeight: 700,
            letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 12,
          }}>
            x402 Protocol Flow
          </div>
          {[
            ['1', 'GET /endpoint', '→', '402 Payment Required + requirements (payTo, amount, token, network)'],
            ['2', 'Connect MetaMask', '→', 'Check TON balance & approve allowance'],
            ['3', 'Sign EIP-712 auth', '→', 'X-PAYMENT header constructed in-browser'],
            ['4', 'GET /endpoint + X-PAYMENT', '→', '200 OK + data payload + on-chain settlement'],
          ].map(([step, action, arrow, result], i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '20px 210px 20px 1fr',
              gap: 8, alignItems: 'start',
              fontFamily: FONT, fontSize: 9,
              padding: '5px 0', borderBottom: '1px solid #F0F0F0',
            }}>
              <span style={{ color: '#D40000', fontWeight: 700 }}>{step}.</span>
              <span style={{ color: '#0050A0' }}>{action}</span>
              <span style={{ color: '#707070' }}>{arrow}</span>
              <span style={{ color: '#707070' }}>{result}</span>
            </div>
          ))}
          <div style={{
            marginTop: 12, fontFamily: FONT, fontSize: 8, color: '#707070',
            letterSpacing: '0.05em', lineHeight: 1.8,
          }}>
            Token: <span style={{ color: '#0050A0' }}>TON (Tokamak Network)</span> on Sepolia (eip155:11155111).
            <br />
            Standard: HTTP 402 / x402 protocol · EIP-712 typed authorization.
          </div>
        </div>
      </div>

      {/* Purchase Modal — opens on paid endpoint TRY IT */}
      {purchaseOpen && selected.paid && (
        <PurchaseModal
          agentId={selected.serviceKey ?? selected.label}
          agentName={selected.label}
          endpoint={selected.url}
          onClose={() => setPurchaseOpen(false)}
        />
      )}
    </>
  );
}
