# TODO: SentinAI Implementation

> Last Updated: 2026-03-13

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

### Agent Marketplace Greenfield Build
→ Plan: `docs/plans/2026-03-12-agent-marketplace.md`
→ Principle: 기존 subscription pricing/marketplace prototype와 완전 분리된 독립 도메인으로 구현.
→ MVP: `sequencer-health`, `incident-summary`, `batch-submission-status`
→ Current: `BROWSE REGISTRY` live discovery에 query-driven pagination을 추가 중.

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

### Agent Marketplace Planning

- [x] Review agent economy, scenarios, and reputation/SLA docs under `docs/superpowers/`.
- [x] Confirm the marketplace will be developed as a greenfield domain unrelated to subscription pricing.
- [x] Write a standalone execution plan under `docs/plans/`.

### Agent Marketplace Execution

- [x] Add isolated `agent-marketplace` domain types, catalog, and public catalog route.
- [x] Add generic x402 middleware plus payment verifier with `open/stub/facilitated` modes.
- [x] Implement MVP paid products: `sequencer-health`, `incident-summary`, `batch-submission-status`.
- [x] Add request logging, rate limiting, and SLA aggregation.
- [x] Add `agent.json` metadata publishing and guarded ERC-8004 bootstrap hooks.
- [x] Add reputation batch export boundary for later on-chain anchoring.
- [x] Move agent marketplace reputation score persistence to Redis with fail-closed behavior.
- [x] Build `/v2/marketplace` ops console, dispute review UI, and canonical ABI assets.
- [x] Link `/v2/marketplace` into the existing `/v2` navigation.
- [x] Replace the legacy `/marketplace` pricing editor with the public agent marketplace surface.
- [x] Turn `/marketplace` into a query-driven tab UI for `registry`, `instance`, and `guide`.
- [x] Write the ERC-8004 registry deployment scope design for Phase 1 marketplace discovery.
- [x] Write the minimal ERC-8004 registry contract spec and deployment alignment plan.
- [x] Add a Phase 1 ERC-8004 registry Solidity draft to the repository.
- [x] Add a Foundry workspace and contract tests for the ERC-8004 registry draft.
- [x] Align the app registry ABI module to the canonical `AgentRegistered(agentId, agent, agentURI)` shape.
- [x] Add a Foundry deployment script for the Phase 1 ERC-8004 registry.
- [x] Write the ERC-8004 registry testing scenarios and deferred execution guide.
- [x] Add `/v2/marketplace` drill-down panels for dispute detail and last batch detail.
- [x] Add `/v2/marketplace` dispute action controls with reviewer metadata and form-based status updates.
- [x] Add Redis-backed reputation batch history persistence and show recent batch history in `/v2/marketplace`.

### TON x402 Facilitator Plan Review

- [x] Review `docs/plans/2026-03-11-ton-x402-facilitator.md` for implementation readiness.
- [x] Review `docs/plans/2026-03-11-ton-x402-facilitator-design.md` for implementation readiness.
- [x] Summarize blockers, ambiguities, and missing verification detail for direct Codex execution.

### TON x402 Facilitator Korean Docs Hardening

- [x] Promote the Korean design doc to explicit Phase 1 source of truth.
- [x] Add settlement store, merchant allowlist, internal auth, receipt format, and reconciler execution details.
- [x] Expand the Korean implementation plan with missing store/runner tasks and concrete env/runtime assumptions.

### TON x402 Facilitator English Sync

- [x] Sync the English design doc to the hardened Korean facilitator design.
- [x] Sync the English implementation plan to the hardened Korean facilitator plan.
- [x] Keep the English docs aligned with the same execution baseline and runtime assumptions.

### TON x402 Buyer Guide

- [x] Write an external buyer integration guide for the TON x402 facilitator flow.
- [x] Document the `402 -> approve -> EIP-712 sign -> X-PAYMENT retry -> receipt verify` sequence with concrete payload examples.
- [x] Capture the minimum validation and security checks a buyer SDK must perform.
- [x] Add a concrete TypeScript buyer example that shows `fetchPaymentRequirements`, `ensureAllowance`, `buildPaymentHeader`, and paid-resource retry flow.

### TON x402 Hardening Runbook

- [x] Write an operator hardening runbook for TON facilitator deployment.
- [x] Document relayer/receipt key separation and rotation procedures.
- [x] Capture rate-limit, audit-log, reconciliation, and failed-settlement response policies.

### TON x402 Live-Smoke Alignment

- [x] Run live Sepolia smoke against the TON facilitator flow.
- [x] Record the runtime constraint discovered from the real-chain result.
- [x] Update design, plan, buyer guide, testing guide, and hardening docs to reflect the live-smoke constraint.

### TON x402 Runtime Guardrails

- [x] Add fail-closed runtime validation that current TON Phase 1 merchant addresses match the facilitator relayer/spender.
- [x] Cover the config loader, settle route, and buyer-facing paid route with regression tests for merchant/spender drift.

### Lint Cleanup

- [x] Remove the current source-level ESLint warnings from dashboard, API, and test files.
- [x] Stabilize the NLOps chat auto-open path so React hook lint passes without effect-time sync state updates.
- [x] Ignore nested `.worktrees/**` from root ESLint runs and re-verify `lint` plus production `build`.

## Review (2026-03-12, TON Facilitator Docs)

- Strengthened the Korean TON facilitator design doc so it now fixes the Phase 1 source of truth, internal auth contract, canonical resource rules, settlement Redis schema, merchant allowlist source, and reconciler execution model.
- Expanded the Korean implementation plan with missing `settlement-store` and `reconcile-runner` tasks, explicit detached receipt signing rules, and stronger route/runtime prerequisites.
- Synced the English TON facilitator design and implementation plan to the same Phase 1 baseline so the Korean and English docs now describe the same settlement store, receipt format, internal auth, reconciler model, and execution order.
- Added a buyer integration guide that documents how an external agent should validate `402` terms, approve the facilitator spender, sign `PaymentAuthorization`, retry with `X-PAYMENT`, and verify the resulting settlement receipt.
- Extended the buyer guide with a concrete TypeScript example so integrators can copy the minimal `402 -> allowance -> sign -> retry` flow without reverse-engineering the payload contract.
- Added a TON facilitator hardening runbook that fixes minimum operator policy for key management, rotation, rate limits, audit logs, reconciliation monitoring, and failed settlement handling before live rollout.
- Cleared the current root ESLint warning set from touched files, fixed the NLOps panel auto-open implementation to satisfy React lint, and excluded nested `.worktrees/**` so root lint only evaluates this repository's source tree.

## Review (2026-03-13, TON Facilitator Live Smoke)

- Live Sepolia smoke proved the TON facilitator flow works end to end only when `merchant == relayer == spender` for the current token behavior.
- The `merchant != relayer` configuration failed on-chain with `SeigToken: only sender or recipient can transfer`, so Phase 1 docs now treat merchant/relayer separation as unsupported.
- Updated the English/Korean facilitator design and plan docs, buyer guide, testing guide, and hardening runbook to align with the verified runtime constraint and the successful settlement result in block `10438414`.

## Review (2026-03-13, TON Facilitator Runtime Guardrails)

- Added fail-closed validation so config loading now rejects allowlist entries that do not match the facilitator spender for the configured TON network.
- Added runtime checks in the buyer-facing paid route and internal settle route so merchant/spender drift cannot silently survive mocked config or product overrides.
- Locked the behavior with regression tests covering config drift, settle-route drift, and buyer-facing `402` generation drift.

## Review (2026-03-12, Agent Marketplace Plan)

- Captured the agent marketplace as a greenfield product that does not share types, pricing, or storage with the subscription pricing prototype.
- Prioritized the build around a generic x402 purchase flow plus three low-abuse operational products: `sequencer-health`, `incident-summary`, and `batch-submission-status`.
- Deferred ERC-8004 self-registration and on-chain reputation anchoring until after the paid request flow and off-chain SLA logging are verified.

## Review (2026-03-12, Agent Marketplace Execution)

- Implemented the standalone `agent-marketplace` domain under new `src/types`, `src/lib`, and `src/app/api` namespaces without touching the legacy subscription pricing prototype.
- Added a reusable x402 boundary and payment verifier so future paid products can stay as thin route wrappers.
- Shipped the first three MVP paid products with focused Vitest coverage and verified the new file set with targeted ESLint checks.
- Added request logging, agent/service scoped rate limiting, and off-chain SLA aggregation on top of the x402 boundary for immediate operational trust signals.
- Published `/api/agent-marketplace/agent.json` metadata and wired a guarded marketplace registration hook into bootstrap so registration failure stays warning-only.
- Added deterministic `keccak256`-based reputation batch export with clamped scores, Merkle-ready root generation, and per-agent proofs for later on-chain anchoring.
- Added route-level tests for all paid marketplace endpoints and verified the production build now includes the full `/api/agent-marketplace/*` surface.
- Replaced the ERC-8004 registration stub with a real viem `writeContract(register(agentURI))` path and documented deployment/verification steps in an agent marketplace operations runbook.
- Implemented IPFS batch publishing, `submitMerkleRoot` on-chain submission, and a daily reputation job orchestration boundary tied to SLA summaries.

## Session Checklist (2026-03-13)

### SentinAI Marketplace Relationship Diagram HTML

- [x] Confirm the diagram scope is SentinAI selling operational API and agent services through the marketplace.
- [x] Define a three-diagram structure: relationship map, sales flow, reverse-case scenario.
- [x] Add a standalone HTML document under `docs/` that renders the diagrams with Mermaid.
- [x] Keep the page self-explanatory with short captions and presentation-friendly styling.
- [x] Verify the generated HTML structure and asset references.

### Home Marketplace Entry + Build Fix

- [x] Confirm the home page currently lacks a marketplace entry point.
- [x] Scope this change to the public buyer surface at `/marketplace`, not the operator console.
- [x] Add failing regression tests for a home-page marketplace link and for marketplace page rendering.
- [x] Add a marketplace entry in the home navigation and hero CTA.
- [x] Fix the current `/marketplace` page type error so production build can pass again.
- [x] Re-run focused tests and production build.

## Review (2026-03-13, Marketplace Diagram HTML)

- Added a standalone Mermaid HTML explainer for the SentinAI marketplace relationship, seller-side purchase flow, and reverse procurement scenario.
- Kept the document presentation-friendly so it can be opened directly from the repository without wiring it into the app.
- Expanded the diagram narrative so ERC-8004 registry registration, discovery metadata, and x402 payment plus settlement are visible as first-class parts of the flow.
- Added a public marketplace entry point to the home dashboard shell and restored a passing production build so `/marketplace` and `/v2/marketplace` are present in the generated route manifest again.
- Added event-log parsing for registry/root submission receipts and wired a scheduler-gated daily reputation publish cron into the main runtime scheduler.
- Added an in-process reputation score store so daily reputation batches can reuse the latest published scores when explicit `previousScores` input is omitted.
- Replaced the in-process reputation score store with a Redis-backed fail-closed store so daily reputation publishing now stops on missing `REDIS_URL` or Redis read/write failures instead of resetting or falling back silently.
- Replaced the in-memory marketplace request log with a Redis-backed source of truth so x402 request auditing and SLA summaries now survive process restarts.
- Fixed the scheduler reputation cron so it no longer overrides `previousScores` with `{}`, allowing Redis-backed score continuity to apply on real daily runs.
- Hardened registry/reputation receipt parsing to support alternate documented event signatures before falling back to `txHash` or input values.
- Aligned the old marketplace wireframe with the implemented `agent-marketplace` backend and wrote follow-up design/plan docs for `/v2/marketplace` ops, dispute review, and canonical ABI assets.
- Added `ops/summary`, `ops/disputes`, and `ops/contracts` APIs plus a server-rendered `/v2/marketplace` console that follows the wireframe layout while using the current `agent-marketplace` backend.
- Added a Redis-backed dispute review store with explicit status transitions and surfaced dispute / contract ABI state in the new ops page.
- Linked the existing `/v2` dashboard shell into `/v2/marketplace` so the new ops console is reachable from the current runtime navigation.
- Replaced the legacy `/marketplace` pricing editor with a public wireframe-aligned marketplace surface backed by the live agent catalog, manifest, and contract metadata.
- Switched the public `/marketplace` surface from a long static page to a query-driven tab model so `registry`, `instance`, and `guide` now render as distinct deep-linkable views.
- Added a Phase 1 Solidity draft for the ERC-8004 registry so deployment work can proceed from a repository-tracked canonical contract shape even before a dedicated contract workspace is set up.
- Replaced the public `BROWSE REGISTRY` placeholder with live ERC-8004 event-scan discovery that deduplicates to the latest operator registration and fetches each discovered `agent.json`.
- Added a 30-second runtime cache to registry browse so repeated public loads do not rescan the registry and refetch manifests on every request.
- Added query-driven pagination to `BROWSE REGISTRY` with a fixed page size of 5 while keeping cache on the full discovered registry set.

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
- Added query-driven drill-down UI to `/v2/marketplace` so operators can inspect selected dispute metadata and the latest batch detail without leaving the ops console.
- Extended `/v2/marketplace` dispute review from read-only detail into a form-driven action panel with `status`, `reviewed by`, and `reviewer note`, backed by a redirecting POST handler for simple server-rendered operations.
- Added a Redis-backed reputation batch history store, recorded success and failure publish attempts from the daily job, and surfaced the latest five batch records in `/v2/marketplace`.
- Extended `/v2/marketplace` batch drill-down with `?batch=<publishedAt>` deep links so operators can select failed or historical batches directly from the history list.
- Added `GET /api/agent-marketplace/ops/batches` so recent batch history can be reused outside the `/v2/marketplace` page with bounded `limit` queries.
- Extended disputes with append-only review history so status transitions now keep `fromStatus`, `toStatus`, reviewer metadata, and timestamps, and surfaced that trail in `/v2/marketplace`.
- Added a Korean developer spec for the deployed `SentinAIERC8004Registry`, including Sepolia address, ABI, event semantics, bootstrap integration, and browse-registry implementation guidance.
- [x] Add operator registry registration UI in `/v2/marketplace` and a buyer sandbox tab in `/marketplace`.
- Added `/api/agent-marketplace/ops/register`, a `REGISTRY REGISTRATION` panel in `/v2/marketplace`, and a `BUYER SANDBOX` tab in `/marketplace` for operator registration and external-agent purchase-flow testing.
