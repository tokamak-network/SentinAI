# ERC-8004 Registry Deployment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a minimal ERC-8004 registry contract for SentinAI, then align the app to the deployed ABI and address so marketplace registration and future registry browsing become real runtime paths.

**Architecture:** Start with a minimal permissionless `register(agentURI)` contract on a test network, treat the deployed ABI and event shape as canonical, then update the app’s registry ABI module, receipt parsing, environment wiring, and browse-read prerequisites around that deployed contract.

**Tech Stack:** Solidity contract tooling (to be chosen by deployment session), viem, Next.js App Router, TypeScript, Vitest

---

### Task 1: Freeze the contract spec

**Files:**
- Reference: `docs/plans/2026-03-13-erc8004-registry-minimal-spec.md`
- Reference: `src/lib/agent-marketplace/abi/agent-registry.ts`

**Step 1: Confirm the canonical event shape**

Choose one:
- `AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)` recommended
- or the current temporary dual-event compatibility shape

**Step 2: Record the final ABI/event decision**

Document the exact deployed interface before writing deployment artifacts.

**Step 3: Verify app implications**

Confirm which app modules will need post-deploy updates:
- `src/lib/agent-marketplace/abi/agent-registry.ts`
- `src/lib/agent-marketplace/agent-registry.ts`
- future registry browse read path

### Task 2: Create and deploy the contract

**Files:**
- Create in contract workspace chosen for deployment session
- Output artifacts to a source-of-truth path that can be copied into this repo

**Step 1: Implement the minimal contract**

Required behavior:
- `register(string agentURI)`
- emit canonical registration event
- monotonic `agentId`

**Step 2: Deploy to test network**

Recommended first target:
- Sepolia

**Step 3: Capture deployment outputs**

Save:
- deployed address
- deployed network
- exact ABI
- tx hash
- deployment commit or artifact reference

**Step 4: Smoke test the contract directly**

Verify:
- `register(agentURI)` succeeds
- expected event is emitted
- public RPC can read the event logs

### Task 3: Align the app to the deployed registry

**Files:**
- Modify: `src/lib/agent-marketplace/abi/agent-registry.ts`
- Modify: `src/lib/agent-marketplace/agent-registry.ts`
- Modify: `.env.local.sample`
- Modify: `ENV_GUIDE.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Replace guessed ABI with deployed ABI**

Update the ABI module to the actual deployed interface.

**Step 2: Simplify receipt parsing**

Use the deployed canonical event as the primary path.
Keep fallback parsing only if the deployed contract still needs multiple event shapes.

**Step 3: Document the deployment address and env wiring**

Add:
- `ERC8004_REGISTRY_ADDRESS`
- selected network guidance
- deployment verification steps

### Task 4: Verify bootstrap registration end-to-end

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/agent-registry.test.ts`
- Modify: `src/lib/__tests__/first-run-bootstrap.test.ts`

**Step 1: Update tests to the deployed ABI shape**

Cover:
- registration receipt parsing with the final event
- bootstrap success path with real deployed ABI assumptions

**Step 2: Run focused tests**

Run:
- `npx vitest run src/lib/__tests__/agent-marketplace/agent-registry.test.ts src/lib/__tests__/first-run-bootstrap.test.ts`

Expected: PASS

### Task 5: Prepare registry browse follow-up

**Files:**
- Create future design/plan or implementation ticket for browse-read path

**Step 1: Define browse input contract**

Minimum browse input:
- registry address
- canonical event shape
- RPC endpoint

**Step 2: Define browse output contract**

Minimum output:
- `agentId`
- `agent`
- `agentURI`
- fetched manifest summary

**Step 3: Record next implementation boundary**

This follow-up starts only after deployed ABI and address are confirmed in runtime config.

### Task 6: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Update execution log**

Record:
- registry deployed
- ABI aligned
- bootstrap verified

**Step 2: Run verification**

Run:
- focused Vitest for registry/bootstrap paths
- targeted ESLint for modified app files
- `npm run build`

Expected: PASS, aside from unchanged Next warnings if any.
