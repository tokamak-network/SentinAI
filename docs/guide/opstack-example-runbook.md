# OP Stack Example Execution/Verification/End Runbook

Base date: 2026-02-20

This document summarizes the procedure for connecting the OP Stack local chain to SentinAI based on the `examples/opstack/` template, verifying whether it is running normally, and then terminating it.

---

## 1. Preparation

essential:
- Docker / Docker Compose
- OP Stack local compose environment (`op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger`)
- SentinAI repository

Template:
- `examples/opstack/.env.example`

---

## 2. Settings

### 2.1 SentinAI `.env.local` reflection

Set `.env.local` based on the value below.

```bash
CHAIN_TYPE=optimism
L2_RPC_URL=http://localhost:8545
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org

ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/absolute/path/to/your-opstack/docker-compose.yml
DOCKER_COMPOSE_PROJECT=opstack-local

NEXT_PUBLIC_NETWORK_NAME=OP Stack Local L2
```

Select (monitoring extension):

```bash
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...

FAULT_PROOF_ENABLED=true
DISPUTE_GAME_FACTORY_ADDRESS=0x...
```

### 2.2 Check path

Make sure `DOCKER_COMPOSE_FILE` points to the actual OP Stack compose file.

```bash
test -f /absolute/path/to/your-opstack/docker-compose.yml && echo "OK"
```

---

## 3. Run

### 3.1 Running OP Stack container

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local up -d
```

### 3.2 Running SentinAI

```bash
cd /Users/theo/workspace_tokamak/SentinAI
npm run dev
```

---

## 4. Verification of normal chain operation

### 4.1 Container status

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local ps
```

Normal standards:
- `op-geth`, `op-node`가 `Up`
- Batcher/Proposer/Challenger ‘Up’ without repeated restarts

### 4.2 Check RPC response

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Normal standards:
- `eth_chainId` matches expected chain ID
- `eth_blockNumber` is `0x0` or higher, increasing over time

### 4.3 Check block increase (continuous)

```bash
b1=$(curl -s http://localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -r '.result')
sleep 5
b2=$(curl -s http://localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -r '.result')
echo "before=$b1 after=$b2"
```

Normal standards:
- `after >= before`

### 4.4 Verify SentinAI connection

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  chain: .chain.type,
  blockHeight: .metrics.blockHeight,
  status: .status,
  components: (.components | map(.component))
}'
```

Normal standards:
- `chain = "optimism"`
- `blockHeight` is not `null`
- `components` contains OP components

---

## 5. End

### 5.1 End of SentinAI

```bash
pkill -f 'next dev -p 3002' || true
```

### 5.2 Terminating OP Stack container

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local down
```

To clean up to a volume:

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local down -v
```

---

## 6. Frequently encountered problems

1. `eth_blockNumber` not incrementing
- Check the `op-node` log and `op-geth` log.
- Check for L1 RPC restrictions/errors.

2. SentinAI `components` is empty or partially displayed
- Check `ORCHESTRATOR_TYPE=docker`
- `DOCKER_COMPOSE_FILE`, `DOCKER_COMPOSE_PROJECT` 값 확인
- If the compose service name is significantly different from the default name, such as `op-geth`, the mapping logic may need to be strengthened.

3. Fault proof card is different from expectations
- `FAULT_PROOF_ENABLED=true`
- Check whether `DISPUTE_GAME_FACTORY_ADDRESS` is set.
