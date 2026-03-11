# EventBus Redis Streams Design And Docs Search Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define the Redis Streams direction for Agent V2 event delivery and remove the misleading docs search UI from the docs surface.

**Architecture:** Keep runtime changes small in this pass. The EventBus work produces a concrete design document describing stream topology, consumer groups, delivery semantics, and migration steps. The docs surface change removes `DocSearch` from the docs page entirely, leaving the filesystem-backed docs viewer, static sidebar, and table of contents intact.

**Tech Stack:** Next.js App Router, React server components, Vitest, TypeScript, Redis Streams design

---

### Task 1: Plan And Regression Test For Docs Search Removal

**Files:**
- Modify: `docs/todo.md`
- Create: `src/app/docs/docs-page.test.ts`
- Modify: `src/app/docs/[[...slug]]/page.tsx`

**Step 1: Write the failing test**

Add a Vitest test that imports `@/app/docs/[[...slug]]/page`, mocks `fs/promises`, `next/link`, `next/navigation`, `@/components/DocsSidebar`, `@/components/MarkdownRenderer`, and `@/components/TableOfContents`, then asserts the rendered element tree does not include `DocSearch`.

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/docs/docs-page.test.ts`
Expected: FAIL because the docs page still renders `DocSearch`.

**Step 3: Write minimal implementation**

Remove the `DocSearch` import and the docs search UI from `src/app/docs/[[...slug]]/page.tsx`, preserving the title, relative path, docs article, sidebar, table of contents, and return link.

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/docs/docs-page.test.ts`
Expected: PASS.

### Task 2: Remove Dead Docs Search Surface

**Files:**
- Delete: `src/components/DocSearch.tsx`

**Step 1: Confirm the component is now unused**

Run: `rg -n "DocSearch" src`
Expected: only historical references in tests or none at all.

**Step 2: Delete the unused component**

Remove the file once there are no runtime imports left.

**Step 3: Run focused verification**

Run: `npm run test:run -- src/app/docs/docs-page.test.ts`
Expected: PASS and no references to `DocSearch` remain in runtime code.

### Task 3: Redis Streams EventBus Design Document

**Files:**
- Create: `docs/plans/2026-03-09-agent-v2-redis-streams-design.md`

**Step 1: Capture current-state constraints**

Describe the current process-local `AgentEventBus`, which agents publish and consume each event type, and which downstream guarantees are currently missing.

**Step 2: Define target Redis Streams design**

Specify:
- stream keys and naming
- event envelope
- consumer group model by agent role
- ack/retry/dead-letter behavior
- ordering and idempotency expectations
- observability and replay strategy

**Step 3: Define migration plan**

Document phased rollout from in-process EventEmitter to Redis Streams-backed delivery, including compatibility mode and rollback strategy.

### Task 4: Final Verification And Documentation Hygiene

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Mark checklist progress**

Update `docs/todo.md` to reflect completed plan, test, implementation, and verification steps.

**Step 2: Record reusable lesson**

Add a concise rule to `docs/lessons.md` covering misleading UI affordances and architecture decisions captured as explicit design docs.

**Step 3: Run final verification**

Run:
- `npm run test:run -- src/app/docs/docs-page.test.ts`
- `npm run lint -- src/app/docs/[[...slug]]/page.tsx src/components`

Expected:
- docs page regression test passes
- lint exits clean for touched app/component files

**Step 4: Review the diff**

Run: `git diff -- docs/todo.md docs/lessons.md docs/plans/2026-03-09-eventbus-redis-streams-and-docs-search-removal.md docs/plans/2026-03-09-agent-v2-redis-streams-design.md src/app/docs/docs-page.test.ts src/app/docs/[[...slug]]/page.tsx src/components/DocSearch.tsx`
Expected: only the intended docs/design/test/UI removal changes appear.
