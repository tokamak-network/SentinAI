'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, AlertTriangle, Clock, Zap, Target } from 'lucide-react';

type Phase = 'incident' | 'timeline' | 'rca' | 'impact';

const PHASE_DURATION = 4000;
const PHASES: Phase[] = ['incident', 'timeline', 'rca', 'impact'];

interface TimelineStep {
  label: string;
  time: string;
  completed: boolean;
}

const PhaseCard = ({
  phase,
  isActive,
  children,
}: {
  phase: Phase;
  isActive: boolean;
  children: React.ReactNode;
}) => {
  const phaseConfig = {
    incident: { icon: AlertTriangle, label: '① INCIDENT', color: '#DC2626', bgColor: '#FEE2E2', borderColor: '#FECACA' },
    timeline: { icon: Clock, label: '② TIMELINE', color: '#2563EB', bgColor: '#DBEAFE', borderColor: '#BFDBFE' },
    rca: { icon: Zap, label: '③ RCA', color: '#7C3AED', bgColor: '#EDE9FE', borderColor: '#DDD6FE' },
    impact: { icon: Target, label: '④ IMPACT', color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBFBDC' },
  };

  const config = phaseConfig[phase];
  const Icon = config.icon;

  return (
    <motion.div
      animate={{
        scale: isActive ? 1.02 : 0.98,
        opacity: isActive ? 1 : 0.6,
        borderWidth: isActive ? 2 : 1,
      }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '16px',
        background: config.bgColor,
        border: `${isActive ? 2 : 1}px solid ${isActive ? config.color : config.borderColor}`,
        borderRadius: 8,
        flex: 1,
        minHeight: 120,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={16} style={{ color: config.color, flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: 700,
            color: config.color,
            letterSpacing: '0.05em',
          }}
        >
          {config.label}
        </span>
        {isActive && (
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: config.color,
              marginLeft: 'auto',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {children}
      </div>
    </motion.div>
  );
};

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
    <div
      className="rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-sm w-full"
      style={{ padding: '24px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="text-primary">
          <Shield size={18} />
          <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em' }}>
            SentinAI
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#DC2626',
            }}
          />
          <span
            style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}
            className="text-muted-foreground"
          >
            LIVE INCIDENT RESPONSE
          </span>
        </div>
      </div>

      {/* 4-Phase Pipeline Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {/* PHASE 1: INCIDENT */}
        <PhaseCard phase="incident" isActive={activePhase === 'incident'}>
          <div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: 700,
                color: '#1F2937',
                marginBottom: 8,
              }}
            >
              Sequencer Latency Spike
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#4B5563',
                lineHeight: 1.5,
              }}
            >
              Block time: 2s → 8s
              <br />
              Z-score: 5.2σ
            </div>
          </div>
        </PhaseCard>

        {/* PHASE 2: TIMELINE */}
        <PhaseCard phase="timeline" isActive={activePhase === 'timeline'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {timelineSteps.slice(0, 2).map((step, idx) => (
              <div
                key={idx}
                style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: step.completed ? '#1F2937' : '#9CA3AF',
                  fontWeight: step.completed ? 600 : 400,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{step.completed ? '✓' : '○'} {step.label}</span>
                <span style={{ fontSize: 9 }}>{step.time}</span>
              </div>
            ))}
            <div
              style={{
                fontSize: 9,
                color: '#6B7280',
                fontStyle: 'italic',
                marginTop: 4,
              }}
            >
              +150ms total
            </div>
          </div>
        </PhaseCard>

        {/* PHASE 3: RCA */}
        <PhaseCard phase="rca" isActive={activePhase === 'rca'}>
          <div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: 700,
                color: '#1F2937',
                marginBottom: 6,
              }}
            >
              Root Cause
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#4B5563',
                lineHeight: 1.5,
                marginBottom: 8,
              }}
            >
              L1 RPC timeout
              <br />
              Proposer CPU: 95%
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 9,
                fontWeight: 600,
                color: '#7C3AED',
              }}
            >
              Action: Switch RPC + Scale
            </div>
          </div>
        </PhaseCard>

        {/* PHASE 4: IMPACT */}
        <PhaseCard phase="impact" isActive={activePhase === 'impact'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#DC2626',
                  marginBottom: 3,
                }}
              >
                Without AI
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: '#4B5563',
                }}
              >
                30 min downtime
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#16A34A',
                  marginBottom: 3,
                }}
              >
                With SentinAI
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: '#4B5563',
                }}
              >
                &lt;1 sec response
              </div>
            </div>
          </div>
        </PhaseCard>
      </div>

      {/* Progress Indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 16,
          borderTop: '1px solid #E5E7EB',
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 10,
            fontWeight: 600,
            color: '#6B7280',
            letterSpacing: '0.05em',
          }}
        >
          INCIDENT RESPONSE FLOW
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {PHASES.map((phase, idx) => (
            <motion.div
              key={idx}
              animate={{
                width: idx <= phaseIdx ? 24 : 12,
                opacity: idx <= phaseIdx ? 1 : 0.3,
              }}
              transition={{ duration: 0.3 }}
              style={{
                height: 6,
                borderRadius: 3,
                background:
                  phase === 'incident'
                    ? '#DC2626'
                    : phase === 'timeline'
                      ? '#2563EB'
                      : phase === 'rca'
                        ? '#7C3AED'
                        : '#16A34A',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
