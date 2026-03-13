# SentinAI Marketplace Diagram HTML Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone HTML document that renders three Mermaid diagrams explaining how SentinAI sells operational API and agent services through the marketplace.

**Architecture:** Create a single static HTML file under `docs/` that loads Mermaid from a CDN, applies lightweight presentation styling, and renders three sections: relationship map, sales flow, and the reverse-case scenario. Keep the output decoupled from the Next.js app so the asset remains a documentation artifact.

**Tech Stack:** Static HTML, CSS, Mermaid ESM CDN

---

### Task 1: Write the document shell

**Files:**
- Create: `docs/sentinai-marketplace-diagrams.html`
- Reference: `docs/marketplace-wireframe.html`

**Step 1: Define the page structure**

Create one HTML document with:
- page title and intro
- three diagram sections
- short explanatory captions

**Step 2: Add Mermaid bootstrapping**

Load Mermaid from CDN and initialize it on page load.

**Step 3: Add presentation styling**

Use lightweight CSS for readable cards, headings, and wide diagram blocks.

**Step 4: Commit**

```bash
git add docs/sentinai-marketplace-diagrams.html
git commit -m "docs: add SentinAI marketplace diagram html"
```

### Task 2: Capture the active task record

**Files:**
- Modify: `docs/todo.md`

**Step 1: Add session checklist**

Record the scope and verification intent for this documentation deliverable.

**Step 2: Add review summary**

Capture the result in the review section for later traceability.

**Step 3: Commit**

```bash
git add docs/todo.md
git commit -m "docs: track marketplace diagram html task"
```
