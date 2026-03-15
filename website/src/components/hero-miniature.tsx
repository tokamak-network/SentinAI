'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

type Phase = 'incident' | 'timeline' | 'rca' | 'impact';

const PHASE_DURATION = 3000;
const PHASES: Phase[] = ['incident', 'timeline', 'rca', 'impact'];

interface TimelineStep {
  label: string;
  time: string;
  completed: boolean;
}

export function HeroMiniature() {
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhaseIdx((i) => (i + 1) % PHASES.length);
    }, PHASE_DURATION);
    return () => clearInterval(timer);
  }, []);

  const activePhase = PHASES[phaseIdx];

  const timelineSteps: TimelineStep[] = [
    { label: 'Detected', time: '14:23:45 UTC', completed: true },
    { label: 'Analyzed', time: '+50ms', completed: true },
    { label: 'Planning', time: '+100ms', completed: true },
    { label: 'Acting', time: '+200ms', completed: phaseIdx >= 2 },
  ];

  return (
    <div className="rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-sm w-full" style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="text-primary">
          <Shield size={16} />
          <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em' }}>SentinAI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              display: 'inline-block',
              width: 8, height: 8, borderRadius: '50%',
              background: '#FF6B6B',
            }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em' }} className="text-muted-foreground">
            INCIDENT RESPONSE
          </span>
        </div>
      </div>

      {/* Incident Card */}
      <AnimatePresence mode="wait">
        {(activePhase === 'incident' || activePhase === 'timeline') && (
          <motion.div
            key="incident-card"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{
              padding: '12px 16px',
              background: '#FF6B6B15',
              border: '1px solid #FF6B6B30',
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={14} style={{ color: '#FF6B6B' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#FF6B6B' }}>
                Issue: Sequencer Latency Spike
              </span>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#666' }}>
              Block time: 2s → 8s | Z-score: 5.2σ
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Phase */}
      <AnimatePresence mode="wait">
        {activePhase === 'timeline' && (
          <motion.div
            key="timeline"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{ marginBottom: 12 }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0a0a0a', marginBottom: 8, fontFamily: 'monospace' }}>
              Response Timeline
            </div>
            {timelineSteps.map((step, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: idx < timelineSteps.length - 1 ? 6 : 0,
                  padding: '6px 0',
                  fontFamily: 'monospace',
                  fontSize: 9,
                }}
              >
                <div style={{
                  minWidth: 60,
                  padding: '4px 8px',
                  background: step.completed ? '#00FF8815' : '#f0f0f0',
                  border: `1px solid ${step.completed ? '#00FF8830' : '#ddd'}`,
                  borderRadius: 3,
                  textAlign: 'center',
                  color: step.completed ? '#00FF88' : '#666',
                  fontWeight: step.completed ? 700 : 400,
                }}>
                  {step.completed ? '✓' : '○'} {step.label}
                </div>
                <div style={{ color: '#666', flex: 1 }}>{step.time}</div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* RCA Phase */}
      <AnimatePresence mode="wait">
        {(activePhase === 'rca' || activePhase === 'impact') && (
          <motion.div
            key="rca"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{ marginBottom: 12 }}
          >
            <div style={{
              padding: '10px 12px',
              background: '#0055AA15',
              border: '1px solid #0055AA30',
              borderRadius: 4,
              marginBottom: 8,
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: '#0055AA', marginBottom: 4 }}>
                RCA Result:
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#666' }}>
                L1 RPC timeout. Proposer CPU at 95%.
              </div>
            </div>
            <div style={{
              padding: '10px 12px',
              background: '#0055AA15',
              border: '1px solid #0055AA30',
              borderRadius: 4,
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: '#0055AA', marginBottom: 4 }}>
                Remediation:
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#666' }}>
                Switch L1 RPC + scale proposer
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Impact Phase - Before/After */}
      <AnimatePresence mode="wait">
        {activePhase === 'impact' && (
          <motion.div
            key="impact"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{ marginBottom: 12 }}
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}>
              <div style={{
                padding: '10px',
                background: '#FF6B6B15',
                border: '1px solid #FF6B6B30',
                borderRadius: 4,
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: '#FF6B6B', marginBottom: 4 }}>
                  Without AI:
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#666', lineHeight: 1.4 }}>
                  On-call page<br/>
                  15 min investigation<br/>
                  <strong style={{ color: '#FF6B6B' }}>30 min downtime</strong>
                </div>
              </div>
              <div style={{
                padding: '10px',
                background: '#00FF8815',
                border: '1px solid #00FF8830',
                borderRadius: 4,
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: '#00FF88', marginBottom: 4 }}>
                  With SentinAI:
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#666', lineHeight: 1.4 }}>
                  Automatic detection<br/>
                  RCA + planning<br/>
                  <strong style={{ color: '#00FF88' }}>&lt;1 sec response</strong>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        paddingTop: 12,
        borderTop: '1px solid #e0e0e0',
      }}>
        <Clock size={12} className="text-muted-foreground" />
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#999' }}>
          {['Incident', 'Timeline', 'RCA', 'Impact'][phaseIdx]}
        </span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {PHASES.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: idx <= phaseIdx ? '#0055AA' : '#ddd',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
