'use client';

import { useState } from 'react';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const SCENARIOS = [
  { id: 'spike',  label: 'SPIKE',  color: '#D40000' },
  { id: 'rising', label: 'RISING', color: '#CC6600' },
  { id: 'stable', label: 'STABLE', color: '#007A00' },
  { id: 'live',   label: 'LIVE',   color: '#0055AA' },
] as const;

interface NLOpsBarProps {
  onSend: (message: string) => void;
  onRunRca: () => void;
  onRemediate: () => void;
  onInjectScenario?: (scenario: string) => void;
  isLoading?: boolean;
}

export function NLOpsBar({ onSend, onRunRca, onRemediate, onInjectScenario, isLoading }: NLOpsBarProps) {
  const [input, setInput] = useState('');
  const [showScenarios, setShowScenarios] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  const handleScenario = (id: string) => {
    onInjectScenario?.(id);
    setShowScenarios(false);
  };

  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 10px',
      height: 36, flexShrink: 0,
      borderTop: '2px solid #A0A0A0',
      background: '#F7F7F7',
    }}>
      {/* Scenario picker */}
      {showScenarios && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 10, marginBottom: 4,
          display: 'flex', gap: 2, padding: 4,
          background: '#FFFFFF', border: '1px solid #A0A0A0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          {SCENARIOS.map(s => (
            <button key={s.id} onClick={() => handleScenario(s.id)} style={{
              fontFamily: FONT, fontSize: 10, fontWeight: 700,
              padding: '2px 8px', background: 'transparent', border: `1px solid ${s.color}`,
              color: s.color, cursor: 'pointer', borderRadius: 2,
            }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Prompt prefix */}
      <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: '#D40000', flexShrink: 0 }}>&gt;&nbsp;</span>

      {/* Input */}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !isLoading && handleSend()}
        placeholder="scale to 4 vCPU · run rca on op-batcher · show cost report · switch l1 rpc ..."
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontFamily: FONT, fontSize: 11, color: '#0A0A0A',
        }}
        data-testid="nlops-input"
      />

      {/* Quick actions */}
      <span style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', flexShrink: 0 }}>
        ⌘K
      </span>
      <QuickBtn label="RCA" onClick={onRunRca} color="#D40000" />
      <QuickBtn label="REM" onClick={onRemediate} color="#CC6600" />
      {onInjectScenario && (
        <QuickBtn label="SIM" onClick={() => setShowScenarios(v => !v)} color="#0055AA" active={showScenarios} />
      )}

      {/* Submit button */}
      <button
        onClick={handleSend}
        disabled={isLoading || !input.trim()}
        data-testid="nlops-send"
        style={{
          fontFamily: FONT, fontSize: 10, fontWeight: 700,
          padding: '3px 10px', borderRadius: 2,
          background: input.trim() && !isLoading ? '#0055AA' : '#EFEFEF',
          color: input.trim() && !isLoading ? 'white' : '#A0A0A0',
          border: 'none', cursor: input.trim() && !isLoading ? 'pointer' : 'default',
          letterSpacing: '0.05em', flexShrink: 0,
        }}
      >
        EXEC
      </button>
    </div>
  );
}

function QuickBtn({ label, onClick, color, active }: { label: string; onClick: () => void; color: string; active?: boolean }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: FONT, fontSize: 9, fontWeight: 700,
      padding: '2px 6px', borderRadius: 2,
      background: active ? color : 'transparent',
      color: active ? 'white' : color,
      border: `1px solid ${color}`,
      cursor: 'pointer', flexShrink: 0,
      letterSpacing: '0.05em',
    }}>
      {label}
    </button>
  );
}
