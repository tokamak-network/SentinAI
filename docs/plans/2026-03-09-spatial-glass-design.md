# SentinAI Dashboard — Spatial Glass Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan.

**Goal:** Complete visual redesign of the SentinAI monitoring dashboard using Spatial Glass aesthetic — award-winning glassmorphism with real depth, refined typography, and disciplined color.

**Reference:** Raycast, Apple visionOS UI, Linear.app — Awwwards 2024–2025 winners in the ops/tool category.

**Scope:** `src/app/page.tsx` (StatusBar, NLOpsBar inline sections) + `src/components/status-bar.tsx`, `src/components/event-stream.tsx`, `src/components/scaling-panel.tsx`, `src/components/nlops-bar.tsx`, `src/app/globals.css`. The 3D `agent-network-graph.tsx` is **not touched**.

---

## 1. Color & Layer System

### Background (Layer 0)

```css
background: radial-gradient(ellipse 80% 60% at 50% 0%, #0D1F3C 0%, #030812 60%, #020810 100%);
```

Plus a noise texture overlay at 2% opacity using an inline SVG filter — zero bundle cost.

### Glass Panels (Layer 1)

All cards/panels use:

```css
background: rgba(255, 255, 255, 0.03);
border: 1px solid rgba(255, 255, 255, 0.08);
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);  /* top light reflection */
backdrop-filter: blur(20px);
```

### Active / Accent (Layer 2)

Active elements (alert card borders, focused input):

```css
border-color: rgba(255, 255, 255, 0.20);
box-shadow: 0 0 16px rgba(110, 231, 247, 0.15);  /* ice blue ambient */
```

### Point Colors (3 only)

| Name | Value | Use |
|------|-------|-----|
| Ice Blue | `#6EE7F7` | Primary — live indicator, active borders, links |
| Lavender | `#A78BFA` | AI / processing state |
| Warm Orange | `#FB923C` | Alert / warning |

Score tier colors (status-bar + scaling-panel):
- 0–30 Idle: `#4ADE80` (green)
- 30–70 Normal: `#6EE7F7` (ice blue)
- 70–77 High: `#FB923C` (warm orange)
- 77+ Emergency: `#F87171` (soft red)

---

## 2. Layout

No structural layout change — same 3-zone layout. Visual refinements only:

```
┌─────────────────────────────────────────────────────┐
│ StatusBar  bg-black/40 backdrop-blur-xl             │
│ border-b border-white/[0.06]  px-6                  │
└─────────────────────────────────────────────────────┘

┌───────────────────────────────┬─────────────────────┐
│  AgentNetworkGraph            │  EventStream card   │
│  (unchanged)                  │  ScalingPanel card  │
│                               │  gap-3, px-3        │
└───────────────────────────────┴─────────────────────┘

┌─────────────────────────────────────────────────────┐
│ NLOpsBar  bg-black/40 backdrop-blur-xl              │
│ border-t border-white/[0.06]                        │
└─────────────────────────────────────────────────────┘
```

Right panel width stays 320px. Main area stays `flex-1`.

---

## 3. Component Specs

### StatusBar (`src/components/status-bar.tsx`)

- Remove solid `bg-card` → `bg-black/40 backdrop-blur-xl`
- Remove hard `border-b border-border` → `border-b border-white/[0.06]`
- Live indicator: `● Live` with ice blue `text-[#6EE7F7]` + `animate-pulse` on the dot only
- Score number: color driven by tier (green/ice-blue/orange/red), `font-mono tabular-nums`
- Stat labels: `text-[10px] uppercase tracking-widest text-white/40`
- Stat values: `text-xs font-mono text-white/80`
- Separator: `bg-white/[0.08]` (was `bg-border`)

### EventStream (`src/components/event-stream.tsx`)

- Card: glass panel style (see Layer 1)
- Each event row: left `2px` colored border (`border-l-2`) matching severity color
  - critical → `border-[#F87171]`
  - high → `border-[#FB923C]`
  - medium → `border-[#6EE7F7]`
  - low → `border-white/30`
- New event animation: `animate-in fade-in slide-in-from-top-1 duration-200`
- Hover: `hover:bg-white/[0.03]`
- Empty state: centered icon + `text-white/30` message

### ScalingPanel (`src/components/scaling-panel.tsx`)

- Card: glass panel style
- Score display: `text-5xl font-light tabular-nums` + `/ 100` in `text-white/30` beside it
- Score color: tier-based (same as StatusBar)
- vCPU display: dot gauge — 4 dots, filled dots match current vCPU tier
  - 1 vCPU → `● ○ ○ ○`, 2 → `● ● ○ ○`, 4 → `● ● ● ○`, 8 → `● ● ● ●`
  - Filled dot color: tier color
- Alert state: when score ≥ 70, card border transitions to `border-[#FB923C]/40`
  - `box-shadow: 0 0 20px rgba(251, 146, 60, 0.10)`
- Section labels: `text-[10px] uppercase tracking-widest text-white/40`

### NLOpsBar (`src/components/nlops-bar.tsx`)

- Container: `bg-black/40 backdrop-blur-xl border-t border-white/[0.06]`
- Quick action buttons (RCA, Remediate, Simulate):
  - Remove `variant="outline"` → custom `bg-white/[0.05] hover:bg-white/[0.08]` pill
  - `rounded-full px-3 py-1 text-xs text-white/60 hover:text-white/90`
  - No border by default, `border border-white/[0.08]` on hover
- Input wrapper: `bg-white/[0.04] border border-white/[0.10] rounded-xl`
  - Focus: `border-white/[0.20] shadow-[0_0_12px_rgba(110,231,247,0.08)]`
- Send button: hidden when input empty (`opacity-0 pointer-events-none`), ice blue when visible

### globals.css additions

```css
/* Noise texture */
.noise-bg::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,...");  /* inline SVG noise */
  opacity: 0.02;
  pointer-events: none;
  z-index: 0;
}

/* Dashboard background */
.dashboard-bg {
  background: radial-gradient(ellipse 80% 60% at 50% 0%, #0D1F3C 0%, #030812 60%, #020810 100%);
}

/* Glass panel utility */
.glass-panel-v2 {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  border-radius: 12px;
}
```

---

## 4. What Does NOT Change

- `agent-network-graph.tsx` — untouched
- Layout structure (3 zones, 320px right panel)
- All data logic, polling, state management
- Component file structure
- 3D node colors (they're already aligned: ice blue, lavender, amber, cyan)

---

## 5. Files to Modify

| File | Change Type |
|------|-------------|
| `src/app/globals.css` | Add noise bg, dashboard-bg, glass-panel-v2 utilities |
| `src/components/status-bar.tsx` | Full visual rewrite |
| `src/components/event-stream.tsx` | Full visual rewrite |
| `src/components/scaling-panel.tsx` | Full visual rewrite |
| `src/components/nlops-bar.tsx` | Full visual rewrite |
| `src/app/page.tsx` | Background class, right panel wrapper, card wrappers |
