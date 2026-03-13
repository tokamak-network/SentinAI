import cron, { type ScheduledTask } from 'node-cron';
import { loadFacilitatorConfig } from '@/lib/marketplace/facilitator/config';
import { reconcileSubmittedSettlements } from '@/lib/marketplace/facilitator/reconcile-settlements';

let reconcileTask: ScheduledTask | null = null;
let started = false;
let running = false;

export async function ensureFacilitatorReconcilerStarted(): Promise<void> {
  if (started) {
    return;
  }

  const config = loadFacilitatorConfig();
  if (!config.reconciler.enabled) {
    return;
  }

  reconcileTask = cron.schedule(config.reconciler.cron, async () => {
    if (running) return;
    running = true;
    try {
      const latestConfig = loadFacilitatorConfig();
      const enabledProfiles = Object.values(latestConfig.profiles).filter((profile) => profile.enabled);
      for (const profile of enabledProfiles) {
        await reconcileSubmittedSettlements({
          redisPrefix: latestConfig.redisPrefix,
          profile,
        });
      }
    } finally {
      running = false;
    }
  });

  started = true;
}

export function resetFacilitatorReconcilerForTests(): void {
  reconcileTask?.stop();
  reconcileTask = null;
  started = false;
  running = false;
}
