# Marketplace Pricing Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make marketplace pricing runtime behavior consistent by wiring the API and pricing engine to the same store and rejecting invalid pricing payload keys.

**Architecture:** Introduce a lazy default marketplace store initializer so runtime code always resolves a concrete store without manual bootstrapping. Route handlers will call the shared store for reads and writes, and route tests will lock in store-backed behavior plus payload validation.

**Tech Stack:** Next.js App Router, TypeScript, Vitest

---

### Task 1: Record Active Work

**Files:**
- Modify: `docs/todo.md`

**Step 1: Update the active session checklist**

Add a short checklist entry for marketplace pricing findings remediation.

**Step 2: Review the checklist entry**

Confirm the wording is scoped to store wiring, API validation, and verification.

### Task 2: Write Failing Route Regression Tests

**Files:**
- Create: `src/app/api/marketplace/pricing/route.test.ts`

**Step 1: Write failing tests**

Add tests that prove:
- `GET /api/marketplace/pricing` reads from the marketplace store
- `PUT /api/marketplace/pricing` updates through the marketplace store
- `PUT /api/marketplace/pricing` rejects unknown keys with `400`

**Step 2: Run the focused test file**

Run: `npm run test:run -- src/app/api/marketplace/pricing/route.test.ts`

Expected: tests fail because the route still uses in-memory state and accepts unknown keys.

### Task 3: Implement Shared Marketplace Store Wiring

**Files:**
- Modify: `src/lib/marketplace-store.ts`
- Modify: `src/app/api/marketplace/pricing/route.ts`

**Step 1: Add lazy default store resolution**

Make `getMarketplaceStore()` return a shared default `RedisMarketplaceStore` instance when no explicit test override is installed.

**Step 2: Update the pricing route to use the shared store**

Replace in-memory config reads/writes with `getMarketplaceStore().getPricingConfig()` and `getMarketplaceStore().updatePricing(...)`.

**Step 3: Add strict payload-key validation**

Reject request bodies that contain keys outside `traineePrice`, `juniorPrice`, `seniorPrice`, and `expertPrice`.

### Task 4: Verify and Capture Lessons

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Run focused verification**

Run:
- `npm run test:run -- src/app/api/marketplace/pricing/route.test.ts src/lib/__tests__/marketplace-store.test.ts src/lib/__tests__/pricing-engine-marketplace.test.ts src/lib/__tests__/pricing-engine.test.ts`
- `npm run build`

**Step 2: Record outcome**

Update `docs/todo.md` review section and add a reusable lesson about shared persistence paths for configuration APIs.
