#!/usr/bin/env node

import http from 'node:http';

const PORT = Number.parseInt(process.env.PORT || '8081', 10);
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:3050';
const L1_RPC_URL = process.env.L1_RPC_URL || 'http://localhost:8545';
const ZK_SETTLEMENT_LAYER = process.env.ZK_SETTLEMENT_LAYER || 'l1';
const ZK_FINALITY_MODE = process.env.ZK_FINALITY_MODE || 'confirmed';
const HEALTH_MAX_POSTING_LAG_SEC = Number.parseInt(process.env.HEALTH_MAX_POSTING_LAG_SEC || '120', 10);

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC 오류');
  }
  return data.result;
}

function parseHexToInt(value) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return 0;
  return Number.parseInt(value, 16);
}

async function collectStatus() {
  const nowSec = Math.floor(Date.now() / 1000);
  let l2Ok = false;
  let l1Ok = false;
  let postingLagSec = 0;
  let l2BlockNumber = 0;
  let l1BlockNumber = 0;
  let latestBlockTxCount = 0;
  let txpoolPending = 0;
  let idleMode = false;
  const errors = [];

  try {
    const l2BlockHex = await rpcCall(L2_RPC_URL, 'eth_blockNumber');
    l2BlockNumber = parseHexToInt(l2BlockHex);
    const latestBlock = await rpcCall(L2_RPC_URL, 'eth_getBlockByNumber', ['latest', false]);
    latestBlockTxCount = Array.isArray(latestBlock?.transactions) ? latestBlock.transactions.length : 0;
    const blockTimestamp = parseHexToInt(latestBlock?.timestamp);
    postingLagSec = blockTimestamp > 0 ? Math.max(0, nowSec - blockTimestamp) : 0;
    try {
      const txpoolStatus = await rpcCall(L2_RPC_URL, 'txpool_status');
      txpoolPending = parseHexToInt(txpoolStatus?.pending);
    } catch {
      txpoolPending = 0;
    }
    idleMode = txpoolPending === 0 && latestBlockTxCount === 0;
    l2Ok = true;
  } catch (error) {
    errors.push(`L2 RPC 실패: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const l1BlockHex = await rpcCall(L1_RPC_URL, 'eth_blockNumber');
    l1BlockNumber = parseHexToInt(l1BlockHex);
    l1Ok = true;
  } catch (error) {
    errors.push(`L1 RPC 실패: ${error instanceof Error ? error.message : String(error)}`);
  }

  const healthy = l1Ok && l2Ok && (
    postingLagSec <= HEALTH_MAX_POSTING_LAG_SEC ||
    idleMode
  );

  return {
    layer: ZK_SETTLEMENT_LAYER,
    finalityMode: ZK_FINALITY_MODE,
    postingLagSec,
    healthy,
    componentStatus: {
      'zk-batcher': l1Ok && l2Ok ? 'Running' : 'Degraded',
      'zk-prover': l2Ok ? 'Running' : 'Degraded',
      'zksync-server': l2Ok ? 'Running' : 'Degraded',
    },
    diagnostics: {
      l2RpcUrl: L2_RPC_URL,
      l1RpcUrl: L1_RPC_URL,
      l2BlockNumber,
      l1BlockNumber,
      latestBlockTxCount,
      txpoolPending,
      idleMode,
      thresholdSec: HEALTH_MAX_POSTING_LAG_SEC,
      errors,
      checkedAt: new Date().toISOString(),
    },
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    writeJson(res, 400, { error: '잘못된 요청입니다.' });
    return;
  }

  if (req.url === '/healthz') {
    writeJson(res, 200, { status: 'ok', checkedAt: new Date().toISOString() });
    return;
  }

  if (req.url === '/status/settlement') {
    try {
      const status = await collectStatus();
      writeJson(res, 200, status);
    } catch (error) {
      writeJson(res, 500, {
        error: 'settlement 상태 수집 실패',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  writeJson(res, 404, { error: '지원하지 않는 경로입니다.' });
});

server.listen(PORT, () => {
  console.log(`[zk-settlement-probe] 실행 중: http://localhost:${PORT}/status/settlement`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
