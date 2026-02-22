/**
 * MCP Bridge HTTP Client
 * Forwards JSON-RPC requests from stdio bridge to SentinAI MCP endpoint.
 */

import { randomUUID } from 'crypto';
import type { McpJsonRpcResponse } from '@/types/mcp';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_USER_AGENT = 'sentinai-mcp-stdio-bridge/1.0';

type JsonObject = Record<string, unknown>;

export interface McpBridgeClientOptions {
  endpointUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  userAgent?: string;
}

export interface McpBridgeInvokeOptions {
  requestId?: string;
  approvalToken?: string;
}

export class McpBridgeHttpError extends Error {
  status: number;
  statusText: string;
  responseBody: string;

  constructor(message: string, status: number, statusText: string, responseBody: string) {
    super(message);
    this.name = 'McpBridgeHttpError';
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
  }
}

export class McpBridgeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpBridgeTransportError';
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractServerErrorMessage(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  const errorValue = payload.error;
  if (!isObject(errorValue)) return null;
  return typeof errorValue.message === 'string' ? errorValue.message : null;
}

function isJsonRpcResponse(payload: unknown): payload is McpJsonRpcResponse {
  if (!isObject(payload)) return false;
  if (payload.jsonrpc !== '2.0') return false;
  return Object.prototype.hasOwnProperty.call(payload, 'result')
    || Object.prototype.hasOwnProperty.call(payload, 'error');
}

export class McpBridgeClient {
  private endpointUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private userAgent: string;

  constructor(options: McpBridgeClientOptions) {
    this.endpointUrl = options.endpointUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async invoke(requestPayload: unknown, options: McpBridgeInvokeOptions = {}): Promise<McpJsonRpcResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-request-id': options.requestId || randomUUID(),
      'user-agent': this.userAgent,
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    if (options.approvalToken) {
      headers['x-mcp-approval-token'] = options.approvalToken;
    }

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      let parsedBody: unknown = null;

      if (bodyText.trim().length > 0) {
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          throw new McpBridgeTransportError('MCP server returned a non-JSON response.');
        }
      }

      if (!response.ok) {
        const serverMessage = extractServerErrorMessage(parsedBody);
        const message = serverMessage
          || `MCP server request failed. (${response.status} ${response.statusText})`;
        throw new McpBridgeHttpError(message, response.status, response.statusText, bodyText);
      }

      if (!isJsonRpcResponse(parsedBody)) {
        throw new McpBridgeTransportError('MCP server response is not a valid JSON-RPC payload.');
      }

      return parsedBody;
    } catch (error) {
      if (error instanceof McpBridgeHttpError || error instanceof McpBridgeTransportError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new McpBridgeTransportError(`MCP server request did not complete within ${this.timeoutMs}ms.`);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpBridgeTransportError(`Failed to send MCP bridge request: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
