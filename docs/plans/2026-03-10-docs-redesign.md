# Docs Page Redesign

**Date:** 2026-03-10
**Scope:** Full docs section — landing page, sidebar, individual page layout

## Problem

- `/docs` landing renders raw `README.md` exposing internal metadata (archive references, file paths)
- Numbered sections (0–5) + "Fast Paths" duplication = 30+ links on one page
- Sidebar (19 items) and main content are out of sync
- File path displayed in page header (e.g. `README.md`)
- H1 title duplicated between page header and article body

## Target Audience

Both external evaluators (assessing SentinAI for adoption) and internal operators (running it in production).

## Design

### 1. Landing Page (`/docs`)

Replace dynamic README.md rendering with a hardcoded Next.js page.

**Structure:**
- Header: title, subtitle, 2 CTA buttons (Quick Start, Architecture)
- 4-card grid (2×2):
  - 🚀 Get Started → Overview, Quick Start, Demo Scenarios, Troubleshooting
  - ⚙️ Deploy → Local Setup, EC2 Deployment, OP Stack Runbook, Env Variables
  - 🔌 Integrate → Architecture, API Reference, MCP Setup, Anomaly Detection
  - ✅ Verify → Testing Guide, Integration Tests, Dashboard UI Testing

**Removed:**
- Internal archive references
- Numbered section headings (0–5)
- "Fast Paths" duplicate section
- Raw file path display

### 2. Sidebar (`DocsSidebar.tsx`)

5 sections 19 items → 4 sections 14 items.

| Section | Items |
|---------|-------|
| GET STARTED | Overview, Quick Start, Demo Scenarios, Troubleshooting |
| DEPLOY | Setup Guide, EC2 Deployment, OP Stack Runbook |
| OPERATIONS | Daily Operations, Autonomy Cockpit, MCP User Guide |
| REFERENCE | Architecture, API Reference, Anomaly Detection, RCA Engine |

**Removed from sidebar:**
- OP Stack Setup (duplicate of OP Stack Runbook)
- Claude MCP Setup (linked from MCP User Guide)
- Client Ops Contract (internal document)
- Testing & Verification section (accessible from landing Verify card)

### 3. Individual Page Layout (`[[...slug]]/page.tsx`)

- **Hide file path** — remove `target.relativePath` display
- **Remove H1 duplication** — skip first `# heading` in MarkdownRenderer when it matches page title
- **Narrow max-width** — change `max-w-[1400px]` to `max-w-4xl` for better readability on content-only pages (TOC still shows on xl+)

## Files to Change

| File | Change |
|------|--------|
| `website/src/app/docs/[[...slug]]/page.tsx` | New hardcoded landing for slug=[], fix file path + H1 issues |
| `website/src/components/DocsSidebar.tsx` | Reduce docStructure to 4 sections, 14 items |
| `website/src/components/MarkdownRenderer.tsx` | Skip first H1 that duplicates page title |
