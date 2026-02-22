import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  McpBridgeClient,
  McpBridgeHttpError,
  McpBridgeTransportError,
} from '@/lib/mcp-bridge-client';

describe('mcp-bridge-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should forward request with api key and approval token headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new McpBridgeClient({
      endpointUrl: 'http://127.0.0.1:3002/api/mcp',
      apiKey: 'test-key',
    });

    const response = await client.invoke(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { requestId: 'req-1', approvalToken: 'approve-1' }
    );

    expect(response.result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(url).toBe('http://127.0.0.1:3002/api/mcp');
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['x-request-id']).toBe('req-1');
    expect(headers['x-mcp-approval-token']).toBe('approve-1');
  });

  it('should throw HTTP error with server message when response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32003, message: '읽기 전용 모드입니다.' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new McpBridgeClient({
      endpointUrl: 'http://127.0.0.1:3002/api/mcp',
    });

    await expect(client.invoke({ jsonrpc: '2.0', id: 1, method: 'scale_component' }))
      .rejects
      .toBeInstanceOf(McpBridgeHttpError);
  });

  it('should throw transport error when server returns non-json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>invalid</html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new McpBridgeClient({
      endpointUrl: 'http://127.0.0.1:3002/api/mcp',
    });

    await expect(client.invoke({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      .rejects
      .toBeInstanceOf(McpBridgeTransportError);
  });
});

