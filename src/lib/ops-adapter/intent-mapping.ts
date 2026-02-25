import type { AutonomousIntent } from '@/types/autonomous-ops';

export function mapOpsActionToIntent(input: {
  action?: string;
  intent?: string;
}): AutonomousIntent | null {
  const raw = (input.intent || input.action || '').trim();

  // Accept either the internal intent id, or a friendly action name.
  const normalized = raw.toLowerCase();

  const direct: Record<string, AutonomousIntent> = {
    stabilize_throughput: 'stabilize_throughput',
    recover_sequencer_path: 'recover_sequencer_path',
    reduce_cost_idle_window: 'reduce_cost_idle_window',
    restore_l1_connectivity: 'restore_l1_connectivity',
    protect_critical_eoa: 'protect_critical_eoa',
  };

  if (direct[normalized]) return direct[normalized];

  const friendly: Array<[RegExp, AutonomousIntent]> = [
    [/l1.*(failover|connect|connectivity|rpc)/i, 'restore_l1_connectivity'],
    [/(throughput|batch|backlog|sequencer)/i, 'stabilize_throughput'],
    [/(cost|idle|downscale|scale.*down)/i, 'reduce_cost_idle_window'],
    [/(eoa|treasury|balance|refill)/i, 'protect_critical_eoa'],
    [/(recover|restart).*sequencer/i, 'recover_sequencer_path'],
  ];

  for (const [re, intent] of friendly) {
    if (re.test(raw)) return intent;
  }

  return null;
}
