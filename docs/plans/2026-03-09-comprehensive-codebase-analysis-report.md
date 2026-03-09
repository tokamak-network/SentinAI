# SentinAI Codebase Analysis Report Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce a current, code-based analysis report for the SentinAI repository covering product surfaces, APIs, agent logic, and detection/autonomy systems.

**Architecture:** Read runtime entry points first, then trace their dependencies through `src/app`, `src/components`, `src/lib`, and `src/core`. Cross-check implementation claims with tests and existing docs, then synthesize the findings into a single report that distinguishes shipped behavior from design intent.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vitest, Playwright, Node.js

---

### Task 1: Repository inventory

**Files:**
- Modify: `docs/todo.md`
- Create: `docs/plans/2026-03-09-comprehensive-codebase-analysis-report.md`
- Reference: `README.md`
- Reference: `package.json`
- Reference: `docs/guide/architecture.md`

**Step 1: Record the active checklist**

Update `docs/todo.md` with a short dated checklist for this analysis session.

**Step 2: Capture baseline context**

Run:

```bash
sed -n '1,260p' README.md
cat package.json
sed -n '1,260p' docs/guide/architecture.md
```

Expected: enough context to map the advertised product shape against the current implementation.

### Task 2: Frontend and UX surface analysis

**Files:**
- Reference: `src/app/page.tsx`
- Reference: `src/app/v2/page.tsx`
- Reference: `src/app/status/page.tsx`
- Reference: `src/app/connect/page.tsx`
- Reference: `src/app/layout.tsx`
- Reference: `src/app/globals.css`
- Reference: `src/components/*.tsx`

**Step 1: Read page entry points**

Run:

```bash
find src/app -maxdepth 3 -type f | sort
```

Expected: clear list of pages, API routes, and public docs/status surfaces.

**Step 2: Trace major dashboard components**

Read the main page and shared dashboard components to determine what UI is live, what is mocked, and what data contracts the page expects.

### Task 3: Backend, agent, and detection logic analysis

**Files:**
- Reference: `src/lib/*.ts`
- Reference: `src/lib/autonomous/**/*.ts`
- Reference: `src/lib/ops-adapter/**/*.ts`
- Reference: `src/core/**/*.ts`
- Reference: `src/app/api/**/*.ts`

**Step 1: Inspect runtime modules**

Run:

```bash
find src/lib -maxdepth 3 -type f | sort
find src/core -maxdepth 4 -type f | sort
```

Expected: module map for anomaly detection, scaling, AI routing, goal management, MCP, and orchestrated agent flows.

**Step 2: Validate with tests**

Use colocated Vitest files to confirm intended behavior and distinguish tested flows from lightly integrated ones.

### Task 4: Report synthesis

**Files:**
- Create: `docs/reports/2026-03-09-sentinai-codebase-analysis.md`

**Step 1: Write the report**

Document:
- product scope and runtime surfaces
- frontend information architecture
- API grouping and route responsibilities
- `src/lib` business logic responsibilities
- `src/core` agent architecture and protocol abstraction
- testing posture, strengths, and likely risks/gaps

**Step 2: Keep claims code-grounded**

Every important claim should be traceable to a specific file or behavior observed during inspection.

### Task 5: Verification and closeout

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Review the diff**

Run:

```bash
git diff -- docs/todo.md docs/plans/2026-03-09-comprehensive-codebase-analysis-report.md docs/reports/2026-03-09-sentinai-codebase-analysis.md docs/lessons.md
```

Expected: documentation-only diff for the analysis task.

**Step 2: Record reusable lessons**

If any documentation-process lesson emerged while analyzing the repository, add it to `docs/lessons.md`.
