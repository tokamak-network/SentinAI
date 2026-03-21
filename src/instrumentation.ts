import logger from '@/lib/logger';

const g = globalThis as typeof globalThis & {
  __sentinai_first_run_bootstrap_started__?: boolean;
};

/**
 * Fallback: start a default agent instance when bootstrap is disabled or fails.
 * Only used when SENTINAI_INSTANCES is not set (single-instance mode).
 */
async function startDefaultInstanceFallback() {
  const { getAgentOrchestrator } = await import('./core/agent-orchestrator');
  const orchestrator = getAgentOrchestrator();

  if (orchestrator.getInstanceIds().length > 0) {
    return; // agents already started by another path
  }

  const instanceId = process.env.SENTINAI_DEFAULT_INSTANCE_ID ?? 'default';
  const protocolId = process.env.SENTINAI_DEFAULT_PROTOCOL_ID ?? 'opstack-l2';
  const rpcUrl = process.env.L2_RPC_URL;
  orchestrator.startInstance(instanceId, protocolId, rpcUrl);
  logger.info(`[instrumentation] fallback: started default instance (instanceId=${instanceId})`);
}

export async function register() {
  // Only run in Node.js runtime (not Edge/Middleware)
  if (typeof process === 'undefined' || process.env.NEXT_RUNTIME === 'edge') {
    return;
  }
  
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // Skip instrumentation in Vercel build environment
  if (process.env.VERCEL === 'true') {
    return;
  }

  try {
    const { validateRedisConnection } = await import('./lib/redis-store');
    await validateRedisConnection();
  } catch (err) {
    // Log but don't fail if Redis is unavailable
    console.warn('[instrumentation] Redis validation failed:', err);
    return;
  }

  const { initializeScheduler } = await import('./lib/scheduler');
  await initializeScheduler();

  if (g.__sentinai_first_run_bootstrap_started__) {
    return;
  }
  g.__sentinai_first_run_bootstrap_started__ = true;

  // Skip agent startup if SENTINAI_INSTANCES is explicitly set (handled by scheduler)
  if (process.env.SENTINAI_INSTANCES) {
    return;
  }

  const autoBootstrapEnabled = process.env.SENTINAI_AUTO_BOOTSTRAP !== 'false';
  if (!autoBootstrapEnabled) {
    logger.info('[first-run-bootstrap] skipped (SENTINAI_AUTO_BOOTSTRAP=false)');
    await startDefaultInstanceFallback();
    return;
  }

  const { firstRunBootstrap } = await import('./lib/first-run-bootstrap');
  try {
    const result = await firstRunBootstrap();
    if (result.ok) {
      logger.info(
        '[first-run-bootstrap] completed instanceId=%s protocolId=%s',
        result.instanceId ?? 'n/a',
        result.protocolId ?? 'n/a'
      );

      // Start agents automatically after bootstrap (independent of dashboard)
      if (result.instanceId && result.protocolId) {
        const { getAgentOrchestrator } = await import('./core/agent-orchestrator');
        const { listInstances } = await import('./core/instance-registry');
        const orchestrator = getAgentOrchestrator();
        const l2Rpc = process.env.L2_RPC_URL || process.env.SENTINAI_L2_RPC_URL;

        try {
          // Start agents for the bootstrapped instance
          orchestrator.startInstance(result.instanceId, result.protocolId, l2Rpc);
          logger.info(
            '[instrumentation] agents started for instanceId=%s protocolId=%s',
            result.instanceId,
            result.protocolId
          );

          // Also start agents for any other active instances (operator=default)
          try {
            const instances = await listInstances('default');
            const otherInstances = instances.filter(
              (inst) => inst.instanceId !== result.instanceId && inst.status === 'active'
            );
            for (const inst of otherInstances) {
              if (!orchestrator.isInstanceRunning(inst.instanceId)) {
                orchestrator.startInstance(inst.instanceId, inst.protocolId, inst.connectionConfig.rpcUrl);
                logger.info(
                  '[instrumentation] agents started for existing instanceId=%s protocolId=%s',
                  inst.instanceId,
                  inst.protocolId
                );
              }
            }
          } catch (listError) {
            logger.warn(
              '[instrumentation] failed to auto-start agents for other instances: %s',
              String(listError)
            );
          }
        } catch (agentError) {
          logger.warn(
            '[instrumentation] failed to start agents: %s',
            String(agentError)
          );
        }
      }
    } else {
      logger.info('[first-run-bootstrap] skipped/failed: %s', result.error ?? 'unknown');
      await startDefaultInstanceFallback();
    }
  } catch (error) {
    logger.warn('[first-run-bootstrap] failed with unexpected error: %s', String(error));
    await startDefaultInstanceFallback();
  }
}
