'use client';

import { useState, useEffect } from 'react';
import type { ChatMessage, NLOpsIntent } from '@/types/nlops';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const SCENARIOS = [
  { id: 'spike',  label: 'SPIKE',  color: '#D40000' },
  { id: 'rising', label: 'RISING', color: '#CC6600' },
  { id: 'stable', label: 'STABLE', color: '#007A00' },
  { id: 'live',   label: 'LIVE',   color: '#0055AA' },
] as const;

interface PendingConfirmation {
  message: string;
  originalInput: string;
  intent: NLOpsIntent;
}

interface NLOpsBarProps {
  onSend: (message: string) => void;
  onRunRca: () => void;
  onRemediate: () => void;
  onInjectScenario?: (scenario: string) => void;
  isLoading?: boolean;
  chatMessages?: ChatMessage[];
  chatMessagesEndRef?: React.RefObject<HTMLDivElement | null>;
  pendingConfirmation?: PendingConfirmation | null;
  onConfirm?: () => void;
  onDismiss?: () => void;
}

function intentColor(intent: NLOpsIntent | undefined): string {
  if (!intent) return '#707070';
  if (intent.type === 'scale')   return '#0055AA';
  if (intent.type === 'rca')     return '#D40000';
  if (intent.type === 'analyze') return '#CC6600';
  if (intent.type === 'config')  return '#007A00';
  return '#707070';
}

export function NLOpsBar({
  onSend, onRunRca, onRemediate, onInjectScenario, isLoading,
  chatMessages = [], chatMessagesEndRef, pendingConfirmation, onConfirm, onDismiss,
}: NLOpsBarProps) {
  const [input, setInput] = useState('');
  const [showScenarios, setShowScenarios] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Auto-open panel when a new message arrives
  useEffect(() => {
    if (chatMessages.length > 0) setPanelOpen(true);
  }, [chatMessages.length]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
  };

  const handleScenario = (id: string) => {
    onInjectScenario?.(id);
    setShowScenarios(false);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Chat panel */}
      {panelOpen && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          height: 280,
          background: '#FFFFFF',
          borderTop: '2px solid #A0A0A0',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 10px', height: 24, flexShrink: 0,
            background: '#F7F7F7', borderBottom: '1px solid #D0D0D0',
          }}>
            <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: '#0A0A0A' }}>
              NLOPS CONSOLE
            </span>
            <button onClick={() => setPanelOpen(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: 10, color: '#707070', padding: '0 2px',
            }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chatMessages.length === 0 ? (
              <div style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', marginTop: 8 }}>
                No messages yet. Type a command below.
              </div>
            ) : chatMessages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: 8, alignItems: 'flex-start',
              }}>
                <span style={{
                  fontFamily: FONT, fontSize: 8, fontWeight: 700,
                  color: msg.role === 'user' ? '#0055AA' : '#707070',
                  flexShrink: 0, marginTop: 3,
                }}>
                  {msg.role === 'user' ? 'YOU' : 'AI'}
                </span>
                <div style={{
                  maxWidth: '82%',
                  padding: '5px 8px',
                  background: msg.role === 'user' ? '#EEF3FF' : '#F7F7F7',
                  borderLeft: msg.role === 'assistant' ? `2px solid ${intentColor(msg.intent)}` : 'none',
                  borderRight: msg.role === 'user' ? '2px solid #0055AA' : 'none',
                }}>
                  {msg.role === 'assistant' && msg.intent && msg.intent?.type !== 'unknown' && (
                    <div style={{
                      fontFamily: FONT, fontSize: 8, fontWeight: 700,
                      color: intentColor(msg.intent), letterSpacing: '0.1em', marginBottom: 3,
                    }}>
                      [{msg.intent.type.toUpperCase()}]
                    </div>
                  )}
                  <div style={{ fontFamily: FONT, fontSize: 10, color: '#0A0A0A', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {msg.content}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: '#A0A0A0', marginTop: 3 }}>
                    {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </div>
                </div>
              </div>
            ))}

            {/* Pending confirmation */}
            {pendingConfirmation && (
              <div style={{ padding: '6px 8px', background: '#FFF3E0', borderLeft: '2px solid #CC6600' }}>
                <div style={{ fontFamily: FONT, fontSize: 10, color: '#CC6600', fontWeight: 700, marginBottom: 4 }}>
                  CONFIRM REQUIRED
                </div>
                <div style={{ fontFamily: FONT, fontSize: 10, color: '#0A0A0A', marginBottom: 6 }}>
                  {pendingConfirmation.message}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={onConfirm} style={{
                    fontFamily: FONT, fontSize: 9, fontWeight: 700,
                    padding: '2px 8px', background: '#CC6600', color: 'white',
                    border: 'none', borderRadius: 2, cursor: 'pointer',
                  }}>CONFIRM</button>
                  <button onClick={onDismiss} style={{
                    fontFamily: FONT, fontSize: 9, fontWeight: 700,
                    padding: '2px 8px', background: 'transparent', color: '#707070',
                    border: '1px solid #D0D0D0', borderRadius: 2, cursor: 'pointer',
                  }}>CANCEL</button>
                </div>
              </div>
            )}

            {isLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070' }}>AI</span>
                <span style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0' }}>thinking...</span>
              </div>
            )}

            <div ref={chatMessagesEndRef} />
          </div>
        </div>
      )}

      {/* Input bar */}
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px', height: 36,
        borderTop: '2px solid #A0A0A0',
        background: '#F7F7F7',
      }}>
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

        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: '#D40000', flexShrink: 0 }}>&gt;&nbsp;</span>

        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !isLoading && handleSend()}
          onFocus={() => chatMessages.length > 0 && setPanelOpen(true)}
          placeholder="scale to 4 vCPU · run rca on op-batcher · show cost report · switch l1 rpc ..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: FONT, fontSize: 11, color: '#0A0A0A',
          }}
          data-testid="nlops-input"
        />

        {chatMessages.length > 0 && (
          <button onClick={() => setPanelOpen(v => !v)} style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700,
            padding: '1px 6px', borderRadius: 2,
            background: panelOpen ? '#0055AA' : 'transparent',
            color: panelOpen ? 'white' : '#0055AA',
            border: '1px solid #0055AA',
            cursor: 'pointer', flexShrink: 0,
          }}>
            {chatMessages.length} MSG
          </button>
        )}

        <span style={{ fontFamily: FONT, fontSize: 10, color: '#A0A0A0', flexShrink: 0 }}>⌘K</span>
        <QuickBtn label="RCA" onClick={onRunRca} color="#D40000" />
        <QuickBtn label="REM" onClick={onRemediate} color="#CC6600" />
        {onInjectScenario && (
          <QuickBtn label="SIM" onClick={() => setShowScenarios(v => !v)} color="#0055AA" active={showScenarios} />
        )}

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
