import { describe, expect, it } from 'vitest';
import {
  buildJsonRpcErrorResponse,
  encodeStdioFrame,
  expectsJsonRpcResponse,
  extractApprovalToken,
  extractJsonRpcId,
  parseStdioFrames,
} from '@/lib/mcp-stdio-transport';

describe('mcp-stdio-transport', () => {
  it('should encode and parse one stdio frame', () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const encoded = encodeStdioFrame(payload);
    const parsed = parseStdioFrames(encoded);

    expect(parsed.protocolErrors).toHaveLength(0);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.rest.length).toBe(0);
    expect(JSON.parse(parsed.messages[0])).toEqual(payload);
  });

  it('should parse multiple frames in one buffer', () => {
    const first = encodeStdioFrame({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const second = encodeStdioFrame({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const merged = Buffer.concat([first, second]);

    const parsed = parseStdioFrames(merged);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.rest.length).toBe(0);
  });

  it('should keep incomplete frame in rest buffer', () => {
    const full = encodeStdioFrame({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const partial = full.slice(0, full.length - 5);
    const parsed = parseStdioFrames(partial);

    expect(parsed.messages).toHaveLength(0);
    expect(parsed.rest.equals(partial)).toBe(true);
  });

  it('should extract approval token from direct params and tools/call arguments', () => {
    expect(extractApprovalToken({
      jsonrpc: '2.0',
      id: 1,
      method: 'scale_component',
      params: { approvalToken: 'token-1' },
    })).toBe('token-1');

    expect(extractApprovalToken({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'scale_component',
        arguments: { approvalToken: 'token-2' },
      },
    })).toBe('token-2');
  });

  it('should detect response expectation and id extraction', () => {
    expect(expectsJsonRpcResponse({ jsonrpc: '2.0', id: 10, method: 'get_metrics' })).toBe(true);
    expect(expectsJsonRpcResponse({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(false);
    expect(extractJsonRpcId({ jsonrpc: '2.0', id: 'abc' })).toBe('abc');
    expect(extractJsonRpcId({ jsonrpc: '2.0', method: 'x' })).toBeNull();
  });

  it('should build json-rpc error response', () => {
    const response = buildJsonRpcErrorResponse(1, -32000, 'bridge error', { detail: 'failed' });
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error?.code).toBe(-32000);
    expect(response.error?.data).toEqual({ detail: 'failed' });
  });
});

