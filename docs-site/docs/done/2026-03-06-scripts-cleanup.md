# Scripts Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove stale and unreferenced scripts from `scripts/` without touching active operational workflows.

**Architecture:** Use repository references as the decision boundary. Keep scripts that are exposed through `package.json`, referenced from active docs, or used by other scripts, and remove only dead aliases and isolated diagnostics.

**Tech Stack:** Node.js scripts, Bash scripts, npm package scripts, Markdown docs

---

### Task 1: Fix broken entry points

**Files:**
- Modify: `package.json`
- Modify: `docs/todo.md`

**Step 1: Remove dead npm alias**

Delete the `prod:gate:tier2` entry because `scripts/prod-gate-tier2.sh` is already absent from the workspace.

**Step 2: Record the cleanup**

Add one completed item and one short review note in `docs/todo.md`.

### Task 2: Delete unreferenced diagnostics

**Files:**
- Delete: `scripts/diagnose-api-keys.ts`
- Delete: `scripts/setup-env.sh`
- Delete: `scripts/test-gateway-and-qwen.ts`
- Delete: `scripts/test-gemini-gateway.ts`
- Delete: `scripts/test-gpt52-models.ts`
- Delete: `scripts/test-openai-key.ts`

**Step 1: Remove only isolated utilities**

Delete scripts that have no active package/doc/runtime references and only serve one-off provider diagnostics or duplicated environment setup.

**Step 2: Preserve shared utilities**

Keep `console-with-timestamp.ts` and `console-with-timestamp.mjs` because active scripts still import them.

### Task 3: Record lessons and verify

**Files:**
- Modify: `docs/lessons.md`

**Step 1: Add cleanup guardrails**

Add reusable rules about keeping `package.json` and `scripts/` synchronized.

**Step 2: Verify repository state**

Run:

```bash
git status --short
git diff --check
rg -n "prod:gate:tier2|diagnose-api-keys|test-gateway-and-qwen|test-gemini-gateway|test-gpt52-models|test-openai-key|setup-env.sh" . -g '!node_modules' -g '!.git' -g '!.next'
```

Expected:
- removed scripts only appear as deletions in `git status`
- `git diff --check` returns no issues
- active source/docs no longer reference removed scripts
