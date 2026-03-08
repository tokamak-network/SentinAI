# Setup Wizard Design

**Date**: 2026-03-08
**Status**: Approved
**Scope**: Landing page setup wizard for self-hosted SentinAI deployment

## Problem

Ethrex (and other EVM client) operators who want to monitor their node with SentinAI must manually create `.env.local` and configure `docker-compose.yml`. There is no guided path from "I want to try SentinAI" to "it's running."

## Solution

A dedicated `/setup` page on the landing site (`website/`) that collects configuration and generates a one-shot shell script the user pastes into their terminal.

## Architecture

```
website/                          ← Landing site (Vercel)
  src/app/
    page.tsx                      ← Existing landing (add "Get Started →" CTA)
    setup/
      page.tsx                    ← New Setup Wizard page
  src/lib/
    generate-setup-script.ts      ← Pure function: SetupConfig → shell script string
  src/components/
    setup/
      SetupWizard.tsx             ← Form component (client component)
      ScriptOutput.tsx            ← Syntax-highlighted output + Copy button

src/app/ (dashboard)              ← Separate app, runs via Docker
```

## User Flow

```
Landing page
  → "Get Started" CTA button
  → /setup page
  → Fill in form (client, RPC URL, network name, AI key)
  → Script updates in real-time (debounce 300ms)
  → Copy script
  → Paste into terminal
  → docker compose up -d
  → Open http://localhost:3002 (dashboard)
```

## Form Inputs

| Field | Type | Required | Default |
|-------|------|----------|---------|
| EVM Client | Dropdown (geth / reth / nethermind / besu / erigon / op-geth / nitro-node / ethrex / other) | Yes | geth |
| L2 RPC URL | Text | Yes | — |
| Network Name | Text | No | My Network |
| AI Provider | Dropdown (none / qwen / anthropic / openai / gemini) | No | none |
| AI API Key | Text (conditional on provider) | Conditional | — |

## Generated Script

```bash
#!/bin/bash
set -e
mkdir -p sentinai && cd sentinai
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/docker-compose.yml -o docker-compose.yml
cat > .env.local << 'SENTINAI_EOF'
NEXT_PUBLIC_NETWORK_NAME=My Network
L2_RPC_URL=http://127.0.0.1:8545
SENTINAI_CLIENT_FAMILY=geth
SCALING_SIMULATION_MODE=true
QWEN_API_KEY=sk-xxx
SENTINAI_EOF
docker compose up -d
echo "✓ SentinAI is running at http://localhost:3002"
```

`docker-compose.yml` is fetched from GitHub main branch (always latest version).

## UI Layout

Two-column layout on `/setup`:

```
┌──────────────────────────────────────────────────────┐
│  🚀 Deploy SentinAI in 30 seconds                    │
│                                                      │
│  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  ① Configure     │  │  ② Run this script       │  │
│  │                  │  │                          │  │
│  │  Client   [▼]    │  │  $ bash <(cat << 'EOF'   │  │
│  │  RPC URL  [____] │  │    mkdir -p sentinai...  │  │
│  │  Network  [____] │  │    ...                   │  │
│  │  AI Key   [____] │  │  EOF                     │  │
│  │                  │  │  )                [Copy] │  │
│  └──────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

- Script updates in real-time as form values change (300ms debounce)
- Copy button shows "Copied!" feedback for 2 seconds
- Copy button disabled when RPC URL is empty

## Script Generation Logic

```typescript
// website/src/lib/generate-setup-script.ts
interface SetupConfig {
  clientFamily: string;
  rpcUrl: string;
  networkName: string;
  aiProvider: string;
  aiApiKey: string;
}

const AI_KEY_VAR: Record<string, string> = {
  qwen: 'QWEN_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const COMPOSE_RAW_URL =
  'https://raw.githubusercontent.com/tokamak-network/SentinAI/main/docker-compose.yml';

export function generateSetupScript(config: SetupConfig): string {
  const envLines = [
    `NEXT_PUBLIC_NETWORK_NAME=${config.networkName || 'My Network'}`,
    `L2_RPC_URL=${config.rpcUrl}`,
    `SENTINAI_CLIENT_FAMILY=${config.clientFamily}`,
    `SCALING_SIMULATION_MODE=true`,
    config.aiProvider !== 'none' && config.aiApiKey
      ? `${AI_KEY_VAR[config.aiProvider]}=${config.aiApiKey}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `#!/bin/bash
set -e
mkdir -p sentinai && cd sentinai
curl -sSL ${COMPOSE_RAW_URL} -o docker-compose.yml
cat > .env.local << 'SENTINAI_EOF'
${envLines}
SENTINAI_EOF
docker compose up -d
echo "✓ SentinAI is running at http://localhost:3002"`;
}
```

## Separation of Concerns

- **`website/`** (Vercel): Landing page + `/setup` wizard — static, no sensitive data
- **Dashboard** (`src/app/`): Runs via Docker on user's machine — never on Vercel

The `/setup` page only generates a script; it never receives or stores user credentials.

## Out of Scope

- Server-side config persistence
- One-click install (curl | bash from a unique URL)
- K8s / ECS deployment variants (future)
