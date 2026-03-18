# Home Marketplace Entry + Build Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public `/marketplace` entry point from the home page and fix the current marketplace page type error so the app builds again.

**Architecture:** Keep the change narrow. Add one marketplace link in the home header plus one hero CTA to `/marketplace`, then fix the marketplace sample payment-envelope assembly so it uses the actual service payment shape instead of non-existent manifest fields. Cover the change with a new home-page regression test and existing marketplace page tests.

**Tech Stack:** Next.js App Router, React, Vitest

---

### Task 1: Add a home-page regression test

**Files:**
- Create: `src/app/page.test.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Write the failing test**

Assert that the rendered home page includes a `MARKETPLACE` navigation link and a hero CTA pointing to `/marketplace`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/page.test.tsx`
Expected: FAIL because the current home page does not render marketplace links.

**Step 3: Write minimal implementation**

Add the marketplace links in the home page header and hero CTA.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/page.test.tsx`
Expected: PASS

### Task 2: Fix marketplace page rendering/build typing

**Files:**
- Modify: `src/app/marketplace/page.tsx`
- Test: `src/app/marketplace/page.test.ts`

**Step 1: Write or use failing regression coverage**

Use the existing marketplace page test file as the behavioral guard for rendering, then reproduce the production build failure.

**Step 2: Run verification to confirm the failure**

Run: `npm run build`
Expected: FAIL with a type error around `manifest.payment.scheme` on the marketplace page.

**Step 3: Write minimal implementation**

Build the sample x-payment envelope from `sandboxService.payment` fields instead of manifest-only fields that do not exist.

**Step 4: Run tests to verify page behavior stays green**

Run: `npx vitest run src/app/marketplace/page.test.ts`
Expected: PASS

### Task 3: Verify end-to-end for this change

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Run focused verification**

Run:
```bash
npx vitest run src/app/page.test.tsx src/app/marketplace/page.test.ts
npm run build
```

Expected:
- all tests PASS
- Next.js production build PASS

**Step 2: Record outcome**

Mark the checklist complete and capture one reusable lesson if needed.
