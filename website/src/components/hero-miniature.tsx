'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle2, Brain } from 'lucide-react';

type Stage = 'normal' | 'anomaly' | 'rca' | 'resolved';

const STAGE_DURATION = 1500;
const STAGES: Stage[] = ['normal', 'anomaly', 'rca', 'resolved'];

const NODE_COLORS: Record<Stage, Record<string, string>> = {
  normal:   { l1: '#3B82F6', node: '#3B82F6', geth: '#3B82F6', batch: '#3B82F6' },
  anomaly:  { l1: '#3B82F6', node: '#F59E0B', geth: '#EF4444', batch: '#3B82F6' },
  rca:      { l1: '#3B82F6', node: '#F59E0B', geth: '#EF4444', batch: '#3B82F6' },
  resolved: { l1: '#3B82F6', node: '#10FFAA', geth: '#10FFAA', batch: '#10FFAA' },
};

function MiniNode({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        animate={{ boxShadow: `0 0 8px ${color}` }}
        transition={{ duration: 0.4 }}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
        style={{ background: color + '22', border: `1.5px solid ${color}`, color }}
      >
        {label[0].toUpperCase()}
      </motion.div>
      <span className="text-[9px] text-muted-foreground font-mono">{label}</span>
    </div>
  );
}

export function HeroMiniature() {
  const [stage, setStage] = useState<Stage>('normal');
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIdx((i) => {
        const next = (i + 1) % STAGES.length;
        setStage(STAGES[next]);
        return next;
      });
    }, STAGE_DURATION);
    return () => clearInterval(timer);
  }, []);

  const colors = NODE_COLORS[stage];

  return (
    <div className="rounded-xl border border-border bg-card/90 p-4 w-72 shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
          <Shield className="size-3" />
          SentinAI
        </div>
        <div className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] text-muted-foreground">Live</span>
        </div>
      </div>

      {/* Node graph */}
      <div className="flex items-center justify-between px-2 mb-3">
        <MiniNode label="L1" color={colors.l1} />
        <div className="h-px w-4 bg-border" />
        <MiniNode label="op-node" color={colors.node} />
        <div className="h-px w-4 bg-border" />
        <MiniNode label="op-geth" color={colors.geth} />
        <div className="h-px w-4 bg-border" />
        <MiniNode label="batcher" color={colors.batch} />
      </div>

      {/* Status overlay */}
      <div className="min-h-[48px] relative">
        <AnimatePresence mode="wait">
          {stage === 'normal' && (
            <motion.div key="normal"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="text-[11px] text-muted-foreground text-center py-2"
            >
              All nodes operating normally
            </motion.div>
          )}
          {stage === 'anomaly' && (
            <motion.div key="anomaly"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2"
            >
              <AlertTriangle className="size-3 text-warning shrink-0" />
              <span className="text-[11px] text-warning">Anomaly detected: op-geth</span>
            </motion.div>
          )}
          {stage === 'rca' && (
            <motion.div key="rca"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2"
            >
              <Brain className="size-3 text-primary shrink-0" />
              <span className="text-[11px] text-primary">RCA: L1 RPC Rate Limit</span>
            </motion.div>
          )}
          {stage === 'resolved' && (
            <motion.div key="resolved"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 bg-accent/10 border border-accent/30 rounded-lg px-3 py-2"
            >
              <CheckCircle2 className="size-3 text-accent shrink-0" />
              <span className="text-[11px] text-accent">Recovery complete</span>
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
