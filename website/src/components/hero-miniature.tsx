'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle2, Brain } from 'lucide-react';

type Stage = 'observe' | 'detect' | 'analyze' | 'act';

const STAGE_DURATION = 1500;
const STAGES: Stage[] = ['observe', 'detect', 'analyze', 'act'];

interface PipelineStep {
  key: Stage;
  label: string;
  activeColor: string;
}

const STEPS: PipelineStep[] = [
  { key: 'observe',  label: 'OBSERVE',  activeColor: '#3B82F6' },
  { key: 'detect',   label: 'DETECT',   activeColor: '#F59E0B' },
  { key: 'analyze',  label: 'ANALYZE',  activeColor: '#22c55e' },
  { key: 'act',      label: 'ACT',      activeColor: '#8B5CF6' },
];

const DONE_COLOR = '#10FFAA';

function PipelineStage({ step, status }: {
  step: PipelineStep;
  status: 'done' | 'active' | 'waiting';
}) {
  const color =
    status === 'active' ? step.activeColor :
    status === 'done'   ? DONE_COLOR :
    '#555';

  const borderColor =
    status === 'active' ? step.activeColor :
    status === 'done'   ? `${DONE_COLOR}60` :
    '#2a2a2a';

  const bg =
    status === 'active' ? `${step.activeColor}25` :
    status === 'done'   ? `${DONE_COLOR}18` :
    '#1a1a1a';

  const sub =
    status === 'active' ? '● active' :
    status === 'done'   ? '✓ done' :
    'waiting';

  return (
    <motion.div
      animate={status === 'active' ? { y: -3 } : { y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        flex: 1,
        border: `1.5px solid ${borderColor}`,
        background: bg,
        borderRadius: 6,
        padding: '12px 6px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {status === 'active' && (
        <span style={{
          position: 'absolute', top: 5, right: 5,
          width: 7, height: 7, borderRadius: '50%',
          background: step.activeColor,
          display: 'inline-block',
          animation: 'pulse 1s infinite',
        }} />
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
        {step.label}
      </div>
      <div style={{ fontSize: 10, color: status === 'done' ? `${DONE_COLOR}90` : color, marginTop: 4, fontFamily: 'monospace' }}>
        {sub}
      </div>
    </motion.div>
  );
}

export function HeroMiniature() {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIdx((i) => (i + 1) % STAGES.length);
    }, STAGE_DURATION);
    return () => clearInterval(timer);
  }, []);

  const activeKey = STAGES[stageIdx];
  const activeStep = STEPS[stageIdx];

  return (
    <div className="rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-sm w-full" style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
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
              background: activeStep.activeColor,
            }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em' }} className="text-muted-foreground">
            LIVE MONITORING
          </span>
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
        {STEPS.map((step, i) => {
          const status =
            i < stageIdx ? 'done' :
            i === stageIdx ? 'active' :
            'waiting';
          const arrowColor =
            i < stageIdx ? `${DONE_COLOR}80` :
            i === stageIdx ? step.activeColor :
            '#333';
          return (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 6 }}>
              <PipelineStage step={step} status={status} />
              {i < STEPS.length - 1 && (
                <div style={{ color: arrowColor, fontSize: 16, flexShrink: 0, fontFamily: 'monospace' }}>›</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status overlay */}
      <div style={{ minHeight: 64, position: 'relative' }}>
        <AnimatePresence mode="wait">
          {activeKey === 'observe' && (
            <motion.div key="observe"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              style={{ textAlign: 'center', padding: '12px 0', fontFamily: 'monospace', fontSize: 13 }}
              className="text-muted-foreground"
            >
              Collecting metrics — block height, gas, tx pool
            </motion.div>
          )}
          {activeKey === 'detect' && (
            <motion.div key="detect"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg"
              style={{ padding: '12px 16px' }}
            >
              <AlertTriangle size={15} className="text-warning shrink-0" />
              <span style={{ fontFamily: 'monospace', fontSize: 13 }} className="text-warning">
                Anomaly detected — Z-score 4.2σ
              </span>
            </motion.div>
          )}
          {activeKey === 'analyze' && (
            <motion.div key="analyze"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg"
              style={{ padding: '12px 16px' }}
            >
              <Brain size={15} className="text-primary shrink-0" />
              <span style={{ fontFamily: 'monospace', fontSize: 13 }} className="text-primary">
                RCA: L1 RPC rate limit — planning recovery
              </span>
            </motion.div>
          )}
          {activeKey === 'act' && (
            <motion.div key="act"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-lg"
              style={{ padding: '12px 16px' }}
            >
              <CheckCircle2 size={15} className="text-accent shrink-0" />
              <span style={{ fontFamily: 'monospace', fontSize: 13 }} className="text-accent">
                Recovery complete — switched L1 RPC endpoint
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom stats */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 16, paddingTop: 16, fontFamily: 'monospace', fontSize: 12,
      }} className="border-t border-border">
        <span className="text-muted-foreground">Score <span className="text-primary font-bold">63</span></span>
        <span className="text-muted-foreground">TxPool <span className="text-warning font-bold">↑ HIGH</span></span>
        <span className="text-muted-foreground font-bold">2 vCPU</span>
      </div>
    </div>
  );
}
