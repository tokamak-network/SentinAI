# Autonomy Pipeline 3D Visualization Design

**Date**: 2026-03-03
**Status**: Approved
**Purpose**: Demo + Operations dual-use visualization of SentinAI's autonomous operation pipeline

## Overview

Replace the existing Autonomy Cockpit panel in `page.tsx` (~lines 1762-2096) with an animated 3D pipeline visualization that shows the full autonomous operation lifecycle: Signal → Goal → Plan → Execute → Verify → (Rollback).

## Approach

**CSS 3D + Framer Motion** — lightweight 3D perspective pipeline with particle flow animations. Balances visual impact with text readability and operational utility.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Autonomy Pipeline                    [A3 ▾] [Seed ▾] [⟳]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌── 3D Pipeline Stage (perspective: 1200px) ──────────────┐│
│  │  rotateX(12deg)                                         ││
│  │                                                         ││
│  │  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐ ││
│  │  │Signal│══▶│ Goal │══▶│ Plan │══▶│  Act │══▶│Verify│ ││
│  │  │ 7src │   │queue3│   │5steps│   │ step2│   │ 3/5  │ ││
│  │  └──────┘   └──────┘   └──────┘   └──────┘   └──────┘ ││
│  │                                                         ││
│  │  ←←← Rollback (red particles, reverse flow) ←←←        ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌── Detail Panel ─────────────────────────────────────────┐│
│  │  [Active stage details: steps, checks, logs]             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 3D Effects

1. **Perspective**: `perspective: 1200px` + `rotateX(12deg)` on pipeline container
2. **Card depth**: Each stage card has `translateZ(20px)` + layered box-shadow
3. **Active glow**: Current stage pulses with `0 0 30px <color>` + scale 1.05
4. **Particle flow**: Small circles animate along connector lines between stages
5. **Rollback**: Reverse red particles + cards transition through red → orange → idle

## Stage Card States

| State | Glow Color | Animation | Card Style |
|-------|-----------|-----------|------------|
| idle | none | none | `opacity: 0.5`, gray border |
| waiting | faint blue | slow pulse | translucent, dashed border |
| active | cyan | medium pulse | full opacity, solid glow |
| executing | bright green | fast pulse + spinner | strong glow, scale 1.05 |
| success | green | checkmark pop | green border, fades to idle |
| failed | red | shake | red border + warning icon |
| rollback | orange | reverse particles | orange glow, reverse spin |

## Animation Scenarios

### 1) New Goal Generated
- Signal card glow activates → particles emit
- 0.5s delay → Goal card "pop in" (scale: 0→1.05→1.0)
- Goal card interior: intent text fade-in

### 2) Plan Created
- Goal→Plan particles accelerate
- Plan card glow activates
- Step count animates up (0→N)
- Detail Panel: Plan Steps list slides in

### 3) Execution In Progress
- Act card enters "executing" state (green glow + spinner)
- Progress indicator (step N/M)
- Each step completion: mini checkmark pop
- Detail Panel: current step info updates in real-time

### 4) Verification
- Verify card activates
- Check items tick one by one (✓ N/M)
- All PASS: green flash + subtle confetti
- FAIL: red shake → triggers rollback

### 5) Rollback
- Verify card red flash
- Bottom reverse lane activates
- Red particles flow Verify → Act → Plan direction
- Affected cards: sequential red → orange → idle transition
- Completion: full pipeline reset

### Idle State (No Active Goal)
- All cards `opacity: 0.4`, dark tone
- Signal card only: faint cyan pulse (monitoring active)
- Very slow, dim particles on connectors (system alive indicator)
- Detail Panel: "Waiting for signals..." text

## Component Architecture

```
src/components/autonomy/
├── AutonomyPipeline.tsx          # Top-level container (data fetching + state)
├── PipelineStage.tsx             # Individual stage card (3D transform + glow)
├── PipelineConnector.tsx         # Stage-to-stage connector + particles
├── PipelineParticle.tsx          # Individual particle component
├── StageDetailPanel.tsx          # Bottom detail information panel
├── RollbackOverlay.tsx           # Rollback reverse lane overlay
├── AutonomyControls.tsx          # Top controls (Autonomy Level, Seed, Refresh)
└── hooks/
    └── useAutonomyState.ts       # Autonomy state hook (polling + state machine)
```

## State Machine

```typescript
type PipelinePhase =
  | 'idle'              // Waiting
  | 'signal_collecting' // Collecting signals
  | 'goal_generating'   // Generating goal candidates
  | 'goal_queued'       // Goal entered queue
  | 'planning'          // Creating plan
  | 'executing'         // Executing (step N/M)
  | 'verifying'         // Verifying
  | 'completed'         // Success
  | 'failed'            // Failed
  | 'rolling_back'      // Rollback in progress

interface PipelineState {
  phase: PipelinePhase;
  currentGoal?: GoalSummary;
  currentPlan?: PlanSummary;
  executionProgress?: { current: number; total: number; currentStep: string };
  verificationResult?: { passed: number; total: number; status: 'pass' | 'fail' };
  rollbackProgress?: { current: number; total: number };
  history: PipelineEvent[];  // Recent event log (max 20)
}
```

## Data Sources

| API Endpoint | Polling Interval | Mapped State |
|-------------|-----------------|-------------|
| `GET /api/goal-manager` | 5s | signal count, queue state, candidates |
| `GET /api/agent-loop` | 5s | phase, goalManager.dispatched |
| `GET /api/agent-decisions` | 10s | recent execution history |
| `POST /api/autonomous/plan` | on demand | planId, steps |
| `POST /api/autonomous/execute` | on demand | operationId, step progress |
| `POST /api/autonomous/verify` | on demand | verification checks |

## Integration with page.tsx

```typescript
// Replace Autonomy Cockpit section (~lines 1762-2096):
<AutonomyPipeline
  autonomyLevel={autonomyPolicy?.level}
  onAutonomyLevelChange={handleAutonomyLevelChange}
  onSeedAction={handleSeedAction}
/>
```

## Dependencies

- **New**: `framer-motion` (~33KB gzipped)
- **Existing**: Tailwind CSS 4, React 19, Next.js 16

## Performance Constraints

- Max 12 simultaneous particles (3 per connector × 4 connectors)
- `will-change: transform` on 3D-transformed cards for GPU acceleration
- `motion.div` lazy mount: particles not rendered in idle state
- `AnimatePresence` for clean exit animations + DOM cleanup
- Existing `AbortController` polling pattern preserved

## Accessibility

- `prefers-reduced-motion`: disable particle animations, use instant transitions
- All stage information available as text (not animation-dependent)
- Keyboard navigable controls

## Mobile

- Reduce perspective on small screens or fall back to 2D layout
- Media query: `@media (max-width: 768px)` → `rotateX(0)`, stacked vertical layout

## Demo Mode Integration

- `seed-spike` → Signal card activates → simulates Goal generation flow
- `goal-tick` + `goal-dispatch` → Pipeline progresses to Planning → Executing
- `autonomous-plan/execute/verify/rollback` → Direct jump to corresponding stage
