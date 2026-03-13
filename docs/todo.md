# TODO: SentinAI Implementation

> Last Updated: 2026-03-06

## Scope Policy (Hot vs Cold)

- Keep this file focused on active execution only.
- Keep `Active` at 5 items or fewer.
- Move completed or parked items to monthly archive files.
- Review and archive at least once per week or on major merge.

## Active (Max 5)

### 0) Abstract Playbook Layer
→ Plan: `docs/plans/2026-03-11-abstract-playbook-layer.md`
→ Depends on: `feat/l1-evm-plugin` (진행 중), proposal-32 (Self-Evolving Playbook)
→ Phase 1–2는 현재 브랜치와 병행 가능. Phase 3 이후 proposal-32 선행 필요.

### 1) Verifiable Accountability Framework (proposal-29)
→ Contract: `docs/contracts/proposal-29-CONTRACT.md`

### 2) Deployment Readiness and Hardening (proposal-30)
→ Contract: `docs/contracts/proposal-30-CONTRACT.md`

### 3) Client Auto-Customization Completion (proposal-31)
→ Contract: `docs/contracts/proposal-31-CONTRACT.md`

### 4) Runtime Verification Stability
- [ ] Keep smoke script coverage on `health + agent-loop + goal-manager + agent-fleet`.
- [ ] Keep `verify-e2e` phase checks aligned with active runtime APIs.

### 5) Docs Context Hygiene
- [x] Audit repository file hygiene and separate source-of-truth paths from regenerable artifacts.
- [x] Remove stale script entries and unreferenced diagnostic scripts from `scripts/`.
- [ ] Keep this file under ~200 lines.
- [ ] Keep `rules/` files focused on reusable rules.
- [ ] Archive monthly snapshots under `docs/archive/`.

## Archive

- Full historical TODO snapshot: `docs/archive/todo-2026-03.md`
- Older archived docs: `docs/archive/`

## Review (2026-03-06)

- Repository hygiene audit completed: documented keep/archive/remove paths, restored `docs/lessons.md`, and removed tracked junk artifacts.
- Scripts cleanup completed: removed dead `prod:gate:tier2` entry and deleted unused provider-diagnostic utilities.

## Session Checklist (2026-03-09)

### Comprehensive Codebase Analysis Report

- [x] Inventory current docs, app routes, and runtime entry points.
- [x] Analyze landing page, dashboard surfaces, and shared UI components.
- [x] Analyze API routes plus `src/lib` and `src/core` agent/detection/autonomy flows.
- [x] Write a code-based report under `docs/`.
- [x] Review the resulting diff for documentation-only changes.

### Report Localization

- [x] Convert the analysis report narrative and section labels into natural Korean while keeping code identifiers unchanged.

### Follow-up Decisions

- [x] Reflect the chosen follow-up direction in the report: Redis Streams for Agent V2 events, remove docs search, defer chain/plugin convergence.

### Redis Streams Design + Docs Search Removal

- [x] Write an implementation plan covering the Redis Streams EventBus design document and docs search removal.
- [x] Add a failing regression test proving docs pages should not render docs search UI.
- [x] Remove docs search UI/component usage from the docs page and keep docs navigation intact.
- [x] Write the Redis Streams EventBus design document under `docs/plans/`.
- [x] Run focused verification and review the resulting diff.

## Session Checklist (2026-03-11)

### Agent Economy Docs Review

- [x] Review agent economy design, scenarios, and implementation-plan docs under `docs/superpowers/`.
- [x] Remove `txpool` as a marketplace product due to abuse potential.
- [x] Replace the lead DeFi-facing product with `sequencer-health`.
- [x] Add `incident-summary` and `batch-submission-status` as agent-friendly marketplace products.
- [x] Refresh the implementation plan to match the revised marketplace surface.

## Review (2026-03-11)

- Agent economy docs were updated to prioritize high-demand, low-abuse operational signals over order-flow-adjacent data.
- `sequencer-health` is now the primary DeFi-facing marketplace product, with a documented response schema for direct agent consumption.
- Scenario and implementation-plan docs were rewritten to remove `txpool` and add `incident-summary` plus `batch-submission-status`.

### TON x402 Facilitator Design

- [x] Define a TON settlement approach that works without EIP-3009 and without token contract upgrades.
- [x] Choose approval-based pull facilitator as the Phase 1 settlement model.
- [x] Write facilitator design and implementation plan docs under `docs/plans/`.
- [x] Add Korean versions of the TON facilitator design and implementation plan docs.

### Marketplace Pricing Findings Remediation

- [x] Add route regression tests proving `/api/marketplace/pricing` uses the shared marketplace store.
- [x] Wire pricing route reads/writes through `MarketplaceStore` instead of module-local in-memory state.
- [x] Reject unknown pricing keys in API payload validation.
- [x] Re-run focused pricing tests and production build after the fix.

## Review (2026-03-11, TON Facilitator)

- Designed a TON-specific x402 settlement path using ERC-20 `approve + transferFrom` with facilitator-side EIP-712 authorization checks.
- Captured the buyer, merchant, facilitator, nonce, receipt-signing, and mainnet/sepolia profile model in a dedicated design doc.
- Wrote a concrete implementation plan covering typed data, nonce store, settlement executor, facilitator HTTP API, and merchant integration.
- Constrained Phase 1 deployment to a same-app facilitator model with internal routes and explicit internal auth boundaries.
- Added explicit on-chain settlement verification and reconciliation requirements to the facilitator design and plan.
- Added Korean companion docs for the TON facilitator design and implementation plan.

## Review (2026-03-11, Marketplace Pricing Findings)

- Added route-level regression tests for `/api/marketplace/pricing` covering shared store reads, shared store writes, unknown-key rejection, and OPTIONS behavior.
- Replaced module-local pricing state with shared `MarketplaceStore` access so the pricing API and pricing engine now resolve the same persistence path.
- Added strict request-key validation for pricing updates and re-verified focused pricing tests plus production build.

## Session Checklist (2026-03-12)

### TON x402 Facilitator Plan Review

- [x] Review `docs/plans/2026-03-11-ton-x402-facilitator.md` for implementation readiness.
- [x] Review `docs/plans/2026-03-11-ton-x402-facilitator-design.md` for implementation readiness.
- [x] Summarize blockers, ambiguities, and missing verification detail for direct Codex execution.

### TON x402 Facilitator Implementation Batch 1

- [x] Add failing tests for facilitator config loading.
- [x] Add failing tests for typed-data domain/resource canonicalization.
- [x] Add failing tests for payment authorization verification.
- [x] Implement minimal code for Tasks 1-3 and verify the focused test suite.

### TON x402 Facilitator Implementation Batch 2

- [x] Add failing tests for nonce replay protection.
- [x] Add failing tests for settlement store persistence and pending index updates.
- [x] Add failing tests for buyer balance and allowance checks.
- [x] Implement minimal code for Tasks 4-6 and verify the combined focused facilitator suite.

### TON x402 Facilitator Implementation Batch 3

- [x] Add failing tests for transfer submission, on-chain verification, and detached receipt signing.
- [x] Implement minimal code for Tasks 7-9.
- [x] Verify the combined focused facilitator suite through Task 9.

### TON x402 Facilitator Implementation Batch 4

- [x] Add failing tests for facilitator routes, reconciliation, and the reconcile runner.
- [x] Implement minimal code for Tasks 10-12.
- [x] Verify the combined focused facilitator suite through Task 12.

### TON x402 Facilitator Implementation Batch 5

- [x] Add failing tests for merchant-side facilitator client behavior.
- [x] Implement merchant-side x402 facilitator integration and environment/spec updates.
- [x] Re-run focused facilitator tests, `npm run lint`, and `npm run build` after integration fixes.

### TON x402 Facilitator Smoke Script

- [x] Add failing tests for smoke env validation and x402 payment-header assembly.
- [x] Implement a live Sepolia smoke script for allowance check, authorization signing, facilitator settlement, and settlement polling.
- [x] Document smoke env knobs in `.env.local.sample` and verify focused tests plus production build.

### TON Buyer-Facing 402 Surface

- [x] Add failing tests for a protected buyer-facing marketplace route that returns x402 payment requirements.
- [x] Implement `/api/marketplace/sequencer-health` with `402 Payment Required` requirements and paid-response verification via the facilitator.
- [x] Verify the protected route with focused tests plus fresh `lint` and `build`.

### TON Facilitator Testing Guide

- [x] Write a testing scenarios and operator guide for the TON facilitator flow without executing live Sepolia tests yet.
- [x] Capture preconditions, happy path, negative scenarios, and result-recording guidance for later execution.

### TON Marketplace Product Registry

- [x] Add failing tests for a canonical paid product registry and route enforcement against allowlist drift.
- [x] Implement a marketplace product registry and move `sequencer-health` route/payment metadata to registry-backed source-of-truth definitions.
- [x] Re-run focused registry/facilitator tests plus fresh `lint` and `build`.

### TON Protected Product Expansion

- [x] Extend the product registry with `incident-summary` and `batch-submission-status`.
- [x] Add buyer-facing protected routes for both products using the shared paid-route handler.
- [x] Re-run focused marketplace/facilitator tests plus fresh `lint` and `build`.

### TON Product Runtime Overrides

- [x] Add failing tests for runtime product overrides while preserving canonical registry identity.
- [x] Implement env-driven override resolution for marketplace product `amount` and `merchant` values.
- [x] Re-run focused marketplace/facilitator tests plus fresh `lint` and `build`.

## Review (2026-03-12, TON Facilitator Implementation)

- Implemented the facilitator payment path end to end: typed authorization verification, nonce replay protection, settlement persistence, relayed `transferFrom`, detached receipt signing, reconciliation, and internal HTTP routes.
- Added merchant-side facilitator settlement verification and wired the x402 middleware path to consume facilitator receipts.
- Updated environment samples and agent-economy specs so the documented TON flow now matches the implemented facilitator-based settlement model.
- Fixed two verification-found regressions before closeout: ioredis `set(..., 'EXAT', ts, 'NX')` overload ordering and the NLOps panel auto-open pattern that violated the current React lint rule.
- Added `scripts/smoke-ton-facilitator.ts` plus smoke helpers so Sepolia settlement can now be exercised with one command against a live local app instance.
- Added the first buyer-facing protected product route, `/api/marketplace/sequencer-health`, so external agents can now discover spender/domain metadata through a concrete `402 Payment Required` response.
- Added a dedicated testing guide documenting how to validate the TON facilitator flow later without conflating documentation readiness with live Sepolia execution.
- Added a marketplace product registry so product metadata now drives the buyer-facing route while merchant allowlist remains the enforcement layer for registry drift.
- Expanded the protected marketplace surface to `incident-summary` and `batch-submission-status` using the same registry-backed x402 route pattern as `sequencer-health`.
- Added runtime overrides for product `amount` and `merchant` so operators can adjust pricing and payout addresses without changing canonical product identity or route/resource contracts.
