# TODO: SentinAI Implementation

> Last Updated: 2026-03-12

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

## Review (2026-03-12, TON Facilitator Docs)

- Strengthened the Korean TON facilitator design doc so it now fixes the Phase 1 source of truth, internal auth contract, canonical resource rules, settlement Redis schema, merchant allowlist source, and reconciler execution model.
- Expanded the Korean implementation plan with missing `settlement-store` and `reconcile-runner` tasks, explicit detached receipt signing rules, and stronger route/runtime prerequisites.
- Synced the English TON facilitator design and implementation plan to the same Phase 1 baseline so the Korean and English docs now describe the same settlement store, receipt format, internal auth, reconciler model, and execution order.

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
