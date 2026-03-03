/**
 * Collector Agent
 * Collects metrics for a specific node instance on a fixed interval (default: 5s).
 * Writes collected data points to InstanceMetricsStore via pushMetric().
 *
 * Role in the pipeline:
 *   CollectorAgent → InstanceMetricsStore (ring buffer)
 *   ↳ DetectorAgent reads from InstanceMetricsStore to run anomaly detection
 */

import { createLogger } from '@/lib/logger';
import { pushMetric, getRecentMetrics } from '@/core/instance-metrics-store';
import { pushMetric as pushGlobalMetric } from '@/lib/metrics-store';
import { getCurrentVcpu } from '@/lib/k8s-scaler';
import type { GenericMetricDataPoint } from '@/core/metrics';

const logger = createLogger('CollectorAgent');

// ============================================================
// Types
// ============================================================

export interface CollectorAgentConfig {
  instanceId: string;
  /** RPC endpoint for the node to monitor */
  rpcUrl: string;
  /** Optional Bearer token for authenticated RPC endpoints */
  authToken?: string;
  /** Collection interval in milliseconds (default: 5000) */
  intervalMs?: number;
}

// ============================================================
// CollectorAgent
// ============================================================

/**
 * Periodic metrics collector for a single node instance.
 * Independent of other agents — only writes to InstanceMetricsStore.
 */
export class CollectorAgent {
  readonly instanceId: string;
  readonly intervalMs: number;

  private readonly rpcUrl: string;
  private readonly authToken?: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCollectedAt: string | null = null;

  constructor(config: CollectorAgentConfig) {
    this.instanceId = config.instanceId;
    this.rpcUrl = config.rpcUrl;
    this.authToken = config.authToken;
    this.intervalMs = config.intervalMs ?? 5000;
  }

  /**
   * Start the periodic collection loop.
   * Idempotent — calling start() on a running agent is a no-op.
   */
  start(): void {
    if (this.timer !== null) {
      logger.warn(`[CollectorAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    logger.info(`[CollectorAgent:${this.instanceId}] Starting (interval=${this.intervalMs}ms)`);

    // Run immediately on start, then every intervalMs
    void this.runCollection();
    this.timer = setInterval(() => {
      void this.runCollection();
    }, this.intervalMs);
  }

  /**
   * Stop the periodic collection loop.
   */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info(`[CollectorAgent:${this.instanceId}] Stopped`);
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  getLastCollectedAt(): string | null {
    return this.lastCollectedAt;
  }

  // ============================================================
  // Private
  // ============================================================

  private async runCollection(): Promise<void> {
    try {
      const dataPoint = await this.collectMetrics();
      if (dataPoint) {
        await pushMetric(dataPoint);

        // Bridge to global MetricsStore for dashboard API compatibility
        await this.bridgeToGlobalStore(dataPoint);

        this.lastCollectedAt = dataPoint.timestamp;
        logger.debug(
          `[CollectorAgent:${this.instanceId}] Collected — blockHeight=${dataPoint.fields['blockHeight'] ?? 'n/a'}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[CollectorAgent:${this.instanceId}] Collection error: ${message}`);
      // Non-fatal: collection failure doesn't stop the agent
    }
  }

  /**
   * Bridge collected metrics to the global MetricsStore.
   * This ensures dashboard APIs (/api/metrics, predictive scaler, anomaly detection)
   * continue working when AGENT_V2=true.
   * Non-fatal: bridge failure doesn't stop the collection pipeline.
   */
  private async bridgeToGlobalStore(dp: GenericMetricDataPoint): Promise<void> {
    try {
      const currentVcpu = await getCurrentVcpu();
      await pushGlobalMetric({
        timestamp: dp.timestamp,
        blockHeight: dp.fields['blockHeight'] ?? 0,
        blockInterval: dp.fields['blockInterval'] ?? 2,
        gasUsedRatio: dp.fields['gasUsedRatio'] ?? 0,
        txPoolPending: dp.fields['txPoolPending'] ?? 0,
        cpuUsage: 0, // TODO: collect from kubectl top or container runtime — not available via RPC
        currentVcpu,
      });
    } catch {
      // Non-fatal: global store bridge failure doesn't stop collection
    }
  }

  private async collectMetrics(): Promise<GenericMetricDataPoint | null> {
    const RPC_TIMEOUT_MS = 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    try {
      // Block info
      const blockResponse = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['latest', false], id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const blockData = await blockResponse.json() as {
        result?: { number?: string; gasUsed?: string; gasLimit?: string; transactions?: unknown[] } | null;
      };
      const block = blockData.result;

      const blockHeight = block?.number ? parseInt(block.number, 16) : null;
      const gasUsed = block?.gasUsed ? parseInt(block.gasUsed, 16) : 0;
      const gasLimit = block?.gasLimit ? parseInt(block.gasLimit, 16) : 1;
      const gasUsedRatio = gasLimit > 0 ? gasUsed / gasLimit : 0;

      // TxPool (best-effort)
      let txPoolPending: number | null = null;
      try {
        const txPoolController = new AbortController();
        const txPoolTimer = setTimeout(() => txPoolController.abort(), 5_000);
        const txPoolResponse = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'txpool_status', params: [], id: 2 }),
          signal: txPoolController.signal,
        });
        clearTimeout(txPoolTimer);
        const txPoolData = await txPoolResponse.json() as {
          result?: { pending?: string } | null;
        };
        if (txPoolData.result?.pending) {
          txPoolPending = parseInt(txPoolData.result.pending, 16);
        } else {
          txPoolPending = block?.transactions?.length ?? 0;
        }
      } catch {
        txPoolPending = block?.transactions?.length ?? null;
      }

      // Peer count (best-effort)
      let peerCount: number | null = null;
      try {
        const peerController = new AbortController();
        const peerTimer = setTimeout(() => peerController.abort(), 5_000);
        const peerResponse = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'net_peerCount', params: [], id: 3 }),
          signal: peerController.signal,
        });
        clearTimeout(peerTimer);
        const peerData = await peerResponse.json() as { result?: string | null };
        if (peerData.result) {
          peerCount = parseInt(peerData.result, 16);
        }
      } catch {
        // Non-critical
      }

      // Compute blockInterval from history
      const recentPoints = await getRecentMetrics(this.instanceId, 2);
      let blockInterval = 2.0;
      if (recentPoints.length >= 2) {
        const prev = recentPoints[recentPoints.length - 2];
        const curr = recentPoints[recentPoints.length - 1];
        const prevHeight = prev.fields['blockHeight'];
        const currHeight = curr.fields['blockHeight'];
        if (prevHeight !== null && prevHeight !== undefined && currHeight !== null && currHeight !== undefined) {
          const blockDiff = currHeight - prevHeight;
          if (blockDiff > 0) {
            const timeDiff =
              (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
            blockInterval = timeDiff / blockDiff;
          }
        }
      }

      return {
        instanceId: this.instanceId,
        timestamp: new Date().toISOString(),
        fields: {
          blockHeight,
          blockInterval,
          txPoolPending,
          peerCount,
          gasUsedRatio,
        },
      };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }
}
