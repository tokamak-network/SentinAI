# Repository File Hygiene Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Classify repository paths into keep/archive/remove buckets and clean obviously unnecessary tracked artifacts without touching valid source or historical references.

**Architecture:** Use repository structure and references as the source of truth. Preserve anything tied to build, docs, examples, verification, or active workflows, and only remove artifacts that are clearly generated or OS-specific.

**Tech Stack:** Next.js, TypeScript, Markdown docs, Git hygiene

---

### Task 1: Establish classification criteria

**Files:**
- Modify: `docs/todo.md`
- Create: `docs/guide/repository-file-hygiene.md`

**Step 1: Record the active task**

Add one completed checklist item under `Docs Context Hygiene` so the cleanup work is visible in the active tracker.

**Step 2: Document the classification**

Create a concise guide that groups paths into:
- required source-of-truth
- intentional reference/history
- safe cleanup targets

**Step 3: Verify the guide matches the repo**

Check the guide against `ARCHITECTURE.md`, `.gitignore`, and tracked path usage before moving to cleanup.

### Task 2: Fix hygiene gaps

**Files:**
- Modify: `.gitignore`
- Delete: `.DS_Store`
- Delete: `e2e-artifacts/connect-success.png`

**Step 1: Extend ignore coverage**

Add OS/runtime artifact patterns that should never be tracked.

**Step 2: Remove tracked junk**

Delete files that are clearly not source-of-truth:
- macOS Finder metadata
- generated e2e screenshot artifact

**Step 3: Restore lessons index**

Create `docs/lessons.md` with short reusable hygiene rules and keep long-form history in `docs/archive/`.

### Task 3: Clean local regenerable artifacts and verify

**Files:**
- Create: `docs/lessons.md`

**Step 1: Remove ignored runtime artifacts**

Delete local generated outputs such as `coverage/`, `.lighthouseci/`, and temporary e2e artifacts when they are not part of source control.

**Step 2: Verify changes**

Run:

```bash
git status --short
git diff --check
```

Expected:
- only intended docs/ignore/deletion changes remain
- no whitespace or patch-format issues
