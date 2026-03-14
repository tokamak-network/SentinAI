import logger from '@/lib/logger';

const g = globalThis as typeof globalThis & {
  __sentinai_first_run_bootstrap_started__?: boolean;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { validateRedisConnection } = await import('./lib/redis-store');
  await validateRedisConnection();

  const { initializeScheduler } = await import('./lib/scheduler');
  await initializeScheduler();

  if (g.__sentinai_first_run_bootstrap_started__) {
    return;
  }
  g.__sentinai_first_run_bootstrap_started__ = true;

  const autoBootstrapEnabled = process.env.SENTINAI_AUTO_BOOTSTRAP !== 'false';
  if (!autoBootstrapEnabled) {
    logger.info('[first-run-bootstrap] skipped (SENTINAI_AUTO_BOOTSTRAP=false)');
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
    }
  } catch (error) {
    logger.warn('[first-run-bootstrap] failed with unexpected error: %s', String(error));
  }
}
