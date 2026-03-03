/**
 * Trace Context — AsyncLocalStorage-based trace ID propagation.
 *
 * Allows a single trace ID to flow through the entire async call chain
 * (API handler → detection pipeline → RCA → scaling decision) without
 * explicit parameter threading.
 *
 * Usage:
 *   import { generateTraceId, withTraceId, getTraceId } from '@/lib/trace-context';
 *
 *   // In an API handler:
 *   const traceId = request.headers.get('x-trace-id') || generateTraceId();
 *   return withTraceId(traceId, async () => { ... });
 *
 *   // Anywhere downstream:
 *   const traceId = getTraceId(); // returns the propagated ID or undefined
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface TraceContext {
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a unique trace ID with `tr-` prefix and 16 hex characters (8 random bytes).
 */
export function generateTraceId(): string {
  return `tr-${randomBytes(8).toString('hex')}`;
}

/**
 * Run `fn` within a trace context. The trace ID is available via `getTraceId()`
 * to any code executed synchronously or asynchronously inside `fn`.
 *
 * Supports both sync and async callbacks — the return type mirrors `fn`.
 */
export function withTraceId<T>(traceId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return traceStorage.run({ traceId }, fn);
}

/**
 * Retrieve the current trace ID from the active AsyncLocalStorage context.
 * Returns `undefined` when called outside a `withTraceId` scope.
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}
