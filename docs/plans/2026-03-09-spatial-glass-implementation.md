# Spatial Glass Dashboard Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the SentinAI monitoring dashboard to Spatial Glass aesthetic — real glassmorphism depth, refined typography, disciplined color palette.

**Architecture:** Pure visual layer — CSS variables + Tailwind class replacements across 5 components and globals.css. Zero logic changes. `agent-network-graph.tsx` is untouched.

**Tech Stack:** Tailwind CSS 4 (inline @theme), shadcn/ui cards (replaced with custom glass), Geist fonts (kept).

**Design reference:** `docs/plans/2026-03-09-spatial-glass-design.md`

---

## Task 1: Update CSS — new color palette + glass utilities

**Files:**
- Modify: `src/app/globals.css`

### New color values

| Variable | Old | New |
|----------|-----|-----|
| `--color-background` | `#050C18` | `#030812` |
| `--color-primary` | `#3B82F6` | `#6EE7F7` (ice blue) |
| `--color-accent` | `#10FFAA` | `#A78BFA` (lavender) |
| `--color-warning` | `#F59E0B` | `#FB923C` (warm orange) |
| `--color-muted-foreground` | `#4A7FA5` | `#4A6580` |
| `--color-border` | `#1A2B4A` | `#ffffff14` (white/8%) |
| `--color-card` | `#0D1626` | `#ffffff08` (white/3%) |

### Step 1: Replace the `@theme inline` block and utilities

Open `src/app/globals.css` and replace the entire file with:

```css
@import "tailwindcss";

@theme inline {
  /* Spatial Glass palette */
  --color-background: #030812;
  --color-foreground: #E8F4FF;
  --color-card: oklch(from #ffffff calc(l * 0.03) c h);
  --color-card-foreground: #E8F4FF;
  --color-primary: #6EE7F7;
  --color-primary-foreground: #030812;
  --color-secondary: #0D1626;
  --color-secondary-foreground: #E8F4FF;
  --color-muted: #0D1626;
  --color-muted-foreground: #4A6580;
  --color-accent: #A78BFA;
  --color-accent-foreground: #030812;
  --color-destructive: #F87171;
  --color-destructive-foreground: #E8F4FF;
  --color-warning: #FB923C;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-input: rgba(255, 255, 255, 0.04);
  --color-ring: #6EE7F7;

  /* Typography */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  /* Radius */
  --radius: 0.75rem;
}

/* Dashboard background */
@layer utilities {
  .dashboard-bg {
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #0D1F3C 0%, #030812 60%, #020810 100%);
  }

  /* Spatial Glass panel — replaces old .glass-panel */
  .glass-panel {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  /* Alert state — border glows orange */
  .glass-panel-alert {
    border-color: rgba(251, 146, 60, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 0 20px rgba(251, 146, 60, 0.10);
  }

  /* 3D graph glow helpers (kept for agent-network-graph) */
  .agent-glow-blue  { box-shadow: 0 0 12px rgba(110, 231, 247, 0.4); }
  .agent-glow-green { box-shadow: 0 0 12px rgba(167, 139, 250, 0.5); }
  .agent-glow-amber { box-shadow: 0 0 12px rgba(251, 146, 60, 0.5); }
  .agent-glow-red   { box-shadow: 0 0 16px rgba(248, 113, 113, 0.6); }
}

@keyframes loading-bar {
  0%   { width: 0%;   transform: translateX(0); }
  50%  { width: 100%; transform: translateX(0); }
  100% { width: 0%;   transform: translateX(100%); opacity: 0; }
}

.animate-loading-bar {
  animation: loading-bar 1.5s infinite ease-in-out;
}
```

### Step 2: Verify build is clean

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Compiled` with no errors.

### Step 3: Commit

```bash
git add src/app/globals.css
git commit -m "style: update color palette to spatial glass system"
```

---

## Task 2: Rewrite StatusBar

**Files:**
- Modify: `src/components/status-bar.tsx`

### Step 1: Replace file content

```tsx
'use client';

import { Separator } from '@/components/ui/separator';
import { Shield } from 'lucide-react';

interface StatusBarProps {
  l1BlockHeight: number;
  l2BlockHeight: number;
  l1BlockDelta: number;
  l2BlockDelta: number;
  txPoolPending: number;
  agentScore: number;
  agentPhase: string;
  peerCount?: number;
  isSyncing: boolean;
  networkName?: string;
}

function scoreColor(score: number): string {
  if (score >= 77) return 'text-[#F87171]';
  if (score >= 70) return 'text-[#FB923C]';
  if (score >= 30) return 'text-[#6EE7F7]';
  return 'text-[#4ADE80]';
}

export function StatusBar({
  l1BlockHeight,
  l2BlockHeight,
  l1BlockDelta,
  l2BlockDelta,
  txPoolPending,
  agentScore,
  agentPhase,
  peerCount,
  isSyncing,
  networkName,
}: StatusBarProps) {
  const isLive = agentPhase !== 'error' && agentPhase !== 'idle';

  return (
    <header className="flex items-center gap-3 px-6 h-10 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl text-xs shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-1.5 text-[#6EE7F7] font-semibold mr-2">
        <Shield className="size-3.5" />
        <span className="font-mono tracking-wide">SentinAI</span>
      </div>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* L1 */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">L1</span>
      <span className="font-mono text-white/80">#{l1BlockHeight.toLocaleString()}</span>
      {l1BlockDelta > 0 && <span className="text-[#6EE7F7] text-[10px]">↑{l1BlockDelta}</span>}

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* L2 */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">L2</span>
      <span className="font-mono text-white/80">#{l2BlockHeight.toLocaleString()}</span>
      {l2BlockDelta > 0 && <span className="text-[#6EE7F7] text-[10px]">↑{l2BlockDelta}</span>}
      {peerCount !== undefined && (
        <span className="text-white/30 text-[10px]">Peers {peerCount}</span>
      )}
      <span className={`text-[10px] font-mono ${isSyncing ? 'text-[#FB923C]' : 'text-[#4ADE80]'}`}>
        {isSyncing ? 'Syncing' : '✓ Sync'}
      </span>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* TxPool */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">TxPool</span>
      <span className="font-mono text-white/80">{txPoolPending}</span>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* Score */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">Score</span>
      <span className={`font-mono font-bold tabular-nums ${scoreColor(agentScore)}`}>
        {agentScore}
      </span>

      {/* Network name */}
      {networkName && (
        <>
          <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />
          <span className="text-white/30 text-[10px] font-mono">{networkName}</span>
        </>
      )}

      {/* Live indicator */}
      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${isLive ? 'bg-[#4ADE80] animate-pulse' : 'bg-white/20'}`}
        />
        <span className={`text-[10px] font-mono ${isLive ? 'text-[#4ADE80]' : 'text-white/30'}`}>
          {isLive ? 'Live' : 'Idle'}
        </span>
      </div>
    </header>
  );
}
```

### Step 2: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

Expected: `✓ Compiled`

### Step 3: Commit

```bash
git add src/components/status-bar.tsx
git commit -m "style(status-bar): spatial glass redesign"
```

---

## Task 3: Rewrite EventStream

**Files:**
- Modify: `src/components/event-stream.tsx`

### Step 1: Replace file content

```tsx
'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, Info, Zap, Radio } from 'lucide-react';

type EventType = 'anomaly' | 'scale' | 'rca' | 'remediate' | 'info';

interface StreamEvent {
  id: string;
  time: string;
  type: EventType;
  message: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

interface EventStreamProps {
  events: StreamEvent[];
}

const EVENT_ICONS: Record<EventType, React.ReactNode> = {
  anomaly:   <AlertTriangle className="size-3" />,
  scale:     <Zap className="size-3" />,
  rca:       <Info className="size-3" />,
  remediate: <CheckCircle2 className="size-3" />,
  info:      <Info className="size-3" />,
};

// Left border color per severity
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-[#F87171]',
  high:     'border-[#FB923C]',
  medium:   'border-[#6EE7F7]',
  low:      'border-white/20',
};

// Icon color per event type
const EVENT_ICON_COLOR: Record<EventType, string> = {
  anomaly:   'text-[#FB923C]',
  scale:     'text-[#6EE7F7]',
  rca:       'text-[#A78BFA]',
  remediate: 'text-[#4ADE80]',
  info:      'text-white/40',
};

export function EventStream({ events }: EventStreamProps) {
  return (
    <div className="glass-panel rounded-xl h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <Radio className="size-3 text-white/40" />
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          Live Events
        </span>
      </div>

      {/* Events */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2 space-y-1">
          {events.map((event) => (
            <div
              key={event.id}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-md border-l-2 hover:bg-white/[0.03] transition-colors animate-in fade-in slide-in-from-top-1 duration-200 ${
                event.severity ? SEVERITY_BORDER[event.severity] : 'border-white/10'
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${EVENT_ICON_COLOR[event.type]}`}>
                {EVENT_ICONS[event.type]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/80 truncate">{event.message}</p>
                <p className="text-[10px] text-white/30 font-mono mt-0.5">{event.time}</p>
              </div>
              {event.severity && (
                <span className={`text-[9px] font-mono shrink-0 mt-0.5 ${
                  event.severity === 'critical' ? 'text-[#F87171]' :
                  event.severity === 'high'     ? 'text-[#FB923C]' :
                  event.severity === 'medium'   ? 'text-[#6EE7F7]' :
                                                  'text-white/30'
                }`}>
                  {event.severity.toUpperCase()}
                </span>
              )}
            </div>
          ))}

          {events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Radio className="size-5 text-white/15" />
              <p className="text-[10px] text-white/25 font-mono">No events</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export type { StreamEvent };
```

### Step 2: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

### Step 3: Commit

```bash
git add src/components/event-stream.tsx
git commit -m "style(event-stream): spatial glass redesign with severity borders"
```

---

## Task 4: Rewrite ScalingPanel

**Files:**
- Modify: `src/components/scaling-panel.tsx`

### Step 1: Replace file content

```tsx
'use client';

import { Zap, TrendingUp } from 'lucide-react';

interface ScalingPanelProps {
  score: number;
  currentVcpu: number;
  targetVcpu: number;
  predictionTier?: string;
  predictionConfidence?: number;
  lastDecision?: string;
  autoScalingEnabled: boolean;
}

// Dot gauge: how many of 4 dots to fill for each vCPU tier
const VCPU_DOTS: Record<number, number> = { 1: 1, 2: 2, 4: 3, 8: 4 };

function scoreTierColor(score: number): string {
  if (score >= 77) return '#F87171';
  if (score >= 70) return '#FB923C';
  if (score >= 30) return '#6EE7F7';
  return '#4ADE80';
}

function scoreTierLabel(score: number): string {
  if (score >= 77) return 'Emergency';
  if (score >= 70) return 'High';
  if (score >= 30) return 'Normal';
  return 'Idle';
}

export function ScalingPanel({
  score,
  currentVcpu,
  targetVcpu,
  predictionTier,
  predictionConfidence,
  lastDecision,
  autoScalingEnabled,
}: ScalingPanelProps) {
  const color = scoreTierColor(score);
  const label = scoreTierLabel(score);
  const isAlert = score >= 70;
  const filledDots = VCPU_DOTS[currentVcpu] ?? 1;

  return (
    <div className={`glass-panel rounded-xl p-4 space-y-4 transition-all duration-500 ${isAlert ? 'glass-panel-alert' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Zap className="size-3 text-white/40" />
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          Scaling Score
        </span>
      </div>

      {/* Big score */}
      <div className="flex items-end gap-2">
        <span
          className="text-5xl font-light tabular-nums font-mono leading-none transition-colors duration-500"
          style={{ color }}
        >
          {score}
        </span>
        <span className="text-white/25 text-lg font-mono mb-1">/ 100</span>
        <span
          className="ml-auto text-xs font-mono mb-1 transition-colors duration-500"
          style={{ color }}
        >
          {label}
        </span>
      </div>

      {/* Score bar */}
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>

      {/* vCPU dot gauge */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">vCPU</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="size-2 rounded-full transition-all duration-500"
                style={{
                  backgroundColor: i <= filledDots ? color : 'rgba(255,255,255,0.1)',
                  boxShadow: i <= filledDots ? `0 0 6px ${color}80` : 'none',
                }}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-white/60">{currentVcpu} vCPU</span>
        </div>
      </div>

      {/* Target (when different) */}
      {targetVcpu !== currentVcpu && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Target</span>
          <span className="font-mono text-[#6EE7F7]">→ {targetVcpu} vCPU</span>
        </div>
      )}

      {/* Auto-scale */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Auto-scale</span>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
          autoScalingEnabled
            ? 'text-[#4ADE80] border-[#4ADE80]/30 bg-[#4ADE80]/[0.08]'
            : 'text-white/30 border-white/10 bg-white/[0.03]'
        }`}>
          {autoScalingEnabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* AI prediction */}
      {predictionTier && (
        <div className="border-t border-white/[0.06] pt-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3 text-white/30" />
            <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">AI Prediction</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/70">{predictionTier}</span>
            {predictionConfidence && (
              <span className="text-[10px] font-mono text-white/40">{predictionConfidence}%</span>
            )}
          </div>
        </div>
      )}

      {/* Last decision */}
      {lastDecision && (
        <p className="text-[10px] text-white/25 font-mono truncate">{lastDecision}</p>
      )}
    </div>
  );
}
```

### Step 2: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

### Step 3: Commit

```bash
git add src/components/scaling-panel.tsx
git commit -m "style(scaling-panel): spatial glass redesign with dot gauge"
```

---

## Task 5: Rewrite NLOpsBar

**Files:**
- Modify: `src/components/nlops-bar.tsx`

### Step 1: Replace file content

```tsx
'use client';

import { useState } from 'react';
import { Send, Stethoscope, Wrench, FlaskConical } from 'lucide-react';

const SCENARIOS = [
  { id: 'spike',  label: 'Spike',  color: 'text-[#F87171]' },
  { id: 'rising', label: 'Rising', color: 'text-[#FB923C]' },
  { id: 'stable', label: 'Stable', color: 'text-[#4ADE80]' },
  { id: 'live',   label: 'Live',   color: 'text-[#6EE7F7]' },
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
    <div className="relative flex items-center gap-2 px-4 h-12 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl shrink-0">
      {/* Scenario picker popover */}
      {showScenarios && (
        <div className="absolute bottom-full left-4 mb-2 flex gap-1 p-1.5 rounded-xl border border-white/[0.08] glass-panel shadow-xl">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleScenario(s.id)}
              className={`px-3 py-1 text-[10px] rounded-lg font-mono hover:bg-white/[0.06] transition-colors ${s.color}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick action buttons */}
      <button
        onClick={onRunRca}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] transition-all"
      >
        <Stethoscope className="size-3" />
        Run RCA
      </button>
      <button
        onClick={onRemediate}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] transition-all"
      >
        <Wrench className="size-3" />
        Remediate
      </button>
      {onInjectScenario && (
        <button
          onClick={() => setShowScenarios((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono bg-white/[0.05] hover:bg-white/[0.08] border transition-all ${
            showScenarios
              ? 'text-[#FB923C] border-[#FB923C]/30 bg-[#FB923C]/[0.06]'
              : 'text-white/50 hover:text-white/80 border-white/[0.08]'
          }`}
        >
          <FlaskConical className="size-3" />
          Simulate
        </button>
      )}

      {/* NLOps input */}
      <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/[0.10] focus-within:border-white/[0.20] focus-within:shadow-[0_0_12px_rgba(110,231,247,0.08)] rounded-xl px-3 h-8 transition-all">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a command..."
          className="flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/25 font-mono outline-none"
          data-testid="nlops-input"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className={`size-5 flex items-center justify-center rounded-md transition-all ${
            input.trim()
              ? 'text-[#6EE7F7] hover:bg-[#6EE7F7]/10'
              : 'text-white/20 pointer-events-none'
          }`}
          data-testid="nlops-send"
        >
          <Send className="size-3" />
        </button>
      </div>
    </div>
  );
}
```

### Step 2: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

### Step 3: Commit

```bash
git add src/components/nlops-bar.tsx
git commit -m "style(nlops-bar): spatial glass pill buttons and refined input"
```

---

## Task 6: Update page.tsx background + panel wrappers

**Files:**
- Modify: `src/app/page.tsx`

This task only changes class names in page.tsx — no logic changes.

### Step 1: Add `dashboard-bg` to root element

Find the outermost `<div>` in the return statement of the dashboard page component (it will have `className` containing `h-screen` or similar). Add `dashboard-bg` to it.

Current pattern to find:
```tsx
<div className="flex flex-col h-screen overflow-hidden ...">
```

Change to:
```tsx
<div className="flex flex-col h-screen overflow-hidden dashboard-bg">
```

### Step 2: Update right panel wrapper classes

Find the right panel container (320px wide section containing EventStream and ScalingPanel). It likely looks like:
```tsx
<div className="w-80 flex flex-col gap-2 p-2 ...">
```

Update padding and gap:
```tsx
<div className="w-80 flex flex-col gap-3 p-3 overflow-y-auto">
```

The `EventStream` and `ScalingPanel` now have their own glass styling, so remove any wrapping `<Card>` or `glass-panel` class from the right panel container itself if present.

### Step 3: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

### Step 4: Run lint

```bash
npm run lint 2>&1 | tail -5
```

### Step 5: Commit

```bash
git add src/app/page.tsx
git commit -m "style(page): add dashboard background and update right panel spacing"
```

---

## Task 7: Final verification

### Step 1: Full build

```bash
npm run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully`

### Step 2: Dev server smoke test

```bash
npm run dev &
sleep 5
curl -s http://localhost:3002 | grep -c "SentinAI"
```

Expected: number > 0

### Step 3: Push

```bash
git push origin main
```
