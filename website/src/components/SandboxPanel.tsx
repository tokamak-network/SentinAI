'use client';

import { useState } from 'react';
import { getServiceCatalog, formatTONPrice } from '@/lib/agent-marketplace';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EndpointOption {
  label: string;
  url: string;
  paid: boolean;
  price?: string;
  description: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEndpointOptions(): EndpointOption[] {
  const catalog = getServiceCatalog();
  const base = catalog.agent.baseUrl;

  const paid: EndpointOption[] = catalog.services.map((svc) => ({
    label: svc.displayName,
    url: `${base}/api/agent-marketplace/${svc.key.replace(/_/g, '-')}`,
    paid: true,
    price: formatTONPrice(svc.payment.amount),
    description: svc.description,
  }));

  const free: EndpointOption[] = [
    {
      label: 'Ops Snapshot',
      url: `${base}/api/agent-marketplace/ops-snapshot.json`,
      paid: false,
      description: 'Instance-specific metrics, scaling state, and anomaly data',
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
      description: 'Aggregated request stats and SLA metrics',
    },
  ];

  return [...free, ...paid];
}

function colorizeJson(json: string): React.ReactNode {
  // Very simple JSON syntax coloring using regex splits
  const lines = json.split('\n');
  return lines.map((line, i) => {
    const colored = line
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")\s*:/g, (m) =>
        `<KEY>${m}</KEY>`)
      .replace(/: ("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, (m) =>
        `<STR>${m}</STR>`)
      .replace(/: (true|false)/g, (m) => `<BOOL>${m}</BOOL>`)
      .replace(/: (null)/g, (m) => `<NULL>${m}</NULL>`)
      .replace(/: (-?\d+(\.\d+)?)/g, (m) => `<NUM>${m}</NUM>`);

    // We can't use dangerouslySetInnerHTML easily here, so just return plain text
    // with simple color spans parsed out
    return (
      <div key={i} style={{ minHeight: '1em' }}>
        {renderColoredLine(colored)}
      </div>
    );
  });
}

function renderColoredLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /<(KEY|STR|BOOL|NULL|NUM)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const colors: Record<string, string> = {
    KEY: '#7B2D8B',
    STR: '#007A00',
    BOOL: '#D40000',
    NULL: '#888',
    NUM: '#0050A0',
  };

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push(<span key={last}>{line.slice(last, m.index)}</span>);
    }
    parts.push(
      <span key={m.index} style={{ color: colors[m[1]] }}>
        {m[2]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    parts.push(<span key={last}>{line.slice(last)}</span>);
  }
  return parts;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SandboxPanel() {
  const endpoints = buildEndpointOptions();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const selected = endpoints[selectedIdx];

  const handleTry = async () => {
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
          onChange={(e) => {
            setSelectedIdx(Number(e.target.value));
            setStatusCode(null);
            setResponseBody(null);
            setFetchError(null);
          }}
          style={{
            width: '100%', fontFamily: FONT, fontSize: 10, color: '#0A0A0A',
            background: 'white', border: '1px solid #C0C0C0', padding: '8px 10px',
            outline: 'none', cursor: 'pointer', appearance: 'none',
          }}
        >
          {endpoints.map((ep, i) => (
            <option key={i} value={i}>
              {ep.paid ? '[PAID]' : '[FREE]'} {ep.label}{ep.price ? ` — ${ep.price}` : ''}
            </option>
          ))}
        </select>
        <div style={{
          fontFamily: FONT, fontSize: 9, color: '#707070', marginTop: 6,
        }}>
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
            borderLeft: '2px solid #E0E0E0', paddingLeft: 10,
          }}>
            <span style={{ color: '#D40000' }}>X-PAYMENT:</span> {'<EIP-712 authorization required>'}
          </div>
        )}
      </div>

      {/* TRY IT Button */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0' }}>
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
          {loading ? 'Fetching...' : 'Try It'}
        </button>
      </div>

      {/* Response */}
      {(statusCode !== null || fetchError !== null) && (
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

          {statusCode === 402 && (
            <div style={{
              fontFamily: FONT, fontSize: 9, color: '#707070',
              background: '#FFFBF0', border: '1px solid #E8A000',
              padding: '10px 14px', marginBottom: 12,
            }}>
              This endpoint requires payment. To access this data, use the{' '}
              <span style={{ color: '#D40000', fontWeight: 700 }}>BUY DATA</span>{' '}
              button in the Registry tab.
              <br />
              The response below shows the payment requirements your agent would receive.
            </div>
          )}

          {responseBody && (
            <pre style={{
              fontFamily: FONT, fontSize: 9, lineHeight: 1.7,
              color: '#0A0A0A', background: 'white',
              border: '1px solid #E0E0E0', padding: '12px 14px',
              overflow: 'auto', maxHeight: 360, margin: 0,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {colorizeJson(responseBody)}
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
        <div style={{ fontFamily: FONT, fontSize: 9, color: '#0A0A0A', lineHeight: 2 }}>
          {[
            ['1', 'GET /endpoint', '→', '402 + payment requirements (payTo, amount, token, network)'],
            ['2', 'Sign EIP-712 authorization', '→', 'X-PAYMENT header payload constructed'],
            ['3', 'GET /endpoint + X-PAYMENT', '→', '200 + data payload'],
          ].map(([step, action, arrow, result], i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '20px 220px 20px 1fr',
              gap: 8, alignItems: 'start',
              padding: '4px 0', borderBottom: '1px solid #F0F0F0',
            }}>
              <span style={{ color: '#D40000', fontWeight: 700 }}>{step}.</span>
              <span style={{ color: '#0050A0' }}>{action}</span>
              <span style={{ color: '#707070' }}>{arrow}</span>
              <span style={{ color: '#707070' }}>{result}</span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 12, fontFamily: FONT, fontSize: 8, color: '#707070',
          letterSpacing: '0.05em', lineHeight: 1.8,
        }}>
          Payment token: TON (Tokamak Network) on Sepolia (eip155:11155111).
          <br />
          Standard: <span style={{ color: '#0050A0' }}>HTTP 402 / x402 protocol</span> with EIP-712 authorization.
        </div>
      </div>
    </div>
  );
}
