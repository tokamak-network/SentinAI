# Hero Miniature Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OP Stack-specific node graph in `HeroMiniature` with a chain-agnostic pipeline flow visualization (OBSERVE → DETECT → ANALYZE → ACT).

**Architecture:** Single file rewrite of `hero-miniature.tsx`. The existing state machine (`Stage` type + `useEffect` interval) is preserved; only the rendered JSX changes. `MiniNode` and `NODE_COLORS` are removed. A new `PipelineStage` helper replaces them.

**Tech Stack:** React 19, framer-motion (AnimatePresence / motion.div), TypeScript, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-03-11-hero-miniature-pipeline-design.md`

---

## Chunk 1: Rewrite HeroMiniature

### Task 1: Replace hero-miniature.tsx

**Files:**
- Modify: `website/src/components/hero-miniature.tsx`

- [ ] **Step 1: Read the current file**

Read `website/src/components/hero-miniature.tsx` in full before making any changes.

- [ ] **Step 2: Rewrite the file**

Replace the entire contents with the following:

```tsx
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
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 'unset' : 1, gap: 4, flex: 1 }}>
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
```

- [ ] **Step 3: Verify build**

```bash
cd website && npm run build 2>&1 | tail -20
```

Expected: No TypeScript errors. Exit code 0.

If there are errors, fix them before proceeding.

- [ ] **Step 4: Check for duplicate `flex` prop on arrow wrapper div and fix if needed**

The arrow wrapper div in the pipeline map has a duplicate `flex` style (both `flex: 'unset'` and `flex: 1`). Fix by using a single conditional:

```tsx
// Replace the outer div in the map:
<div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 4 }}>
  <PipelineStage step={step} status={status} />
  {i < STEPS.length - 1 && (
    <div style={{ color: arrowColor, fontSize: 12, flexShrink: 0, fontFamily: 'monospace' }}>›</div>
  )}
</div>
```

- [ ] **Step 5: Verify build again after fix**

```bash
cd website && npm run build 2>&1 | tail -10
```

Expected: Exit code 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add website/src/components/hero-miniature.tsx
git commit -m "feat(website): replace OP Stack node graph with chain-agnostic pipeline animation"
```

---

## Chunk 2: Visual Smoke Test

### Task 2: Confirm animation works locally

- [ ] **Step 1: Start dev server**

```bash
cd website && npm run dev
```

Open `http://localhost:3000` in browser.

- [ ] **Step 2: Verify animation**

Observe the `HeroMiniature` card in the hero section:
- Stage 1 (OBSERVE): blue active, status "Collecting metrics…"
- Stage 2 (DETECT): amber active, prior stage green ✓, status "⚠ Anomaly detected…"
- Stage 3 (ANALYZE): green active, prior stages green ✓, status "🧠 RCA:…"
- Stage 4 (ACT): purple active, all prior green ✓, status "✓ Recovery complete…"
- Cycles back to OBSERVE.

No OP Stack-specific labels (`op-node`, `op-geth`, `batcher`) should appear.

- [ ] **Step 3: Done — stop dev server**
