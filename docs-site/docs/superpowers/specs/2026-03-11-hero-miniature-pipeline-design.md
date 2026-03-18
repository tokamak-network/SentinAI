# Hero Miniature Pipeline Redesign

**Date:** 2026-03-11
**Status:** Approved
**Scope:** `website/src/components/hero-miniature.tsx`

## Problem

The current `HeroMiniature` component renders an OP Stack-specific node graph (`L1 → op-node → op-geth → batcher`). This makes the landing page appear OP Stack-exclusive, despite SentinAI supporting OP Stack, Arbitrum Nitro, ZK Stack, and standalone L1 nodes.

## Solution

Replace the node graph with a chain-agnostic **pipeline flow visualization** (OBSERVE → DETECT → ANALYZE → ACT). This conveys SentinAI's autonomous loop behavior without referencing any specific chain topology.

## Design

### Animation Sequence

4 stages cycle at 1.5 seconds each (6-second loop). The existing `useEffect` + `setInterval` pattern is preserved.

| Stage | Active Color | Status Message |
|-------|-------------|----------------|
| OBSERVE | `#3B82F6` (blue) | Collecting metrics — block height, gas, tx pool |
| DETECT | `#F59E0B` (amber) | ⚠ Anomaly detected — Z-score 4.2σ |
| ANALYZE | `#22c55e` (green) | 🧠 RCA: L1 RPC rate limit — planning recovery |
| ACT | `#8B5CF6` (purple) | ✓ Recovery complete — switched L1 RPC endpoint |

### Stage Rendering

- **Completed stages:** border `#10FFAA50`, label color `#10FFAA`, sub-text `✓`
- **Active stage:** solid colored border + background tint + pulse dot, `translateY(-2px)` lift
- **Future stages:** `#2a2a2a` border, `#444` text, "waiting" sub-text
- **Arrows between stages:** color of active stage for the arrow leading into it; `#333` for future arrows

### Status Bar

Below the pipeline, a single animated status box updates per stage using `AnimatePresence` (fade + slide — same pattern as current implementation).

### Bottom Stats

Retained unchanged: `Score 63 · TxPool ↑ HIGH · 2 vCPU`

### Removed

- `MiniNode` component (OP Stack node circles)
- `NODE_COLORS` record (chain-specific color map)
- All references to `op-node`, `op-geth`, `batcher`, `l1`

### Retained

- `framer-motion` (`motion.div`, `AnimatePresence`)
- Card structure, width, header, bottom stats
- `STAGE_DURATION = 1500`, `STAGES` array pattern
- `Shield`, `AlertTriangle`, `CheckCircle2`, `Brain` icons in status messages

## Files Changed

| File | Change |
|------|--------|
| `website/src/components/hero-miniature.tsx` | Full rewrite of visual content; logic structure preserved |
