# Connect Wizard Local Target Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Local / Try It Out" deploy target to the connect wizard that accepts localhost URLs and guides users to add `extra_hosts` to docker-compose.yml.

**Architecture:** All changes are isolated to `website/src/app/connect/page.tsx`. No new files. The `buildEnvLocal()` function gets a `deployTarget` parameter to perform localhost → `host.docker.internal` substitution. The setup step output section gets a new conditional block for the diff snippet.

**Tech Stack:** React 19, TypeScript (strict), inline styles (existing pattern in this file)

---

## Chunk 1: Type + Deploy Target Button

### Task 1: Add `"local"` to `DeployTarget` and render the button

**Files:**
- Modify: `website/src/app/connect/page.tsx`

- [ ] **Step 1: Add `"local"` to the type**

Find line 30:
```ts
type DeployTarget = "eks" | "docker";
```
Change to:
```ts
type DeployTarget = "local" | "eks" | "docker";
```

- [ ] **Step 2: Prepend the Local button to the deploy target list**

Find the array literal starting with `{ value: "eks" as DeployTarget` (around line 658). Prepend a new entry before it:

```tsx
{
  value: "local" as DeployTarget,
  label: "Local / Try It Out",
  sub: "Quick local eval · no K8s · localhost supported",
  badge: "QUICKSTART",
  badgeColor: "#006600",
},
```

- [ ] **Step 3: Clear `awsClusterName` when Local is selected**

Find the `onClick` handler on the deploy target buttons (line ~679):
```tsx
onClick={() => { setDeployTarget(value); if (value === "docker") { setAwsClusterName(""); } resetOutput(); }}
```
Change to:
```tsx
onClick={() => { setDeployTarget(value); if (value === "docker" || value === "local") { setAwsClusterName(""); } resetOutput(); }}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add website/src/app/connect/page.tsx
git commit -m "feat(connect): add Local/Try It Out deploy target button"
```

---

## Chunk 2: localhost URL Handling

### Task 2: Fix `isLocalUrl` warning and auto-convert URL in `.env.local`

**Files:**
- Modify: `website/src/app/connect/page.tsx`

- [ ] **Step 1: Make the localhost warning conditional on non-local target**

Find line ~774:
```tsx
{isLocalUrl && (
  <div style={{ background: "#FFF0F0", ...
```
Change to:
```tsx
{isLocalUrl && deployTarget !== "local" && (
  <div style={{ background: "#FFF0F0", ...
```

- [ ] **Step 2: Add a green info tip for Local target + localhost URL**

Directly after the closing `)}` of the warning block (still inside the RPC URL `<div>`), add:

```tsx
{isLocalUrl && deployTarget === "local" && (
  <div style={{ background: "#F0FFF0", border: `1px solid #80C080`, padding: "8px 10px", marginTop: 6 }}>
    <p style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: "#005500", margin: "0 0 2px" }}>
      ✓ LOCAL URL DETECTED
    </p>
    <p style={{ fontFamily: FONT, fontSize: 9, color: "#005500", margin: 0 }}>
      <code style={{ background: "#C8E8C8", padding: "0 3px" }}>localhost</code> will be written as{" "}
      <code style={{ background: "#C8E8C8", padding: "0 3px" }}>host.docker.internal</code> in the generated config.
    </p>
  </div>
)}
```

- [ ] **Step 3: Convert localhost in `buildEnvLocal`**

The `buildEnvLocal` function currently uses `cfg.url` directly. Add URL conversion at the top of the function body (after line ~226 `const u = cfg.url.trim() || "<your-url>";`):

Find:
```ts
function buildEnvLocal(cfg: BuildConfig, featureSnippets: string[] = []): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const u = cfg.url.trim() || "<your-url>";
```

Change to:
```ts
function buildEnvLocal(cfg: BuildConfig, featureSnippets: string[] = [], deployTarget?: DeployTarget | null): string {
  const { primary, optional } = ENV_MAP[cfg.nodeType];
  const rawUrl = cfg.url.trim() || "<your-url>";
  const u = deployTarget === "local"
    ? rawUrl.replace(/localhost/g, "host.docker.internal").replace(/127\.0\.0\.1/g, "host.docker.internal")
    : rawUrl;
```

- [ ] **Step 4: Pass `deployTarget` to `buildEnvLocal` in the `useMemo`**

Find (line ~460):
```ts
return buildEnvLocal(buildCfg, featureSnippets);
```
Change to:
```ts
return buildEnvLocal(buildCfg, featureSnippets, deployTarget);
```

Also update the `useMemo` dependency array — `deployTarget` is already there, no change needed.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Verify manually in browser**

```bash
npm run dev
```
Navigate to `http://localhost:3000/connect` (or port 3001/3002 depending on your dev setup).

1. Select **Local / Try It Out**
2. Enter `http://localhost:8545` as RPC URL
3. Confirm: green "LOCAL URL DETECTED" tip appears (no red warning)
4. Click the generate/test button — check generated `.env.local` shows `host.docker.internal:8545`

- [ ] **Step 7: Commit**

```bash
git add website/src/app/connect/page.tsx
git commit -m "feat(connect): auto-convert localhost to host.docker.internal for local target"
```

---

## Chunk 3: docker-compose.yml Diff Step

### Task 3: Add "Edit docker-compose.yml" as Step 2 in Local setup guide

**Files:**
- Modify: `website/src/app/connect/page.tsx`

- [ ] **Step 1: Locate the setup steps output section**

Find the "Step 1: Clone Repository" `<DeployStep>` block (around line 1107):
```tsx
{/* Step 1 */}
<DeployStep number={1} title="CLONE REPOSITORY" font={FONT} colors={C}>
```

The current steps are numbered 1–4. For Local target, we need to insert a new Step 2 and shift the remaining steps to 3–5.

- [ ] **Step 2: Make step numbers dynamic based on `deployTarget`**

Replace the hardcoded step numbers in the output section with a computed offset. Add this variable before the steps:

```tsx
const isLocal = deployTarget === "local";
```

Then update each step:
- Step 1 (Clone): stays as `number={1}`
- Step 2 (.env.local): becomes `number={isLocal ? 3 : 2}`
- Step 3 (docker compose up): becomes `number={isLocal ? 4 : 3}`
- Step 4 (Open Dashboard): becomes `number={isLocal ? 5 : 4}`

Also update the `last` prop: currently on Step 4 (`last`). Change so that whichever step is last gets `last`:
- If `isLocal`: Step 5 (index 4) is last — add `last` prop there.
- If not local: Step 4 (index 3) is last — keep existing `last` prop.

So:
```tsx
<DeployStep number={isLocal ? 5 : 4} title="OPEN DASHBOARD" ... last>
```

- [ ] **Step 3: Insert the new Step 2 block (Local only) after Step 1**

After the closing `</DeployStep>` of Step 1, add:

```tsx
{/* Step 2 — Local only: edit docker-compose.yml */}
{isLocal && (
  <DeployStep number={2} title="EDIT DOCKER-COMPOSE.YML" font={FONT} colors={C}>
    <CodeBlock
      title="docker-compose.yml diff"
      content={
        "# Under the sentinai: service block, add:\n" +
        "  sentinai:\n" +
        "    image: ghcr.io/tokamak-network/sentinai:latest\n" +
        "+   extra_hosts:\n" +
        '+     - "host.docker.internal:host-gateway"\n' +
        "    env_file: .env.local"
      }
      copyId="compose-diff"
      copiedId={copiedId}
      onCopy={copyToClipboard}
    />
    <p style={{ fontFamily: FONT, fontSize: 9, color: C.muted, margin: "8px 0 0" }}>
      Required on <strong>Linux</strong> so Docker can reach your local node.{" "}
      Mac and Windows Docker Desktop handle this automatically — skip if not on Linux.
    </p>
  </DeployStep>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Verify manually in browser**

1. Select **Local / Try It Out**, enter any URL, click generate
2. Confirm 5-step guide renders:
   - Step 1: Clone Repository
   - Step 2: Edit docker-compose.yml (diff snippet with `+extra_hosts` lines)
   - Step 3: Create .env.local
   - Step 4: docker compose up -d
   - Step 5: Open Dashboard
3. Switch to **Docker / VM** — confirm only 4 steps render (no diff step)
4. Switch to **AWS EKS** — confirm only 4 steps render

- [ ] **Step 6: Lint check**

```bash
cd website && npm run lint
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add website/src/app/connect/page.tsx
git commit -m "feat(connect): add docker-compose.yml edit guide for local target"
```

---

## Final Verification

- [ ] **Full build check**

```bash
cd website && npm run build
```
Expected: build succeeds, no TypeScript or lint errors.

- [ ] **End-to-end flow walkthrough**

1. Open `/connect`
2. Select **OP Stack L2** node type
3. Select **Local / Try It Out** deploy target
4. Enter `http://localhost:8545` as RPC URL — green tip appears, no red warning
5. Select **Anthropic** AI provider, enter a dummy key
6. Click generate / test connection
7. Verify `.env.local` output contains `host.docker.internal:8545`
8. Verify 5-step guide with diff snippet at Step 2
9. Switch to **Docker / VM** — red localhost warning reappears, 4-step guide
10. Switch to **AWS EKS** — same behavior as Docker/VM

- [ ] **Final commit (if any cleanup needed)**

```bash
git add website/src/app/connect/page.tsx
git commit -m "chore(connect): cleanup after local target implementation"
```
