#!/usr/bin/env bash
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
VIEWER_TOKEN=${VIEWER_TOKEN:-viewer-demo-token}
OPERATOR_TOKEN=${OPERATOR_TOKEN:-operator-demo-token}

echo "[1] status"
curl -sS "$BASE/v1/ops/status" -H "Authorization: Bearer $VIEWER_TOKEN" | head -c 200; echo

echo "[2] plan"
PLAN_JSON=$(curl -sS "$BASE/v1/ops/plan" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"smoke-1","action":"restore_l1_connectivity","target":{"environment":"staging","platform":"k8s","service":"op-node"}}')

echo "$PLAN_JSON" | head -c 400; echo

PLAN_ID=$(node -e "const x=JSON.parse(process.argv[1]);console.log(x.planId)" "$PLAN_JSON")
CONFIRM=$(node -e "const x=JSON.parse(process.argv[1]);console.log(x.confirmToken)" "$PLAN_JSON")

echo "[3] verify"
curl -sS "$BASE/v1/ops/verify" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"requestId\":\"smoke-2\",\"planId\":\"$PLAN_ID\",\"target\":{\"environment\":\"staging\",\"platform\":\"k8s\",\"service\":\"op-node\"}}" | head -c 400; echo

echo "[4] execute (dry-run)"
EXEC_JSON=$(curl -sS -i "$BASE/v1/ops/execute" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"requestId\":\"smoke-3\",\"planId\":\"$PLAN_ID\",\"confirmToken\":\"$CONFIRM\",\"target\":{\"environment\":\"staging\",\"platform\":\"k8s\",\"service\":\"op-node\"},\"dryRun\":true}")

echo "$EXEC_JSON" | head -c 500; echo

echo "OK"
