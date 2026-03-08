# SentinAI UI Redesign Design

**Date:** 2026-03-08
**Scope:** Dashboard (`src/app/`) + Landing Page (`website/src/app/`)
**Approach:** Parallel Tracks — shadcn/ui full adoption + visual rebranding + 3D agent visualization

---

## Goals

- **Visual quality**: Polished, professional look with 3D animations and real-time rendering
- **Maintainability**: Replace 2278-line inline Tailwind with shadcn components
- **UX**: Agent behavior and interactions visible at a glance on one screen
- **Consistency**: Unified design system across dashboard and landing page

---

## 1. Design System — "Sentinel Dark"

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#050C18` | Top-level background (deep navy) |
| `--card` | `#0D1626` | Cards and panels |
| `--border` | `#1A2B4A` | Dividers |
| `--primary` | `#3B82F6` | Electric Blue — CTA, active states |
| `--accent` | `#10FFAA` | Acid Green — agent active, live events |
| `--warning` | `#F59E0B` | Amber — anomaly warnings |
| `--destructive` | `#EF4444` | Red — critical / emergency |
| `--foreground` | `#E8F4FF` | Body text |
| `--muted-foreground` | `#4A7FA5` | Secondary text |

**Concept:** Deep navy space background with electric blue (stability) and acid green (active agent) contrast — "living infrastructure."

### Typography

| Role | Font | Usage |
|------|------|-------|
| Headings | Geist (already in use) | Dashboard metrics, status values |
| Body | Geist | Descriptions, messages |
| Monospace | Geist Mono | Logs, hashes, RPC addresses |

### shadcn Theme Configuration

Both apps define CSS variables in `globals.css` via `@theme inline`. shadcn `init` uses custom palette directly:

```css
/* globals.css (shared tokens) */
@theme inline {
  --color-background: #050C18;
  --color-card: #0D1626;
  --color-primary: #3B82F6;
  --color-accent: #10FFAA;
  --color-warning: #F59E0B;
  --color-destructive: #EF4444;
}
```

---

## 2. Dashboard Redesign

### Layout — Single Screen (no sidebar, no tabs)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🛡 SentinAI │ L1 #8,421k ↑ │ L2 #2,103k ↑ │ TxPool 247 │      │
│             │ Peers 42     │ Sync ✓       │ Score 63   │ ●Live │
└─────────────────────────────────────────────────────────────────┘
│                                         │                       │
│                                         │  Event Stream         │
│                                         │  ●14:32 Anomaly: HIGH │
│       3D Agent Network Graph            │  ✓14:31 Scale→4vCPU  │
│                                         │  ✓14:28 RCA done     │
│   [L1 RPC] ──→ [op-node]──→ [op-geth]  │  ○14:15 Anomaly: LOW │
│                    ├──→ [op-batcher]    │  ──────────────────── │
│                    └──→ [op-proposer]   │  Scaling Score        │
│                                         │  CPU  ████░░ 63/100  │
│   (node pulse · glow · packet anim)     │  [Normal → HIGH →?]  │
│                                         │  ──────────────────── │
│                                         │  Agent Decision       │
│                                         │  Last: Scale 2→4vCPU  │
│                                         │  Next pred: HIGH 87%  │
│─────────────────────────────────────────│                       │
│  NLOps  [메시지를 입력하세요...    ▶ ]  │  [Run RCA] [Remediate]│
└─────────────────────────────────────────────────────────────────┘
```

**Zones:**
- **Top status bar**: L1/L2 block heights, peers, sync status, TxPool, Agent score — numbers only, one line
- **Left (65%)**: 3D Agent Network Graph — dominant main element
- **Right (35%)**: Event Stream + Scaling Score + Agent Decision — vertical stack
- **Bottom bar**: NLOps chat input + quick action buttons (Run RCA, Remediate)

### shadcn Component Mapping

| Current | shadcn Component | Location |
|---------|-----------------|----------|
| `div.rounded-lg.border` | `<Card>` + `<CardHeader>` | All metric panels |
| Custom badge `div` | `<Badge>` | Status: Running, Syncing, etc. |
| Custom buttons | `<Button>` | Scale, RCA, Remediate |
| No toast | `<Sonner>` | Real-time event notifications |
| Raw Recharts | `<Chart>` (shadcn wrapper) | Scaling score timeline |
| No table | `<DataTable>` | Anomaly event list (if needed) |
| `<select>` | `<Select>` | Chain/network switcher |
| Custom tooltip | `<Tooltip>` | Chart hover, icon labels |
| No scroll area | `<ScrollArea>` | Event stream right panel |

### 3D Agent Network Graph

**Library:** React Three Fiber (`@react-three/fiber` + `@react-three/drei`)

- Visualizes the L2 dependency graph from `ChainPlugin.dependencyGraph`:
  `L1 → op-node → op-geth → op-batcher → L1`
  `L1 → op-node → op-proposer → L1`
- Node appearance by state:
  - Normal: blue glow pulse
  - Anomaly: amber pulse animation
  - Critical: red flash
- Edge animation: packet-travel effect showing real transaction/block propagation

### Real-time Visual Elements

| Element | Library | Behavior |
|---------|---------|---------|
| Node pulse / glow | React Three Fiber | State-driven, continuous |
| Packet travel on edges | React Three Fiber | Loops while agent is active |
| Metric number change | Framer Motion (installed) | Count-up animation on value change |
| Event stream entries | Framer Motion | Slide-in from top |
| Scaling score bar | shadcn `<Progress>` | Smooth transition |

### Glassmorphism Cards (right panel)

shadcn `<Card>` + custom CSS:
```css
backdrop-filter: blur(12px);
background: rgba(13, 22, 38, 0.7);
border: 1px solid rgba(59, 130, 246, 0.2);
```

---

## 3. Landing Page Redesign

### Page Structure

```
Navbar → Hero (Live Miniature) → Social Proof → Features → How It Works → Supported Clients → CTA
```

### Hero Section

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Autonomous Guardian           ┌───────────────────────────┐  │
│   for L2 Networks               │  🛡 SentinAI    ● Live    │  │
│                                 │  ┌──────────────────────┐ │  │
│   이상을 감지하고,               │  │  [L1]──→[op-node]    │ │  │
│   원인을 추적하고,               │  │         ↗[op-geth] ⚠ │ │  │
│   스스로 복구합니다.             │  │  Anomaly detected!   │ │  │
│                                 │  │  RCA: L1 rate limit  │ │  │
│   [Connect Your Node →]         │  │  ✓ Remediation done  │ │  │
│   [View Demo]                   │  └──────────────────────┘ │  │
│                                 │  Score 63  TxPool ↑ HIGH  │  │
│                                 └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Hero right miniature:** Framer Motion sequence animation (already installed), 4-second loop:
1. Show normal state (blue nodes)
2. Anomaly appears on op-geth (amber pulse)
3. "Anomaly detected!" badge appears
4. "RCA: L1 rate limit" appears
5. "✓ Remediation done" — nodes return to blue

No real RPC connection needed — pure CSS/JS animation.

### Social Proof Section

```
99.9% Uptime  |  47ms Detection  |  3s Auto-heal  |  5+ Chains
```

Framer Motion count-up animation triggered on scroll entry.

### How It Works — Aligned with Agent v2

Actual agent phases: `observe → detect → analyze → plan → act → verify`

Condensed to 3 steps for display:

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Observe & Detect │ → │  Analyze & Plan  │ → │  Act & Verify    │
│                  │   │                  │   │                  │
│ 메트릭 수집,     │   │ AI RCA,          │   │ 스케일링/복구,   │
│ 4-Layer 이상     │   │ Goal Manager     │   │ 결과 검증 +      │
│ 탐지 파이프라인  │   │ 우선순위화       │   │ 자동 롤백        │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### Color Consistency

Landing page uses identical `Sentinel Dark` palette as dashboard — same CSS variables, unified brand identity.

---

## 4. Implementation Tracks

### Track 1 — shadcn Infrastructure
1. `npx shadcn@latest init` on dashboard app (Tailwind v4 compatible)
2. Define `Sentinel Dark` color tokens in `globals.css`
3. Install components: `Button`, `Badge`, `Card`, `Sonner`, `Chart`, `Progress`, `Tooltip`, `ScrollArea`, `Select`
4. Apply to dashboard: replace inline Tailwind with shadcn components
5. Repeat `shadcn init` on `website/` app with same tokens

### Track 2 — Visual Innovation
1. Install `@react-three/fiber` + `@react-three/drei`
2. Build `AgentNetworkGraph` component (reads `ChainPlugin.dependencyGraph`)
3. Wire real-time state (anomaly events, agent phase) to node colors/animations
4. Build Hero miniature for landing page using Framer Motion sequences

### Merge
- Both tracks use `Sentinel Dark` tokens — consistent output
- `AgentNetworkGraph` component used in dashboard main panel
- Simplified version (static nodes, animated events only) used in landing Hero

---

## 5. New Dependencies

| Package | Purpose | App |
|---------|---------|-----|
| `shadcn` (CLI) | Component scaffolding | Both |
| `@radix-ui/*` | shadcn peer deps (auto-installed) | Both |
| `@react-three/fiber` | 3D rendering | Dashboard |
| `@react-three/drei` | Three.js helpers | Dashboard |
| `three` | Three.js core | Dashboard |

Framer Motion is already installed — no additional dep needed for landing animations.

---

## 6. Out of Scope

- Backend / API changes — none required
- Test changes — existing tests unaffected (UI only)
- New pages or routes — no new routes
- Mobile layout — not in scope for this iteration
