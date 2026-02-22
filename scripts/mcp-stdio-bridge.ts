/**
 * MCP stdio bridge entrypoint.
 * Reads MCP stdio frames and forwards JSON-RPC calls to SentinAI /api/mcp.
 */

import { randomUUID } from 'crypto';
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

function writeFrame(payload: unknown): void {
  process.stdout.write(encodeStdioFrame(payload));
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

async function handleRequestBody(rawMessage: string): Promise<void> {
  let requestPayload: unknown;
  try {
    requestPayload = JSON.parse(rawMessage);
  } catch {
    writeFrame(buildJsonRpcErrorResponse(null, -32700, 'Failed to parse JSON payload.'));
    return;
  }

  const expectResponse = expectsJsonRpcResponse(requestPayload);
  const rpcId = extractJsonRpcId(requestPayload);
  const approvalToken = extractApprovalToken(requestPayload);
  const requestId = `bridge-${randomUUID()}`;

  try {
    const response = await bridgeClient.invoke(requestPayload, {
      requestId,
      approvalToken,
    });

    if (expectResponse) {
      writeFrame(response);
    }
  } catch (error) {
    const { message, data } = toBridgeErrorMessage(error);
    console.error(`[MCP Bridge] ${message}`);
    if (expectResponse) {
      writeFrame(buildJsonRpcErrorResponse(rpcId, -32000, message, data));
    }
  }
}

async function drainIncomingBuffer(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const parsed = parseStdioFrames(incomingBuffer);
      incomingBuffer = parsed.rest;

      for (const errorMessage of parsed.protocolErrors) {
        console.error(`[MCP Bridge] ${errorMessage}`);
      }

      if (parsed.messages.length === 0) {
        break;
      }

      for (const rawMessage of parsed.messages) {
        await handleRequestBody(rawMessage);
      }
    }
  } finally {
    processing = false;
    const pending = parseStdioFrames(incomingBuffer);
    if (pending.messages.length > 0) {
      void drainIncomingBuffer();
    }
  }
}

process.stdin.on('data', (chunk: Buffer<ArrayBufferLike>) => {
  incomingBuffer = Buffer.concat([incomingBuffer, chunk]);
  void drainIncomingBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
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
