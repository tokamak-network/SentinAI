# Docs Organization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken links, commit pending hygiene work, de-clutter docs/guide/, and consolidate stale/duplicate content into archive.

**Architecture:** Treat docs/README.md as the single source of truth for navigation. Every file it links must exist; every file that exists but is not linked should be archived or removed. docs/guide/ is cleaned by moving ops-heavy runbooks to a runbook/ sub-directory and demo scripts to demo/. docs/todo/ duplicates are resolved by keeping the latest and archiving old.

**Tech Stack:** Markdown, Git

---

### Task 1: Commit pending hygiene work

Previous session created four untracked files that should be committed.

**Files:**
- `docs/guide/repository-file-hygiene.md` (new)
- `docs/lessons.md` (new)
- `docs/plans/2026-03-06-repository-file-hygiene.md` (new)
- `docs/plans/2026-03-06-scripts-cleanup.md` (new)

**Step 1: Verify the files exist and look correct**

```bash
git status --short docs/
```

Expected: four `??` entries for those files.

**Step 2: Stage and commit**

```bash
git add docs/guide/repository-file-hygiene.md \
        docs/lessons.md \
        docs/plans/2026-03-06-repository-file-hygiene.md \
        docs/plans/2026-03-06-scripts-cleanup.md
git commit -m "docs: add hygiene guide, lessons index, and cleanup plans"
```

---

### Task 2: Fix broken links in docs/README.md

`docs/README.md` references three files that do not exist.

**Files:**
- Modify: `docs/README.md`

**Step 1: Identify broken links**

Check each referenced path:
- `whitepaper.md` → actual file is `docs/archive/whitepaper.md`
- `guide/agent-loop-vs-goal-manager-demo-15min.md` → does not exist
- `guide/agent-loop-vs-goal-manager-demo-speaker-script.md` → does not exist

**Step 2: Fix the whitepaper link**

In `docs/README.md`, change:
```markdown
- [Whitepaper](whitepaper.md)
```
to:
```markdown
- [Whitepaper](archive/whitepaper.md)
```

**Step 3: Remove the two missing demo links**

Delete these two lines from the `## 2) Operate in Production` section:
```
- [Agent Loop vs Goal Manager 15-minute demo](guide/agent-loop-vs-goal-manager-demo-15min.md)
- [Agent Loop vs Goal Manager speaker script](guide/agent-loop-vs-goal-manager-demo-speaker-script.md)
```

**Step 4: Verify no other broken links**

```bash
grep -oP '\]\([^)]+\)' docs/README.md | sed 's/](\(.*\))/\1/' | while read f; do
  [[ $f == http* ]] && continue
  [[ -f "docs/$f" || -f "$f" ]] || echo "BROKEN: $f"
done
```

Expected: no output (or only the already-fixed paths).

**Step 5: Commit**

```bash
git add docs/README.md
git commit -m "docs: fix broken links in README (whitepaper, missing demo files)"
```

---

### Task 3: Archive stale audit files in docs/todo/

Two codebase audit files dated 2026-02-16 are in docs/todo/ but are stale snapshots, not actionable proposals.

**Files:**
- Delete: `docs/todo/codebase-audit-2026-02-16.md`
- Delete: `docs/todo/codebase-audit-2026-02-16-refresh.md`

**Step 1: Confirm they are not referenced anywhere**

```bash
grep -r "codebase-audit-2026-02-16" docs/ --include="*.md" -l
```

Expected: only the two files themselves (no other file links them).

**Step 2: Move to archive**

```bash
git mv docs/todo/codebase-audit-2026-02-16.md docs/archive/codebase-audit-2026-02-16.md
git mv docs/todo/codebase-audit-2026-02-16-refresh.md docs/archive/codebase-audit-2026-02-16-refresh.md
```

**Step 3: Resolve duplicate proposal-32**

There are two files for proposal-32:
- `docs/todo/proposal-32-ai-playbook-generator.md`
- `docs/todo/proposal-32-autonomous-playbook-generation.md`

Read both to identify which is the canonical version:

```bash
head -5 docs/todo/proposal-32-ai-playbook-generator.md
head -5 docs/todo/proposal-32-autonomous-playbook-generation.md
```

Keep the more complete/recent one. Move the other to archive:

```bash
git mv docs/todo/proposal-32-ai-playbook-generator.md docs/archive/proposal-32-ai-playbook-generator-draft.md
# OR vice versa depending on which is canonical
```

**Step 4: Commit**

```bash
git add -A docs/todo/ docs/archive/
git commit -m "docs: archive stale audit files and resolve duplicate proposal-32"
```

---

### Task 4: Consolidate docs/brand/ and docs/market/

These two directories contain whitepaper drafts and market notes that are no longer actively edited. They should be archived unless actively maintained.

**Files:**
- `docs/brand/docs-ia.md`
- `docs/brand/progress-note.md`
- `docs/brand/whitepaper-lite-outline.md`
- `docs/market/l2-market-opportunity.md`
- `docs/market/CLAUDE.md`

**Step 1: Check if any active file links to them**

```bash
grep -r "brand/" docs/README.md docs/guide/ --include="*.md" -l
grep -r "market/" docs/README.md docs/guide/ --include="*.md" -l
```

**Step 2: Move to archive/brand/ and archive/market/**

If no active references found:

```bash
mkdir -p docs/archive/brand docs/archive/market
git mv docs/brand/docs-ia.md docs/archive/brand/
git mv docs/brand/progress-note.md docs/archive/brand/
git mv docs/brand/whitepaper-lite-outline.md docs/archive/brand/
git mv docs/market/l2-market-opportunity.md docs/archive/market/
git mv docs/market/CLAUDE.md docs/archive/market/
```

Then remove the now-empty directories:

```bash
git rm -r docs/brand docs/market
```

**Step 3: Commit**

```bash
git add -A docs/brand/ docs/market/ docs/archive/
git commit -m "docs: archive brand/ and market/ directories (not actively maintained)"
```

---

### Task 5: Trim docs/guide/ by moving runbooks and demo files

`docs/guide/` has 25+ files mixing quickstart guides, deep runbooks, testing guides, and demo scripts. Move the heavier ops runbooks to `docs/guide/runbook/` and demo materials to `docs/demo/`.

**Files to move to `docs/guide/runbook/`** (detailed ops procedures):
- `docs/guide/agentic-q1-operations-runbook.md`
- `docs/guide/agent-loop-vs-goal-manager-hands-on-runbook.md`
- `docs/guide/minority-client-migration-playbook.md`
- `docs/guide/partner-diversity-onboarding.md`
- `docs/guide/multistack-autonomous-ops-validation.md`
- `docs/guide/stack-environment-operations-decision-matrix.md`
- `docs/guide/env-based-operations-profile-quick-decider.md`
- `docs/guide/network-stack-dashboard-feature-differences.md`

**Files to move to `docs/guide/testing/`** (test and evaluation guides):
- `docs/guide/algorithm-effectiveness-evaluation.md`
- `docs/guide/production-load-testing-guide.md`
- `docs/guide/scaling-accuracy-testing-guide.md`
- `docs/guide/MODEL_BENCHMARK_GUIDE.md`
- `docs/guide/LLM_STRESS_TEST_ENV_GUIDE.md`

**Step 1: Create sub-directories and move files**

```bash
mkdir -p docs/guide/runbook docs/guide/testing

git mv docs/guide/agentic-q1-operations-runbook.md docs/guide/runbook/
git mv docs/guide/agent-loop-vs-goal-manager-hands-on-runbook.md docs/guide/runbook/
git mv docs/guide/minority-client-migration-playbook.md docs/guide/runbook/
git mv docs/guide/partner-diversity-onboarding.md docs/guide/runbook/
git mv docs/guide/multistack-autonomous-ops-validation.md docs/guide/runbook/
git mv docs/guide/stack-environment-operations-decision-matrix.md docs/guide/runbook/
git mv docs/guide/env-based-operations-profile-quick-decider.md docs/guide/runbook/
git mv docs/guide/network-stack-dashboard-feature-differences.md docs/guide/runbook/

git mv docs/guide/algorithm-effectiveness-evaluation.md docs/guide/testing/
git mv docs/guide/production-load-testing-guide.md docs/guide/testing/
git mv docs/guide/scaling-accuracy-testing-guide.md docs/guide/testing/
git mv docs/guide/MODEL_BENCHMARK_GUIDE.md docs/guide/testing/
git mv docs/guide/LLM_STRESS_TEST_ENV_GUIDE.md docs/guide/testing/
```

**Step 2: Update docs/README.md links**

For every moved file, update its path in `docs/README.md`. For example:
- `guide/agentic-q1-operations-runbook.md` → `guide/runbook/agentic-q1-operations-runbook.md`
- `guide/algorithm-effectiveness-evaluation.md` → `guide/testing/algorithm-effectiveness-evaluation.md`
- (update all moved files)

**Step 3: Check for any other cross-references**

```bash
grep -r "guide/agentic-q1\|guide/minority-client\|guide/partner-diversity\|guide/multistack\|guide/stack-environment\|guide/env-based\|guide/network-stack\|guide/algorithm\|guide/production-load\|guide/scaling-accuracy\|guide/MODEL_BENCH\|guide/LLM_STRESS" docs/ src/ --include="*.md" --include="*.ts" -l
```

Fix any hits that are not docs/README.md.

**Step 4: Verify structure**

```bash
ls docs/guide/
ls docs/guide/runbook/
ls docs/guide/testing/
```

Expected: `docs/guide/` has ~12 core files; `runbook/` has 8 files; `testing/` has 5 files.

**Step 5: Commit**

```bash
git add -A docs/guide/ docs/README.md
git commit -m "docs: reorganize guide/ into runbook/ and testing/ sub-directories"
```

---

### Task 6: Update docs/README.md section headers and Fast Paths

After all moves, ensure docs/README.md accurately reflects the new structure with updated section headers.

**Files:**
- Modify: `docs/README.md`

**Step 1: Update section 2 links to use runbook/ paths**

Update `## 2) Operate in Production` to reference `guide/runbook/` paths.

**Step 2: Update section 4 links to use testing/ paths**

Update `## 4) Evaluate & Verify` to reference `guide/testing/` paths.

**Step 3: Add lessons.md to section 5**

Ensure `docs/lessons.md` is listed under `## 5) Governance & History`.

**Step 4: Final link check**

```bash
grep -oP '\]\(([^)]+)\)' docs/README.md | sed 's/](\(.*\))/\1/' | while read f; do
  [[ $f == http* ]] && continue
  resolved="docs/$f"
  [[ -f "$resolved" ]] || echo "BROKEN: $f"
done
```

Expected: no broken links.

**Step 5: Commit**

```bash
git add docs/README.md
git commit -m "docs: update README navigation for reorganized guide structure"
```

---

## Summary of Changes

| Area | Action | Count |
|------|--------|-------|
| Pending hygiene files | Commit | 4 files |
| Broken links in README | Fix | 3 links |
| Stale audit files | Archive | 2 files |
| Duplicate proposal-32 | Archive | 1 file |
| brand/ + market/ dirs | Archive | 5 files |
| guide/ runbooks | Move to runbook/ | 8 files |
| guide/ test guides | Move to testing/ | 5 files |

After completion, `docs/guide/` shrinks from 25+ files to ~12 core onboarding files, all README links resolve, and stale content is in `docs/archive/` rather than active directories.
