/**
 * MCP stdio framing helpers.
 * Handles Content-Length framed JSON messages used by MCP stdio transport.
 */

import type { McpJsonRpcId, McpJsonRpcResponse } from '@/types/mcp';

type JsonObject = Record<string, unknown>;

const HEADER_SEPARATOR = '\r\n\r\n';
const CONTENT_LENGTH_PREFIX = 'content-length:';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ParsedStdioFrames {
  messages: string[];
  rest: Buffer<ArrayBufferLike>;
  protocolErrors: string[];
}

export function encodeStdioFrame(payload: unknown): Buffer {
  const body = JSON.stringify(payload);
  const bodyBuffer = Buffer.from(body, 'utf8');
  const headerBuffer = Buffer.from(`Content-Length: ${bodyBuffer.length}${HEADER_SEPARATOR}`, 'utf8');
  return Buffer.concat([headerBuffer, bodyBuffer]);
}

function parseContentLength(headerBlock: string): number | null {
  const lines = headerBlock.split('\r\n').map((line) => line.trim());
  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    if (!lower.startsWith(CONTENT_LENGTH_PREFIX)) continue;
    const rawLength = line.slice(line.indexOf(':') + 1).trim();
    const parsed = Number.parseInt(rawLength, 10);
    if (Number.isNaN(parsed) || parsed < 0) return null;
    return parsed;
  }
  return null;
}

export function parseStdioFrames(buffer: Buffer<ArrayBufferLike>): ParsedStdioFrames {
  let offset = 0;
  const messages: string[] = [];
  const protocolErrors: string[] = [];

  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf(HEADER_SEPARATOR, offset, 'utf8');
    if (headerEnd < 0) break;

    const headerBlock = buffer.slice(offset, headerEnd).toString('utf8');
    const contentLength = parseContentLength(headerBlock);
    const bodyStart = headerEnd + HEADER_SEPARATOR.length;

    if (contentLength === null) {
      protocolErrors.push('유효하지 않은 Content-Length 헤더를 수신했습니다.');
      offset = bodyStart;
      continue;
    }

    const bodyEnd = bodyStart + contentLength;
    if (bodyEnd > buffer.length) break;

    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
    messages.push(body);
    offset = bodyEnd;
  }

  return {
    messages,
    rest: buffer.slice(offset),
    protocolErrors,
  };
}

export function extractJsonRpcId(payload: unknown): McpJsonRpcId {
  if (!isObject(payload)) return null;
  if (!Object.prototype.hasOwnProperty.call(payload, 'id')) return null;
  const idValue = payload.id;
  if (typeof idValue === 'string' || typeof idValue === 'number' || idValue === null) {
    return idValue;
  }
  return null;
}

export function expectsJsonRpcResponse(payload: unknown): boolean {
  return isObject(payload) && Object.prototype.hasOwnProperty.call(payload, 'id');
}

export function extractApprovalToken(payload: unknown): string | undefined {
  if (!isObject(payload)) return undefined;
  const params = payload.params;
  if (!isObject(params)) return undefined;

  if (typeof params.approvalToken === 'string' && params.approvalToken.trim().length > 0) {
    return params.approvalToken;
  }

  if (payload.method === 'tools/call' && isObject(params.arguments)) {
    const args = params.arguments;
    if (typeof args.approvalToken === 'string' && args.approvalToken.trim().length > 0) {
      return args.approvalToken;
    }
  }

  return undefined;
}

export function buildJsonRpcErrorResponse(
  id: McpJsonRpcId,
  code: number,
  message: string,
  data?: unknown
): McpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}
