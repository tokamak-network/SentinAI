# Agent Marketplace Dispute Actions Design

**Goal:** Add the smallest useful operator action flow to `/v2/marketplace` by allowing dispute status updates with reviewer metadata.

## Scope

Phase 1 action UI includes:
- status change
- reviewer note
- reviewed by

## Recommendation

Keep the action model minimal and auditable:
- extend dispute records with `reviewerNote` and `reviewedBy`
- allow operators to submit those fields together with a new status
- keep the flow inside the existing dispute detail panel

## Why this approach

- uses the existing dispute route and detail panel
- creates a minimal audit trail without inventing a full workflow system
- keeps the ops console useful before deeper dispute mechanics exist

## Data Model Changes

Add optional fields to each dispute:
- `reviewerNote?: string | null`
- `reviewedBy?: string | null`

Update semantics:
- when a dispute is patched, metadata is stored together with status
- metadata may be absent for old disputes

## UI Changes

Inside `DISPUTE DETAIL`, add:
- current metadata display
- small action form:
  - status select
  - reviewed by input
  - reviewer note textarea
  - submit button

## Non-Goals

- authentication / permissions
- multi-review workflow
- comment history
- on-chain dispute execution

## Follow-Up

After this phase:
1. add mutation handling feedback states
2. add audit history
3. add role-aware access control
