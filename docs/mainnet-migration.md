# Mainnet Migration Checklist

## Pre-migration

### Contracts
- [ ] Audit FacilitatorV2 + ReviewRegistry (self-trade prevention, two-hop transfer)
- [ ] Verify mainnet TON token behavior matches SeigToken `transferFrom` restriction
- [ ] Deploy FacilitatorV2 with mainnet TON address
- [ ] Deploy ReviewRegistry with mainnet FacilitatorV2 address
- [ ] Call `setReviewRegistry()` to link contracts
- [ ] Verify all contracts on Etherscan

### Environment Variables
- [ ] Update `FACILITATOR_ADDRESS` to mainnet deployment
- [ ] Update `SEPOLIA_RPC_URL` → mainnet RPC (or add `MAINNET_RPC_URL`)
- [ ] Update `ERC8004_REGISTRY_ADDRESS` if deploying new registry
- [ ] Update TON token address in `payment-requirements` API

### Code Changes
- [ ] `payment-requirements/route.ts`: change chainId from 11155111 to 1
- [ ] `review-onchain.ts`: update all contract addresses
- [ ] `reviews-onchain/route.ts`: update REVIEW_REGISTRY address + deploy block
- [ ] `operators/route.ts`: update REGISTRY_ADDRESS + deploy block
- [ ] `trade-stats.ts`: update REGISTRY_ADDRESS + TON_ADDRESS
- [ ] `x402-buyer.ts`: update SEPOLIA_CHAIN_ID → mainnet chain ID
- [ ] `PurchaseModal.tsx`: update SEPOLIA_CHAIN_ID
- [ ] EIP-712 domain: update chainId in contract constructor

### Configuration Pattern
```env
# Use CHAIN_ID to switch all addresses at once
CHAIN_ID=1                    # 1 = mainnet, 11155111 = sepolia
TON_TOKEN_ADDRESS=0x...       # mainnet TON
FACILITATOR_ADDRESS=0x...     # mainnet FacilitatorV2
REVIEW_REGISTRY_ADDRESS=0x... # mainnet ReviewRegistry
ERC8004_REGISTRY_ADDRESS=0x...# mainnet ERC8004Registry
RPC_URL=https://...           # mainnet RPC
```

## Gas Cost Estimates (Mainnet)

| Operation | Gas | Est. Cost (@ 30 gwei, $3000 ETH) |
|---|---|---|
| approveAndCall (purchase) | ~250k | ~$0.025 |
| submitReview | ~150k | ~$0.015 |
| register (operator) | ~100k | ~$0.010 |

## Post-migration

- [ ] Test full purchase flow on mainnet with small amount
- [ ] Verify Settled + TradeRecorded events on Etherscan
- [ ] Verify operator discovery from mainnet registry
- [ ] Monitor gas costs for first 10 transactions
- [ ] Update documentation with mainnet addresses
