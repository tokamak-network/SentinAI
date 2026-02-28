import logger from '@/lib/logger';

const g = globalThis as typeof globalThis & {
  __sentinai_first_run_bootstrap_started__?: boolean;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

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
    } else {
      logger.info('[first-run-bootstrap] skipped/failed: %s', result.error ?? 'unknown');
    }
  } catch (error) {
    logger.warn('[first-run-bootstrap] failed with unexpected error: %s', String(error));
  }
}
