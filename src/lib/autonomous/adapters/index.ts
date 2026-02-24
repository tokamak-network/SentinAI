import type { AutonomousAdapter } from './types';
import { OpstackAutonomousAdapter } from './opstack-adapter';
import { ArbitrumAutonomousAdapter } from './arbitrum-adapter';
import { ZkstackAutonomousAdapter } from './zkstack-adapter';

const ADAPTERS: Record<string, AutonomousAdapter> = {
  thanos: new OpstackAutonomousAdapter(),
  optimism: new OpstackAutonomousAdapter(),
  'op-stack': new OpstackAutonomousAdapter(),
  'my-l2': new OpstackAutonomousAdapter(),
  arbitrum: new ArbitrumAutonomousAdapter(),
  'arbitrum-orbit': new ArbitrumAutonomousAdapter(),
  nitro: new ArbitrumAutonomousAdapter(),
  zkstack: new ZkstackAutonomousAdapter(),
  'zk-stack': new ZkstackAutonomousAdapter(),
  zksync: new ZkstackAutonomousAdapter(),
};

export function getAutonomousAdapter(chainType: string): AutonomousAdapter {
  const key = chainType.trim().toLowerCase();
  return ADAPTERS[key] || ADAPTERS.thanos;
}
