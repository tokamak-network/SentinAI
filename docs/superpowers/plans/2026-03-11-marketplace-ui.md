# Marketplace UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two marketplace pages — a public website page for agent/developer discovery (`website/src/app/marketplace/`) and an operator dashboard page (`src/app/marketplace/`) — plus a `GET /api/marketplace/stats` route.

**Architecture:** The website page uses inline components (React Server Components, SSR-safe) with three tabs: Browse Registry (ERC-8004 viem getLogs, default), This Instance (cross-origin catalog fetch), and Connect Guide (static). The dashboard page is a single inline client component following the existing `page.tsx` pattern — no extracted component files — that calls a new `/api/marketplace/stats` API route. Phase 1 returns hardcoded zeros for all revenue/usage fields; no payment log store yet.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, viem (getLogs), IBM Plex Mono (existing font), inline styles (matching existing patterns), Vitest

**Dependency:** The agent economy backend plan (`docs/superpowers/plans/2026-03-11-agent-economy.md`) must be executed first so `src/app/api/marketplace/catalog/route.ts` exists before this plan runs.

---

## File Map

```
NEW:
  website/src/app/marketplace/
    page.tsx                    — Public marketplace page (RSC, SSR-safe; 3-tab layout inline)

  website/src/components/
    MarketplaceTabs.tsx         — Client tab switcher (This Instance / Browse Registry / Connect Guide)
    RegistryBrowser.tsx         — Browse Registry tab: global stats + instance list (server-side viem getLogs)
    InstanceCard.tsx            — Single SentinAI instance row component
    ServiceGrid.tsx             — Service card grid with tier color coding (used by This Instance tab)
    ConnectGuide.tsx            — Static x402 connection tutorial (pure JSX, no API)

  src/app/marketplace/
    page.tsx                    — Operator dashboard marketplace page (client component, inline UI)

  src/app/api/marketplace/stats/
    route.ts                    — GET: aggregated marketplace stats (Phase 1: hardcoded zeros)

MODIFIED:
  website/src/app/page.tsx      — Add MARKETPLACE to Navbar nav links array
  src/app/page.tsx              — Add MARKETPLACE nav link to top bar
  src/app/api/marketplace/catalog/route.ts  — Add CORS header (from agent-economy plan, modify if exists)
```

---

## Chunk 1: Backend Stats Route + CORS

### Task 1: `GET /api/marketplace/stats` route (Phase 1 stub)

**Context:** Returns hardcoded zeros in Phase 1. The `MarketplaceStats` interface is defined here and used by the dashboard UI. When `MARKETPLACE_ENABLED` env var is false/unset, returns all zeros with `enabled: false`. This is Phase 1 only — no payment log store yet.

**Files:**
- Create: `src/app/api/marketplace/stats/route.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/app/api/marketplace/stats
```

- [ ] **Step 2: Write `src/app/api/marketplace/stats/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export interface MarketplaceStats {
  enabled: boolean;
  totalEarnedThisMonth: string;   // TON in wei string; UI divides by 10^18 for display
  totalCallsToday: number;        // Past 24h UTC
  activeBuyerCount: number;
  services: Array<{
    key: string;                  // Underscore ServiceKey (e.g. "scaling_history"); UI converts to kebab for display
    priceWei: string;
    callsToday: number;           // Past 24h UTC; 0 in Phase 1
  }>;
  topBuyers: Array<{
    agentId: string;              // Ethereum address (0x...)
    spentThisMonth: string;       // TON in wei string; UI divides by 10^18
  }>;
  recentSales: Array<{
    agentId: string;              // Ethereum address (0x...)
    service: string;              // kebab-case key (e.g. "scaling-history")
    amountWei: string;
    timestamp: string;            // ISO 8601; UI renders as relative time
  }>;
}

function buildEmptyStats(enabled: boolean): MarketplaceStats {
  return {
    enabled,
    totalEarnedThisMonth: '0',
    totalCallsToday: 0,
    activeBuyerCount: 0,
    services: [],
    topBuyers: [],
    recentSales: [],
  };
}

export async function GET() {
  const enabled = process.env.MARKETPLACE_ENABLED === 'true';
  // Phase 1: always return hardcoded zeros — payment log store not yet implemented
  return NextResponse.json(buildEmptyStats(enabled));
}
```

- [ ] **Step 3: Verify the route responds correctly**

```bash
# Ensure dev server is running, then:
curl http://localhost:3002/api/marketplace/stats
```

Expected: `{"enabled":false,"totalEarnedThisMonth":"0","totalCallsToday":0,...}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/marketplace/stats/route.ts
git commit -m "feat(marketplace): add GET /api/marketplace/stats Phase 1 stub (hardcoded zeros)"
```

---

### Task 2: Add CORS header to catalog route

**Context:** The website Vercel app fetches `GET /api/marketplace/catalog` from the operator's dashboard domain. This route is defined by the agent-economy plan. If the agent economy plan has already run, modify the existing route. If not yet, add a note (the route will need CORS when it exists).

**Files:**
- Modify: `src/app/api/marketplace/catalog/route.ts` (add CORS header)

- [ ] **Step 1: Check if catalog route exists**

```bash
ls src/app/api/marketplace/catalog/route.ts 2>/dev/null && echo "EXISTS" || echo "NOT YET"
```

- [ ] **Step 2: If EXISTS — add CORS header**

Find the `GET` handler in `src/app/api/marketplace/catalog/route.ts` and wrap its `NextResponse.json(...)` return to include the CORS header:

```typescript
// Add this helper at the top of the file:
function corsJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

// Also add OPTIONS handler for preflight:
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

Replace all `NextResponse.json(catalog...` calls with `corsJson(catalog...)`.

- [ ] **Step 3: If NOT YET — skip this task entirely**

The catalog route will be created by the agent-economy plan. When it is created, a CORS header must be added at that time. No action needed here.

- [ ] **Step 4: Commit (if EXISTS case)**

```bash
git add src/app/api/marketplace/catalog/route.ts
git commit -m "feat(marketplace): add CORS header to catalog route for website cross-origin access"
```

---

## Chunk 2: Dashboard Marketplace Page

### Task 3: Operator dashboard marketplace page

**Context:** Follow the exact same pattern as `src/app/page.tsx` — inline styles, IBM Plex Mono font via `FONT` constant, client component, single file. The top bar already exists in `page.tsx` but this is a separate route (`/marketplace`). The page fetches `/api/marketplace/stats` on load. It shows a disabled banner when `enabled: false`.

**Files:**
- Create: `src/app/marketplace/page.tsx`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/app/marketplace
```

- [ ] **Step 2: Write `src/app/marketplace/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { MarketplaceStats } from '@/app/api/marketplace/stats/route';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const RED = '#D40000';
const BLUE = '#0055AA';
const GREEN = '#27ae60';
const BORDER = '#D0D0D0';
const DARK = '#0A0A0A';

function weiToTon(wei: string): string {
  const n = BigInt(wei);
  const whole = n / BigInt(1e18);
  const frac = (n % BigInt(1e18)) / BigInt(1e14); // 4 decimal places
  return frac === BigInt(0) ? whole.toString() : `${whole}.${frac.toString().padStart(4, '0').replace(/0+$/, '')}`;
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function serviceKeyToDisplay(key: string): string {
  return key.replaceAll('_', '-');
}

// ── Top Bar ─────────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <div style={{
      background: RED, color: 'white', height: 28, display: 'flex',
      alignItems: 'center', flexShrink: 0, borderBottom: `2px solid #8B0000`,
      fontFamily: FONT,
    }}>
      <div style={{
        background: '#8B0000', padding: '0 14px', height: '100%',
        display: 'flex', alignItems: 'center', borderRight: '2px solid #6B0000', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>SENTINAI</span>
      </div>
      <a href="/" style={{
        padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.8)',
        textDecoration: 'none', borderRight: '1px solid rgba(255,255,255,0.2)',
      }}>
        DASHBOARD
      </a>
      <div style={{
        padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        borderBottom: '2px solid white', borderRight: '1px solid rgba(255,255,255,0.2)',
      }}>
        MARKETPLACE
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background: 'white', border: `1px solid ${BORDER}`, padding: '10px 14px',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, color: '#888', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? DARK }}>
        {value}
      </div>
    </div>
  );
}

// ── Disabled Banner ──────────────────────────────────────────────────────────

function DisabledBanner() {
  return (
    <div style={{
      margin: '32px auto', maxWidth: 560, border: `1px solid ${BORDER}`,
      padding: 24, background: '#FFF8F8',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: RED, marginBottom: 12 }}>
        ⚠ MARKETPLACE DISABLED
      </div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
        Set MARKETPLACE_ENABLED=true to start earning TON.
      </div>
      <div style={{ fontSize: 11, fontFamily: FONT, background: '#F0F0F0', padding: 12 }}>
        <div>MARKETPLACE_ENABLED=true</div>
        <div>MARKETPLACE_WALLET_KEY=0x...  (Ethereum private key for ERC-8004 registration)</div>
        <div>MARKETPLACE_RECEIVER_ADDRESS=0x...  (Ethereum addr receiving TON ERC-20 payments)</div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/marketplace/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => setError('Failed to load marketplace stats'));
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      background: '#FAFAFA', fontFamily: FONT, color: DARK,
    }}>
      <TopBar />

      <div style={{ padding: '24px 32px', maxWidth: 1000, width: '100%', margin: '0 auto', flex: 1 }}>
        {error && (
          <div style={{ color: RED, fontSize: 12, padding: 12, border: `1px solid ${BORDER}`, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {!stats && !error && (
          <div style={{ color: '#888', fontSize: 12, padding: 32, textAlign: 'center' }}>Loading...</div>
        )}

        {stats && !stats.enabled && <DisabledBanner />}

        {stats && stats.enabled && (
          <>
            {/* ── 4-stat header ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <StatCard label="STATUS" value="ACTIVE" accent={GREEN} />
              <StatCard label="EARNED / MO" value={`${weiToTon(stats.totalEarnedThisMonth)} TON`} />
              <StatCard label="CALLS TODAY" value={stats.totalCallsToday.toLocaleString()} />
              <StatCard label="BUYERS" value={stats.activeBuyerCount.toString()} />
            </div>

            {/* ── 2-column: services + top buyers ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* Services */}
              <div style={{ background: 'white', border: `1px solid ${BORDER}` }}>
                <div style={{
                  padding: '8px 14px', background: '#F5F5F5', borderBottom: `1px solid ${BORDER}`,
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                }}>
                  SERVICES
                </div>
                {stats.services.length === 0 ? (
                  <div style={{ padding: '16px 14px', fontSize: 11, color: '#888' }}>No services configured.</div>
                ) : (
                  stats.services.map(svc => (
                    <div key={svc.key} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 14px', borderBottom: `1px solid #F0F0F0`,
                      fontSize: 12,
                    }}>
                      <span>{serviceKeyToDisplay(svc.key)}</span>
                      <span style={{ color: RED }}>{weiToTon(svc.priceWei)} TON</span>
                    </div>
                  ))
                )}
              </div>

              {/* Top Buyers */}
              <div style={{ background: 'white', border: `1px solid ${BORDER}` }}>
                <div style={{
                  padding: '8px 14px', background: '#F5F5F5', borderBottom: `1px solid ${BORDER}`,
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                }}>
                  TOP BUYERS
                </div>
                {stats.topBuyers.length === 0 ? (
                  <div style={{ padding: '16px 14px', fontSize: 11, color: '#888' }}>No sales yet.</div>
                ) : (
                  stats.topBuyers.map(buyer => (
                    <div key={buyer.agentId} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 14px', borderBottom: `1px solid #F0F0F0`,
                      fontSize: 12,
                    }}>
                      <span style={{ color: BLUE, fontFamily: FONT }}>{truncateAddr(buyer.agentId)}</span>
                      <span>{weiToTon(buyer.spentThisMonth)} TON</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Recent Sales ── */}
            <div style={{ background: 'white', border: `1px solid ${BORDER}` }}>
              <div style={{
                padding: '8px 14px', background: '#F5F5F5', borderBottom: `1px solid ${BORDER}`,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              }}>
                RECENT SALES
              </div>
              {stats.recentSales.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 11, color: '#888' }}>No recent sales.</div>
              ) : (
                stats.recentSales.map((sale, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, alignItems: 'center',
                    padding: '8px 14px', borderBottom: `1px solid #F0F0F0`,
                    fontSize: 11,
                  }}>
                    <span style={{ color: BLUE }}>{truncateAddr(sale.agentId)}</span>
                    <span style={{ color: '#555' }}>·</span>
                    <span>{sale.service}</span>
                    <span style={{ color: '#555' }}>·</span>
                    <span style={{ color: RED }}>{weiToTon(sale.amountWei)} TON</span>
                    <span style={{ marginLeft: 'auto', color: '#999' }}>{relativeTime(sale.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the page renders (dev server)**

```bash
# Open http://localhost:3002/marketplace in browser
# Expected: top bar with DASHBOARD + MARKETPLACE links, then disabled banner (since MARKETPLACE_ENABLED not set)
curl -s http://localhost:3002/marketplace | grep -c "DOCTYPE"
```

Expected: `1` (HTML page returned, not 404)

- [ ] **Step 4: Commit**

```bash
git add src/app/marketplace/page.tsx
git commit -m "feat(marketplace): add operator dashboard marketplace page /marketplace"
```

---

### Task 4: Add MARKETPLACE nav link to dashboard top bar

**Context:** `src/app/page.tsx` has a top bar at line ~921. The top bar has a left section (SENTINAI brand + status dots + chain name) and a right section (timestamp). Add a MARKETPLACE nav link between the existing blocks and the right timestamp. This is a `<a href="/marketplace">` styled like the SENTINAI brand block.

**Files:**
- Modify: `src/app/page.tsx` (top bar section, ~line 945)

- [ ] **Step 1: Find the exact insertion point**

```bash
grep -n "marginLeft.*auto\|timestamp\|toLocaleString" src/app/page.tsx | head -5
```

This finds the right-side timestamp `<div>` that starts with `style={{ marginLeft: 'auto' ...`.

- [ ] **Step 2: Insert MARKETPLACE link before the timestamp div**

In `src/app/page.tsx`, find the div with `marginLeft: 'auto'` in the top bar (the timestamp div). Insert this just before it:

```tsx
<a href="/marketplace" style={{
  padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center',
  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.8)',
  textDecoration: 'none', borderRight: '1px solid rgba(255,255,255,0.2)',
}}
  onMouseEnter={e => (e.currentTarget.style.color = 'white')}
  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
>
  MARKETPLACE
</a>
```

- [ ] **Step 3: Verify visually**

Open `http://localhost:3002` in browser. Top bar should show: `SENTINAI | ● CLUSTER ONLINE | ● L2 SYNC | Thanos Sepolia | MARKETPLACE | [timestamp]`

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(marketplace): add MARKETPLACE nav link to dashboard top bar"
```

---

## Chunk 3: Website Marketplace Page

### Task 5: Website components — ConnectGuide and InstanceCard

**Context:** Two simple components — `ConnectGuide.tsx` is fully static (no API), `InstanceCard.tsx` renders one registry row. Both are server components (no `'use client'`). Use inline styles matching the website's existing pattern.

**Files:**
- Create: `website/src/components/ConnectGuide.tsx`
- Create: `website/src/components/InstanceCard.tsx`

- [ ] **Step 1: Create `website/src/components/ConnectGuide.tsx`**

```typescript
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const RED = '#D40000';
const BORDER = '#D0D0D0';

function CodeBlock({ children }: { children: string }) {
  return (
    <div style={{
      background: '#F5F5F5', border: `1px solid ${BORDER}`,
      padding: '10px 14px', fontFamily: FONT, fontSize: 11,
      marginBottom: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    }}>
      {children}
    </div>
  );
}

export function ConnectGuide() {
  return (
    <div style={{ maxWidth: 680, padding: '32px 0', fontFamily: FONT }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 24 }}>
        HOW TO BUY DATA WITH x402
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 8 }}>
          1. Discover via AgentRegistry catalog
        </div>
        <CodeBlock>{`GET /api/marketplace/catalog
← 200 { services: [{ key: "txpool", priceWei: "100000000000000000" }, ...] }`}</CodeBlock>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 8 }}>
          2. Send request — get 402 back
        </div>
        <CodeBlock>{`curl https://sentinai.example.com/api/marketplace/txpool
← 402 {
    "x402Version": 1,
    "accepts": [{
      "scheme": "eip3009",
      "network": "ethereum",
      "maxAmountRequired": "100000000000000000",
      "asset": { "symbol": "TON", "decimals": 18 },
      "payTo": "0xOperatorAddress..."
    }]
  }`}</CodeBlock>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 8 }}>
          3. Sign EIP-3009 authorization + retry with X-PAYMENT header
        </div>
        <CodeBlock>{`// Sign transferWithAuthorization via EIP-3009
const sig = await signTypedData(wallet, {
  domain: { name: "Tokamak Network Token", chainId: 1, verifyingContract: TON_ADDRESS },
  types: { TransferWithAuthorization: [...] },
  message: { from, to: payTo, value: maxAmountRequired, validBefore, nonce }
});

// Retry original request with payment header
curl https://sentinai.example.com/api/marketplace/txpool \\
  -H "X-PAYMENT: <base64-encoded-payment-payload>"`}</CodeBlock>
      </div>

      <div style={{ fontSize: 11, color: RED, fontWeight: 600 }}>
        ← 200 OK · data returned · TON transferred
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `website/src/components/InstanceCard.tsx`**

```typescript
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const BORDER = '#D0D0D0';
const BLUE = '#0055AA';

export interface AgentInstance {
  name: string;
  chainId: string;      // e.g. "eip155:55004"
  nodeClient: string;   // e.g. "ethrex"
  serviceCount: number;
  x402: boolean;
}

export function InstanceCard({ instance }: { instance: AgentInstance }) {
  return (
    <div style={{
      background: 'white', border: `1px solid ${BORDER}`,
      padding: '10px 14px', display: 'flex', alignItems: 'center',
      gap: 12, fontFamily: FONT, fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, flex: '0 0 auto' }}>{instance.name}</span>
      <span style={{ color: BLUE, fontSize: 11 }}>{instance.chainId}</span>
      <span style={{ color: '#555', fontSize: 11 }}>· {instance.nodeClient}</span>
      <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11 }}>
        {instance.serviceCount} services
      </span>
      {instance.x402 && (
        <span style={{ fontSize: 10, color: '#27ae60', fontWeight: 600, marginLeft: 8 }}>
          x402 ✓
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors)

- [ ] **Step 4: Commit**

```bash
git add website/src/components/ConnectGuide.tsx website/src/components/InstanceCard.tsx
git commit -m "feat(marketplace): add ConnectGuide and InstanceCard website components"
```

---

### Task 6: Website components — ServiceGrid and RegistryBrowser

**Context:** `ServiceGrid.tsx` renders service cards in a tier-colored grid. `RegistryBrowser.tsx` is a server component that reads from the AgentRegistry via viem `getLogs` (or shows an empty list if `L1_RPC_URL` is not set). Both use inline styles matching the website's existing pattern.

**Files:**
- Create: `website/src/components/ServiceGrid.tsx`
- Create: `website/src/components/RegistryBrowser.tsx`

- [ ] **Step 1: Create `website/src/components/ServiceGrid.tsx`**

```typescript
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const RED = '#D40000';
const BLUE = '#0055AA';
const GREEN = '#27ae60';
const BORDER = '#D0D0D0';

export interface ServiceEntry {
  key: string;       // kebab-case (e.g. "scaling-history")
  priceWei: string;
  tier: 1 | 2;
  live: boolean;
}

function weiToTon(wei: string): string {
  const n = BigInt(wei);
  const whole = n / BigInt(1e18);
  const frac = (n % BigInt(1e18)) / BigInt(1e14);
  return frac === BigInt(0) ? whole.toString() : `${whole}.${frac.toString().padStart(4, '0').replace(/0+$/, '')}`;
}

export function ServiceGrid({ services }: { services: ServiceEntry[] }) {
  if (services.length === 0) {
    return (
      <div style={{ padding: '24px 0', fontSize: 12, color: '#888', fontFamily: FONT }}>
        No services available.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
      {services.map(svc => (
        <div key={svc.key} style={{
          background: 'white', border: `1px solid ${BORDER}`,
          borderTop: `3px solid ${svc.tier === 1 ? RED : BLUE}`,
          padding: '10px 12px', fontFamily: FONT,
        }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{svc.key}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{weiToTon(svc.priceWei)} TON</div>
          <div style={{ fontSize: 10, color: svc.live ? GREEN : '#999', fontWeight: 600 }}>
            {svc.live ? 'live ●' : 'offline ○'}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `website/src/components/RegistryBrowser.tsx`**

```typescript
import { InstanceCard } from './InstanceCard';
import type { AgentInstance } from './InstanceCard';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const BORDER = '#D0D0D0';

async function fetchRegistryInstances(): Promise<AgentInstance[]> {
  const l1Rpc = process.env.L1_RPC_URL;
  if (!l1Rpc) return [];

  try {
    // ERC-8004 AgentRegistry getLogs for Register events
    // Contract address from env; if not set, return empty
    const registryAddress = process.env.MARKETPLACE_REGISTRY_ADDRESS;
    if (!registryAddress) return [];

    const { createPublicClient, http, parseAbiItem } = await import('viem');

    // Use a minimal chain config derived from the L1_RPC_URL — avoids hardcoding mainnet/testnet.
    // The chain ID value is not used in getLogs calls; only the transport matters.
    const client = createPublicClient({
      chain: {
        id: 1,
        name: 'L1',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [l1Rpc] } },
      },
      transport: http(l1Rpc),
    });

    const logs = await client.getLogs({
      address: registryAddress as `0x${string}`,
      event: parseAbiItem('event Register(address indexed agent, string agentURI)'),
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    const instances: AgentInstance[] = [];

    for (const log of logs) {
      const agentURI = log.args.agentURI;
      if (!agentURI) continue;

      try {
        const res = await fetch(agentURI, { next: { revalidate: 300 } });
        if (!res.ok) continue;
        const data = await res.json();

        instances.push({
          name: data.name ?? `SentinAI #${instances.length + 1}`,
          chainId: data.chainId ?? 'unknown',
          nodeClient: data.nodeClient ?? 'unknown',
          serviceCount: Array.isArray(data.capabilities) ? data.capabilities.length : 0,
          x402: data.x402 === true,
        });
      } catch {
        // skip unreachable agentURIs
      }
    }

    return instances;
  } catch {
    return [];
  }
}

export async function RegistryBrowser() {
  const instances = await fetchRegistryInstances();
  const chainCount = new Set(instances.map(i => i.chainId)).size;

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Global stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'REGISTERED', value: instances.length.toString(), sub: 'instances' },
          { label: 'CHAINS', value: chainCount.toString(), sub: 'L2 networks' },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{
            background: 'white', border: `1px solid ${BORDER}`,
            padding: '12px 16px', minWidth: 100, flex: 1,
          }}>
            <div style={{ fontSize: 9, color: '#888', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{value}</div>
            <div style={{ fontSize: 10, color: '#555' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Instance list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {instances.length === 0 ? (
          <div style={{ fontSize: 12, color: '#888', padding: '24px 0' }}>
            No registered instances found.
            {!process.env.L1_RPC_URL && ' (Set L1_RPC_URL in Vercel to enable registry browsing.)'}
          </div>
        ) : (
          instances.map((inst, i) => <InstanceCard key={i} instance={inst} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors)

- [ ] **Step 4: Commit**

```bash
git add website/src/components/ServiceGrid.tsx website/src/components/RegistryBrowser.tsx
git commit -m "feat(marketplace): add ServiceGrid and RegistryBrowser website components"
```

---

### Task 7: Website MarketplaceTabs client component

**Context:** The tab switcher must be `'use client'` because it uses `useState`. It receives `instanceEndpoint` (from `NEXT_PUBLIC_OPERATOR_ENDPOINT`) as a prop and fetches the catalog client-side for the "This Instance" tab. The `RegistryBrowser` is rendered as a Server Component child passed in as a prop — this avoids "async component inside client component" issues in Next.js 15+.

**Files:**
- Create: `website/src/components/MarketplaceTabs.tsx`

- [ ] **Step 1: Create `website/src/components/MarketplaceTabs.tsx`**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { ServiceGrid } from './ServiceGrid';
import { ConnectGuide } from './ConnectGuide';
import type { ServiceEntry } from './ServiceGrid';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const RED = '#D40000';
const BORDER = '#D0D0D0';

type TabId = 'registry' | 'instance' | 'guide';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'instance', label: 'THIS INSTANCE' },
  { id: 'registry', label: 'BROWSE REGISTRY' },
  { id: 'guide', label: 'CONNECT GUIDE' },
];

interface CatalogService {
  key: string;
  priceWei: string;
  tier: 1 | 2;
}

function useInstanceServices(endpoint: string | null) {
  const [services, setServices] = useState<ServiceEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!endpoint) return;
    fetch(`${endpoint}/api/marketplace/catalog`)
      .then(r => r.json())
      .then((data: { services?: CatalogService[] }) => {
        const entries: ServiceEntry[] = (data.services ?? []).map(s => ({
          key: s.key.replaceAll('_', '-'),
          priceWei: s.priceWei,
          tier: s.tier,
          live: true,
        }));
        setServices(entries);
      })
      .catch(() => setError(true));
  }, [endpoint]);

  return { services, error };
}

export function MarketplaceTabs({
  registryContent,
}: {
  registryContent: React.ReactNode;
}) {
  // Read NEXT_PUBLIC_* in the client component — RSC cannot reliably read these at runtime
  const instanceEndpoint = process.env.NEXT_PUBLIC_OPERATOR_ENDPOINT ?? null;
  const [activeTab, setActiveTab] = useState<TabId>('registry');
  const { services, error: catalogError } = useInstanceServices(instanceEndpoint);

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: `2px solid ${BORDER}`, marginBottom: 24,
      }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 20px', fontFamily: FONT, fontSize: 10, fontWeight: 700,
            letterSpacing: '0.1em', cursor: 'pointer', border: 'none', background: 'none',
            borderBottom: activeTab === tab.id ? `3px solid ${RED}` : '3px solid transparent',
            color: activeTab === tab.id ? RED : '#555',
            marginBottom: -2,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'registry' && registryContent}

      {activeTab === 'instance' && (
        <div>
          {!instanceEndpoint && (
            <div style={{ fontSize: 12, color: '#888', padding: '24px 0' }}>
              Set NEXT_PUBLIC_OPERATOR_ENDPOINT to your SentinAI instance URL to display services.
            </div>
          )}
          {instanceEndpoint && !services && !catalogError && (
            <div style={{ fontSize: 12, color: '#888', padding: '24px 0' }}>Loading services...</div>
          )}
          {catalogError && (
            <div style={{ fontSize: 12, color: RED, padding: '24px 0' }}>
              Failed to reach operator endpoint. Check NEXT_PUBLIC_OPERATOR_ENDPOINT.
            </div>
          )}
          {services && <ServiceGrid services={services} />}
        </div>
      )}

      {activeTab === 'guide' && <ConnectGuide />}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd website && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add website/src/components/MarketplaceTabs.tsx
git commit -m "feat(marketplace): add MarketplaceTabs client component with 3-tab layout"
```

---

### Task 8: Website marketplace page and nav link

**Context:** The page is an RSC (no `'use client'`). It reads `NEXT_PUBLIC_OPERATOR_ENDPOINT` from `process.env` server-side (available in RSC), renders `<RegistryBrowser>` server-side, and passes it as `registryContent` prop to the client `<MarketplaceTabs>` component.

**Files:**
- Create: `website/src/app/marketplace/page.tsx`
- Modify: `website/src/app/page.tsx` (add MARKETPLACE to nav links)

- [ ] **Step 1: Create `website/src/app/marketplace/` directory**

```bash
mkdir -p website/src/app/marketplace
```

- [ ] **Step 2: Create `website/src/app/marketplace/page.tsx`**

```typescript
import { RegistryBrowser } from '@/components/RegistryBrowser';
import { MarketplaceTabs } from '@/components/MarketplaceTabs';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";
const RED = '#D40000';
const BORDER = '#D0D0D0';

export const metadata = {
  title: 'SentinAI Marketplace — Agent Data Economy',
  description: 'Discover SentinAI instances, browse monitoring data services, and connect via x402.',
};

export default function MarketplacePage() {
  // Note: NEXT_PUBLIC_OPERATOR_ENDPOINT is read inside MarketplaceTabs (client component)
  // where NEXT_PUBLIC_* env vars are reliably available at runtime.
  return (
    <div style={{
      background: '#FFFFFF', minHeight: '100vh', fontFamily: FONT, color: '#0A0A0A',
    }}>
      {/* Page header */}
      <div style={{
        borderBottom: `1px solid ${BORDER}`, padding: '32px 48px 0',
        background: '#FAFAFA',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', color: RED, marginBottom: 8 }}>
            AGENT ECONOMY
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4, letterSpacing: '-0.02em' }}>
            SentinAI Marketplace
          </h1>
          <p style={{ fontSize: 12, color: '#555', margin: 0, marginBottom: 24 }}>
            Discover SentinAI instances selling L2 monitoring data to AI agents via x402.
          </p>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 48px' }}>
        <MarketplaceTabs registryContent={<RegistryBrowser />} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add MARKETPLACE nav link to website Navbar**

In `website/src/app/page.tsx`, find the nav links array:

```typescript
{ href: '/docs', label: 'DOCS' },
{ href: '/connect', label: 'DEPLOY' },
```

Add MARKETPLACE between DOCS and DEPLOY:

```typescript
{ href: '/docs', label: 'DOCS' },
{ href: '/marketplace', label: 'MARKETPLACE' },
{ href: '/connect', label: 'DEPLOY' },
```

- [ ] **Step 4: Verify website builds**

```bash
cd website && npm run build 2>&1 | tail -20
```

Expected: no errors, `Route (app)` table shows `/marketplace` as a static route

- [ ] **Step 5: Commit**

```bash
git add website/src/app/marketplace/page.tsx website/src/app/page.tsx
git commit -m "feat(marketplace): add public website marketplace page and nav link"
```

---

## Chunk 4: Integration Verification

### Task 9: End-to-end verification

**Context:** Verify all pages render, all routes respond, and TypeScript has no errors across both apps. This is a smoke test — not automated tests (UI components are not unit-testable in Vitest without jsdom setup).

**Files:** None (read-only verification)

- [ ] **Step 1: Run full TypeScript check on both apps**

```bash
# Dashboard app
npx tsc --noEmit 2>&1 | grep -E "error|Error" | head -20
echo "Dashboard exit: $?"

# Website app
cd website && npx tsc --noEmit 2>&1 | grep -E "error|Error" | head -20
echo "Website exit: $?"
```

Expected: both exit 0, no errors

- [ ] **Step 2: Run lint on both apps**

```bash
npm run lint 2>&1 | tail -10
cd website && npm run lint 2>&1 | tail -10
```

Expected: no errors (or only pre-existing warnings)

- [ ] **Step 3: Test stats API**

```bash
curl -s http://localhost:3002/api/marketplace/stats | python3 -m json.tool
```

Expected:
```json
{
  "enabled": false,
  "totalEarnedThisMonth": "0",
  "totalCallsToday": 0,
  "activeBuyerCount": 0,
  "services": [],
  "topBuyers": [],
  "recentSales": []
}
```

- [ ] **Step 4: Test with MARKETPLACE_ENABLED=true**

Add to `.env.local` temporarily:
```
MARKETPLACE_ENABLED=true
```

Then restart the dev server and re-run:
```bash
curl -s http://localhost:3002/api/marketplace/stats | python3 -m json.tool
```

Expected: same shape but `"enabled": true`

Remove the temp env var when done (or leave it if continuing with marketplace development).

- [ ] **Step 5: Verify dashboard marketplace page**

```bash
curl -sf http://localhost:3002/marketplace | grep -c "DOCTYPE"
```

Expected: `1`

- [ ] **Step 6: Build both apps for production**

```bash
npm run build 2>&1 | tail -20
cd website && npm run build 2>&1 | tail -20
```

Expected: both succeed

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(marketplace): complete marketplace UI implementation

- Add GET /api/marketplace/stats (Phase 1 stub, hardcoded zeros)
- Add operator dashboard /marketplace page with 4-stat header + services/buyers/sales
- Add website /marketplace page with Browse Registry, This Instance, Connect Guide tabs
- Add MARKETPLACE nav links to dashboard top bar and website navbar
- Add CORS header to /api/marketplace/catalog for cross-origin website access"
```
