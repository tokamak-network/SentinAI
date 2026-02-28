import http from 'http';

export async function startMockJsonRpcServer(options?: { port?: number }) {
  const port = options?.port ?? 0;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }

    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      try {
        const json = JSON.parse(body) as { method?: string; id?: number };
        const method = json.method;

        const ok = (result: unknown) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id ?? 1, result }));
        };

        switch (method) {
          case 'eth_blockNumber':
            ok('0x1234');
            return;
          case 'web3_clientVersion':
            ok('Geth/v1.14.13-stable');
            return;
          case 'eth_chainId':
            ok('0xa');
            return;
          case 'eth_syncing':
            ok(false);
            return;
          case 'net_peerCount':
            ok('0x2');
            return;
          case 'admin_peers':
            ok([{ id: 1 }, { id: 2 }]);
            return;
          case 'txpool_status':
            ok({ pending: '0x0', queued: '0x0' });
            return;
          default:
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id ?? 1, error: { code: -32601, message: 'Method not found' } }));
            return;
        }
      } catch {
        res.statusCode = 400;
        res.end('bad request');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
