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
    '#444';

  const borderColor =
    status === 'active' ? step.activeColor :
    status === 'done'   ? `${DONE_COLOR}50` :
    '#2a2a2a';

  const bg =
    status === 'active' ? `${step.activeColor}20` :
    status === 'done'   ? `${DONE_COLOR}15` :
    '#1a1a1a';

  const sub =
    status === 'active' ? '● active' :
    status === 'done'   ? '✓' :
    'waiting';

  return (
    <motion.div
      animate={status === 'active' ? { y: -2 } : { y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        flex: 1,
        border: `1.5px solid ${borderColor}`,
        background: bg,
        borderRadius: 4,
        padding: '7px 4px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {status === 'active' && (
        <span style={{
          position: 'absolute', top: 3, right: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: step.activeColor,
          display: 'inline-block',
          animation: 'pulse 1s infinite',
        }} />
      )}
      <div style={{ fontSize: 9, fontWeight: 700, color, fontFamily: 'monospace' }}>
        {step.label}
      </div>
      <div style={{ fontSize: 7, color: status === 'done' ? `${DONE_COLOR}80` : color, marginTop: 2, fontFamily: 'monospace' }}>
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
    <div className="rounded-xl border border-border bg-card/90 p-4 w-72 shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
          <Shield className="size-3" />
          SentinAI
        </div>
        <div className="flex items-center gap-1">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              display: 'inline-block',
              width: 6, height: 6, borderRadius: '50%',
              background: activeStep.activeColor,
            }}
          />
          <span className="text-[10px] text-muted-foreground ml-1">Live</span>
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
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
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 4 }}>
              <PipelineStage step={step} status={status} />
              {i < STEPS.length - 1 && (
                <div style={{ color: arrowColor, fontSize: 12, flexShrink: 0, fontFamily: 'monospace' }}>›</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status overlay */}
      <div className="min-h-[48px] relative">
        <AnimatePresence mode="wait">
          {activeKey === 'observe' && (
            <motion.div key="observe"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="text-[11px] text-muted-foreground text-center py-2"
            >
              Collecting metrics — block height, gas, tx pool
            </motion.div>
          )}
          {activeKey === 'detect' && (
            <motion.div key="detect"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2"
            >
              <AlertTriangle className="size-3 text-warning shrink-0" />
              <span className="text-[11px] text-warning">Anomaly detected — Z-score 4.2σ</span>
            </motion.div>
          )}
          {activeKey === 'analyze' && (
            <motion.div key="analyze"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2"
            >
              <Brain className="size-3 text-primary shrink-0" />
              <span className="text-[11px] text-primary">RCA: L1 RPC rate limit — planning recovery</span>
            </motion.div>
          )}
          {activeKey === 'act' && (
            <motion.div key="act"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-accent/10 border border-accent/30 rounded-lg px-3 py-2"
            >
              <CheckCircle2 className="size-3 text-accent shrink-0" />
              <span className="text-[11px] text-accent">Recovery complete — switched L1 RPC endpoint</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom stats */}
      <div className="flex justify-between mt-2 pt-2 border-t border-border text-[10px] font-mono">
        <span className="text-muted-foreground">Score <span className="text-primary">63</span></span>
        <span className="text-muted-foreground">TxPool <span className="text-warning">↑ HIGH</span></span>
        <span className="text-muted-foreground">2 vCPU</span>
      </div>
    </div>
  );
}
