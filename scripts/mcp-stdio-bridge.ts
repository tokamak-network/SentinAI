/**
 * MCP stdio bridge entrypoint.
 * Reads MCP stdio frames and forwards JSON-RPC calls to SentinAI /api/mcp.
 */

import { randomUUID } from 'crypto';
import { loadEnvConfig } from '@next/env';
import {
  McpBridgeClient,
  McpBridgeHttpError,
  McpBridgeTransportError,
} from '../src/lib/mcp-bridge-client';
import {
  buildJsonRpcErrorResponse,
  encodeStdioFrame,
  expectsJsonRpcResponse,
  extractApprovalToken,
  extractJsonRpcId,
  parseStdioFrames,
} from '../src/lib/mcp-stdio-transport';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3002';
const DEFAULT_API_PATH = '/api/mcp';
const DEFAULT_TIMEOUT_MS = 15000;
const TRACE_ENABLED = process.env.MCP_BRIDGE_TRACE === 'true';

// Load .env* files like Next.js before reading process.env defaults.
loadEnvConfig(process.cwd());

function trace(message: string): void {
  if (!TRACE_ENABLED) return;
  console.error(`[MCP Bridge][trace] ${message}`);
}

function resolveEndpointUrl(baseUrl: string, apiPath: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath;
  return new URL(normalizedPath, normalizedBase).toString();
}

function toBridgeErrorMessage(error: unknown): { message: string; data?: Record<string, unknown> } {
  if (error instanceof McpBridgeHttpError) {
    return {
      message: error.message,
      data: {
        status: error.status,
        statusText: error.statusText,
      },
    };
  }
  if (error instanceof McpBridgeTransportError) {
    return { message: error.message };
  }
  const message = error instanceof Error ? error.message : 'Unknown bridge error';
  return { message: `MCP bridge handling failed: ${message}` };
}

type BridgeIoMode = 'framed' | 'line';
let ioMode: BridgeIoMode | null = null;

function writeResponse(payload: unknown): void {
  if (ioMode === 'line') {
    const encoded = `${JSON.stringify(payload)}\n`;
    trace(`writing line bytes=${Buffer.byteLength(encoded)}`);
    process.stdout.write(encoded);
    return;
  }

  const encoded = encodeStdioFrame(payload);
  trace(`writing frame bytes=${encoded.length}`);
  process.stdout.write(encoded);
}

function isBatchPayload(payload: unknown): payload is unknown[] {
  return Array.isArray(payload);
}

const baseUrl = process.env.MCP_BRIDGE_BASE_URL || DEFAULT_BASE_URL;
const apiPath = process.env.MCP_BRIDGE_API_PATH || DEFAULT_API_PATH;
const timeoutMs = Number.parseInt(process.env.MCP_BRIDGE_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
const apiKey = process.env.SENTINAI_API_KEY || process.env.MCP_BRIDGE_API_KEY || undefined;

const bridgeClient = new McpBridgeClient({
  endpointUrl: resolveEndpointUrl(baseUrl, apiPath),
  apiKey,
  timeoutMs: Number.isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
});

let incomingBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
let processing = false;
let stdinEnded = false;

async function invokeOne(payload: unknown): Promise<unknown | null> {
  const expectResponse = expectsJsonRpcResponse(payload);
  const rpcId = extractJsonRpcId(payload);
  const approvalToken = extractApprovalToken(payload);
  const requestId = `bridge-${randomUUID()}`;
  trace(`invokeOne expectResponse=${expectResponse} rpcId=${String(rpcId)}`);

  try {
    const response = await bridgeClient.invoke(payload, {
      requestId,
      approvalToken,
    });

    return expectResponse ? response : null;
  } catch (error) {
    const { message, data } = toBridgeErrorMessage(error);
    console.error(`[MCP Bridge] ${message}`);
    return expectResponse ? buildJsonRpcErrorResponse(rpcId, -32000, message, data) : null;
  }
}

async function handleRequestBody(rawMessage: string): Promise<void> {
  trace(`handling raw message bytes=${Buffer.byteLength(rawMessage)}`);
  let requestPayload: unknown;
  try {
    requestPayload = JSON.parse(rawMessage);
  } catch {
    writeResponse(buildJsonRpcErrorResponse(null, -32700, 'Failed to parse JSON payload.'));
    return;
  }

  if (isBatchPayload(requestPayload)) {
    trace(`batch payload count=${requestPayload.length}`);
    const responses = (await Promise.all(requestPayload.map((item) => invokeOne(item))))
      .filter((item): item is unknown => item !== null);
    if (responses.length > 0) {
      writeResponse(responses);
    }
    return;
  }

  const response = await invokeOne(requestPayload);
  if (response !== null) {
    writeResponse(response);
  }
}

function parseLineDelimitedMessages(buffer: Buffer<ArrayBufferLike>): {
  messages: string[];
  rest: Buffer<ArrayBufferLike>;
} {
  const text = buffer.toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline < 0) {
    return { messages: [], rest: buffer };
  }

  const complete = text.slice(0, lastNewline + 1);
  const restText = text.slice(lastNewline + 1);
  const messages = complete
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    messages,
    rest: Buffer.from(restText, 'utf8'),
  };
}

async function drainIncomingBuffer(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const parsed = parseStdioFrames(incomingBuffer);
      incomingBuffer = parsed.rest;
      trace(
        `parsed messages=${parsed.messages.length} rest=${parsed.rest.length} protocolErrors=${parsed.protocolErrors.length}`
      );

      for (const errorMessage of parsed.protocolErrors) {
        console.error(`[MCP Bridge] ${errorMessage}`);
      }

      let messages = parsed.messages;
      if (messages.length > 0 && !ioMode) {
        ioMode = 'framed';
      }

      if (messages.length === 0 && parsed.protocolErrors.length === 0) {
        const lineParsed = parseLineDelimitedMessages(incomingBuffer);
        if (lineParsed.messages.length > 0) {
          ioMode = ioMode || 'line';
          incomingBuffer = lineParsed.rest;
          messages = lineParsed.messages;
          trace(`line-mode messages=${messages.length} rest=${lineParsed.rest.length}`);
        }
      }

      if (messages.length === 0) {
        break;
      }

      for (const rawMessage of messages) {
        await handleRequestBody(rawMessage);
      }
    }
  } finally {
    processing = false;
    const pending = parseStdioFrames(incomingBuffer);
    if (pending.messages.length > 0) {
      void drainIncomingBuffer();
      return;
    }

    if (stdinEnded) {
      // Exit only after all parseable messages have been fully processed and flushed.
      process.exit(0);
    }
  }
}

process.stdin.on('data', (chunk: Buffer<ArrayBufferLike>) => {
  const preview = chunk
    .toString('utf8')
    .slice(0, 240)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  trace(`stdin chunk bytes=${chunk.length} preview="${preview}"`);
  incomingBuffer = Buffer.concat([incomingBuffer, chunk]);
  void drainIncomingBuffer();
});

process.stdin.on('end', () => {
  stdinEnded = true;
  if (!processing) {
    void drainIncomingBuffer();
  }
});

process.stdin.on('error', (error) => {
  const message = error instanceof Error ? error.message : 'Unknown stdin error';
  console.error(`[MCP Bridge] stdin error: ${message}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.stack || error.message : 'Unknown exception';
  console.error(`[MCP Bridge] uncaught exception: ${message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`[MCP Bridge] unhandled rejection: ${message}`);
  process.exit(1);
});

process.stdin.resume();
console.error(`[MCP Bridge] Ready: ${resolveEndpointUrl(baseUrl, apiPath)}`);
