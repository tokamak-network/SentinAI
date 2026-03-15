'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Clock, AlertTriangle, Zap, Gauge } from 'lucide-react';

interface TimelineStage {
  stage: number;
  label: string;
  timestamp: string;
  description: string;
  color: string;
}

interface DomainActivity {
  name: string;
  emoji: string;
  status: string;
  color: string;
}

const TIMELINE_DURATION = 5000;

export function HeroMiniature() {
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIdx((i) => (i + 1) % 4);
    }, TIMELINE_DURATION);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min((elapsed % TIMELINE_DURATION) / TIMELINE_DURATION, 1));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const stages: TimelineStage[] = [
    {
      stage: 1,
      label: 'OBSERVE',
      timestamp: '14:23:45 UTC',
      description: 'Metrics collected\n1.2k metrics/sec',
      color: '#3B82F6',
    },
    {
      stage: 2,
      label: 'DETECT',
      timestamp: '+50ms',
      description: 'Anomaly found\nZ-score: 5.2σ',
      color: '#EF4444',
    },
    {
      stage: 3,
      label: 'ANALYZE',
      timestamp: '+100ms',
      description: 'RCA complete\nL1 RPC timeout',
      color: '#FBBF24',
    },
    {
      stage: 4,
      label: 'ACT',
      timestamp: '+200ms',
      description: 'Auto-remediated\nRecovery: ✓',
      color: '#22C55E',
    },
  ];

  const domainActivities: DomainActivity[] = [
    {
      name: 'Scaling',
      emoji: '⚡',
      status: 'Forecasting +30% CPU',
      color: '#3B82F6',
    },
    {
      name: 'Security',
      emoji: '🛡️',
      status: 'Monitoring EOA access',
      color: '#EF4444',
    },
    {
      name: 'Reliability',
      emoji: '⚙️',
      status: 'Analyzing RCA results',
      color: '#FBBF24',
    },
    {
      name: 'Cost',
      emoji: '💰',
      status: '$2.4k saved by fast response',
      color: '#22C55E',
    },
  ];

  const isStageActive = (stage: number) => stage <= stageIdx + 1;
  const stageProgress = Math.max(0, progress - (stageIdx / 4)) * 4;

  return (
    <div className="rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-sm w-full" style={{ padding: '28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
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
              background: '#EF4444',
            }}
          />
          <span
            style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}
            className="text-muted-foreground"
          >
            INCIDENT RESPONSE TIMELINE
          </span>
        </div>
      </div>

      {/* Timeline Section */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Clock size={14} className="text-muted-foreground" />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 700,
              color: '#6B7280',
              letterSpacing: '0.05em',
            }}
          >
            REAL-TIME RESPONSE FLOW
          </span>
        </div>

        {/* Timeline stages */}
        <div style={{ position: 'relative' }}>
          {/* Timeline line background */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 0,
              right: 0,
              height: 2,
              background: '#E5E7EB',
              zIndex: 0,
            }}
          />

          {/* Timeline progress line */}
          <motion.div
            animate={{ scaleX: stageProgress }}
            transition={{ duration: 0.1 }}
            style={{
              position: 'absolute',
              top: 16,
              left: 0,
              height: 2,
              background: 'linear-gradient(to right, #3B82F6, #EF4444, #FBBF24, #22C55E)',
              zIndex: 1,
              transformOrigin: 'left',
              maxWidth: '100%',
            }}
          />

          {/* Stages */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, position: 'relative', zIndex: 2 }}>
            {stages.map((stage) => {
              const active = isStageActive(stage.stage);
              return (
                <motion.div
                  key={stage.stage}
                  animate={{
                    scale: active ? 1.05 : 0.95,
                    opacity: active ? 1 : 0.5,
                  }}
                  transition={{ duration: 0.3 }}
                  style={{
                    padding: '16px',
                    background: active ? '#F9FAFB' : '#F3F4F6',
                    border: `2px solid ${active ? stage.color : '#D1D5DB'}`,
                    borderRadius: 8,
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  {/* Stage circle indicator */}
                  <div
                    style={{
                      position: 'absolute',
                      top: -16,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 32,
                      height: 32,
                      background: active ? stage.color : '#D1D5DB',
                      border: '2px solid white',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {stage.stage}
                  </div>

                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      color: active ? stage.color : '#9CA3AF',
                      marginBottom: 6,
                      letterSpacing: '0.05em',
                    }}
                  >
                    {stage.label}
                  </div>

                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 9,
                      fontWeight: 600,
                      color: active ? '#1F2937' : '#9CA3AF',
                      marginBottom: 8,
                    }}
                  >
                    {stage.timestamp}
                  </div>

                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 9,
                      color: active ? '#4B5563' : '#9CA3AF',
                      lineHeight: 1.4,
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {stage.description}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#E5E7EB', marginBottom: 20 }} />

      {/* Parallel Domain Activity */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: 700,
            color: '#6B7280',
            letterSpacing: '0.05em',
            marginBottom: 12,
          }}
        >
          PARALLEL AGENT ACTIVITY
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {domainActivities.map((domain, idx) => (
            <motion.div
              key={idx}
              animate={{
                opacity: stageIdx >= 1 ? 1 : 0.5,
                y: stageIdx >= 1 ? 0 : 4,
              }}
              transition={{ duration: 0.3 }}
              style={{
                padding: '12px 14px',
                background: 'white',
                border: `1.5px solid ${domain.color}30`,
                borderLeft: `3px solid ${domain.color}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12 }}>{domain.emoji}</span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#1F2937',
                  }}
                >
                  {domain.name}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: '#6B7280',
                  lineHeight: 1.3,
                }}
              >
                {domain.status}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Impact Summary */}
      <div
        style={{
          padding: 14,
          background: '#F0FDF4',
          border: '1px solid #BBFBDC',
          borderRadius: 6,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 9,
              fontWeight: 700,
              color: '#7C2D12',
              marginBottom: 3,
            }}
          >
            Without SentinAI
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 700,
              color: '#DC2626',
              marginBottom: 2,
            }}
          >
            30 minutes
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 8,
              color: '#6B7280',
            }}
          >
            manual investigation
          </div>
        </div>
        <div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 9,
              fontWeight: 700,
              color: '#15803D',
              marginBottom: 3,
            }}
          >
            With SentinAI
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 700,
              color: '#22C55E',
              marginBottom: 2,
            }}
          >
            &lt;1 second
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 8,
              color: '#6B7280',
            }}
          >
            automated response
          </div>
        </div>
      </div>
    </div>
  );
}
