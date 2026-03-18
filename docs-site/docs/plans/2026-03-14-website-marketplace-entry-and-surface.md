# Website Marketplace Entry And Surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a relative `/marketplace` public surface to the `website` app so the live Vercel landing page can navigate to a working marketplace route.

**Architecture:** Keep the root app as the richer marketplace runtime, but add a lightweight public marketplace implementation inside `website` so the live landing deployment has a real `/marketplace` route, local catalog/manifest discovery, and non-dead buyer-facing product endpoints. Reuse the visual language of the existing root marketplace page without importing runtime-heavy root dependencies.

**Tech Stack:** Next.js App Router (`website` app), TypeScript, Playwright

---

### Task 1: Add failing website navigation coverage

**Files:**
- Modify: `website/e2e/landing-page.spec.ts`
- Create: `website/e2e/marketplace-page.spec.ts`

**Step 1: Write the failing test**

Add assertions that the landing navbar shows `MARKETPLACE` and that `/marketplace` renders expected public marketplace content.

**Step 2: Run test to verify it fails**

Run:
```bash
cd website
npx playwright test e2e/landing-page.spec.ts e2e/marketplace-page.spec.ts
```

Expected: FAIL because `website` currently has no marketplace nav item or route.

### Task 2: Add website marketplace route and local public APIs

**Files:**
- Create: `website/src/app/marketplace/page.tsx`
- Create: `website/src/app/api/agent-marketplace/catalog/route.ts`
- Create: `website/src/app/api/agent-marketplace/agent.json/route.ts`
- Create: `website/src/app/api/agent-marketplace/sequencer-health/route.ts`
- Create: `website/src/app/api/agent-marketplace/incident-summary/route.ts`
- Create: `website/src/app/api/agent-marketplace/batch-submission-status/route.ts`
- Create: `website/src/lib/agent-marketplace.ts`
- Modify: `website/src/app/page.tsx`

**Step 1: Add minimal shared marketplace data helpers**

Define static public catalog, manifest projection, price formatting, and payment-required helpers in one `website`-local lib file.

**Step 2: Add the page**

Create a query-tab marketplace page with `registry`, `instance`, `guide`, and `sandbox` tabs using the `website` local catalog.

**Step 3: Add buyer-facing API routes**

Implement catalog and agent manifest responses plus three paid product endpoints that return `402` without `x-payment` and a stub success payload when a payment header is present.

**Step 4: Add landing entry points**

Add `MARKETPLACE` to the landing navbar and one hero CTA link to `/marketplace`.

### Task 3: Verify website app behavior

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Run focused verification**

Run:
```bash
cd website
npx playwright test e2e/landing-page.spec.ts e2e/marketplace-page.spec.ts
npm run build
```

Expected:
- Playwright specs PASS
- website build PASS

**Step 2: Record outcome**

Mark the checklist complete and capture any reusable deployment-surface lesson.
