# SentinAI Marketplace Architecture

## Overview

SentinAI marketplace enables node operators to monetize their operational data
and buyers to purchase real-time L1/L2 infrastructure insights via x402 TON payments.

## On-chain Contracts (Sepolia)

| Contract | Address | Purpose |
|---|---|---|
| **ERC8004Registry** | `0x64c8f8cB66657349190c7AF783f8E0254dCF1467` | Operator registration (agentURI) |
| **FacilitatorV2** | `0xdcb25d78fbaeafdef5672aca204603c2d202ceef` | Payment settlement (approveAndCall + two-hop) |
| **ReviewRegistry** | `0x3b5F5d476e53c970e8cb2b1b547B491dcBAa5b02` | Trade records + buyer reviews |
| **TON (SeigToken)** | `0xa30fe40285B8f5c0457DbC3B7C8A280373c40044` | Payment token |

## Purchase Flow

```
Buyer                       Frontend                    TON Contract              FacilitatorV2              ReviewRegistry
  │                            │                            │                         │                         │
  ├─ BUY DATA click ──────────►│                            │                         │                         │
  │                            ├─ fetch payment-requirements│                         │                         │
  │                            │◄─ facilitator addr + EIP712│                         │                         │
  │                            │                            │                         │                         │
  │◄─ MetaMask EIP-712 sign ───┤                            │                         │                         │
  │── signature ──────────────►│                            │                         │                         │
  │                            │                            │                         │                         │
  │◄─ MetaMask approveAndCall ─┤                            │                         │                         │
  │── confirm tx ─────────────►├─ approveAndCall(fac, amt, data) ─────────────────────►│                         │
  │                            │                            ├─ approve(fac, amt)       │                         │
  │                            │                            ├─ onApprove(buyer, amt, data) ──►│                  │
  │                            │                            │                         ├─ verify EIP-712 sig     │
  │                            │                            │                         ├─ require(buyer≠merchant)│
  │                            │                            │                         ├─ transferFrom(buyer→fac)│
  │                            │                            │◄────────────────────────────── TON transfer ✅     │
  │                            │                            │                         ├─ transfer(fac→merchant) │
  │                            │                            │◄────────────────────────────── TON transfer ✅     │
  │                            │                            │                         ├─ recordTrade() ─────────►│
  │                            │                            │                         │                         ├─ TradeRecorded event
  │                            │                            │                         ├─ Settled event          │
  │                            │                            │                         │                         │
  │                            ├─ fetch data with X-PAYMENT header ──► Main App API   │                         │
  │                            │◄─ operational data (JSON) ────────── verified + returned                       │
  │◄─ show purchased data ─────┤                            │                         │                         │
```

## SeigToken Compatibility

TON on Sepolia is a SeigToken which restricts `transferFrom`:
- `msg.sender` must be `from` (sender) or `to` (recipient)
- Standard ERC20 `approve + transferFrom` by third party fails

**Solution: Two-hop transfer in FacilitatorV2**
1. `transferFrom(buyer → Facilitator)` — Facilitator is recipient ✅
2. `transfer(Facilitator → merchant)` — Facilitator is sender ✅
3. Facilitator holds zero balance after each settlement

## Anti-Wash-Trading

- `require(sender != merchant)` — self-trade blocked at contract level
- Guardian Score weights: star reviews (5x) >> trade count (1x)
- Trade count bonus capped at +3°C regardless of volume
- Gas cost is natural deterrent on mainnet

## Review System

### Auto Trade Record (gas-free for buyer)
- Recorded automatically during settlement in `onApprove`
- Stored in ReviewRegistry as `TradeRecorded` event
- Proves a purchase happened (verifiable on-chain)

### Manual Star Review (requires gas)
- Buyer submits ratings (1-5) for 4 categories via ReviewRegistry
- Purchase proof: `Facilitator.usedNonces(nonce)` must be true
- One review per settlement nonce (no spam)
- Stored as `ReviewSubmitted` event

### Guardian Score (Temperature)
- Base: 36.5°C
- Star reviews: ±0.5°C per review (time-decayed, 90-day half-life)
- Trade count: +0.1°C × √trades (capped at +3°C)
- Range: 0°C – 99°C
- Levels: Cold (🥶) → Cool (😐) → New (🆕) → Warm (😊) → Hot (🔥) → Legendary (🏆)

## Data Services (12 endpoints)

| Service | Price | Endpoint |
|---|---|---|
| Sequencer Health | 0.10 TON | `/api/agent-marketplace/sequencer-health` |
| Incident Summary | 0.15 TON | `/api/agent-marketplace/incident-summary` |
| Batch Submission | 0.15 TON | `/api/agent-marketplace/batch-submission-status` |
| Derivation Lag | 0.10 TON | `/api/agent-marketplace/derivation-lag` |
| Anomaly Feed | 0.10 TON | `/api/agent-marketplace/anomaly-feed` |
| Health Diagnostics | 0.15 TON | `/api/agent-marketplace/health-diagnostics` |
| RCA Report | 0.25 TON | `/api/agent-marketplace/rca-report` |
| Request Count | 0.05 TON | `/api/agent-marketplace/request-count` |
| Latency Stats | 0.05 TON | `/api/agent-marketplace/latency-stats` |
| Error Rate | 0.05 TON | `/api/agent-marketplace/error-rate` |
| Alert Status | 0.10 TON | `/api/agent-marketplace/alert-status` |
| SLA Metrics | 0.30 TON | `/api/agent-marketplace/sla-metrics` |

## Operator Onboarding

1. Deploy SentinAI with your L1/L2 node
2. Register on ERC8004Registry: `register(agentURI)` where agentURI points to your `/api/agent-marketplace/agent.json`
3. Set `OPERATOR_DISPLAY_NAME` and `OPERATOR_DESCRIPTION` in `.env.local`
4. Your node appears on the marketplace automatically (on-chain discovery)
5. Buyers purchase your data → TON payments settle to your address

## Buyer Guide

1. Visit marketplace: `https://sentinai-xi.vercel.app/marketplace`
2. Select an operator → view available services
3. Click BUY DATA → connect MetaMask (Sepolia network)
4. Sign EIP-712 authorization (gas-free)
5. Confirm `approveAndCall` transaction (gas + TON payment)
6. View purchased data in the result modal
7. Optionally submit a star review (on-chain, gas required)

## Environment Variables

### Main App (sentinai.tokamak.network)
```
FACILITATOR_ADDRESS=0xdcb25d78fbaeafdef5672aca204603c2d202ceef
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
MARKETPLACE_PAYMENT_MODE=facilitated  # or 'open' for testing
```

### Website (sentinai-xi.vercel.app)
```
FACILITATOR_ADDRESS=0xdcb25d78fbaeafdef5672aca204603c2d202ceef
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```
