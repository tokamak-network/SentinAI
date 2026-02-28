/**
 * Chain Plugin System Tests
 * Validates ChainPlugin interface, ThanosPlugin implementation, and registry behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThanosPlugin } from '@/chains/thanos';
import { OptimismPlugin } from '@/chains/optimism';
import { ZkstackPlugin } from '@/chains/zkstack';
import { ArbitrumPlugin } from '@/chains/arbitrum';
import { ZkL2GenericPlugin } from '@/chains/zkl2-generic';
import {
  getChainPlugin,
  resetChainRegistry,
  registerChainPlugin,
  getChainType,
} from '@/chains/registry';
import type { ChainPlugin } from '@/chains/types';

describe('ThanosPlugin', () => {
  let plugin: ThanosPlugin;

  beforeEach(() => {
    plugin = new ThanosPlugin();
  });

  // ============================================================
  // Basic Properties
  // ============================================================

  describe('properties', () => {
    it('should have correct chain type and display name', () => {
      expect(plugin.chainType).toBe('thanos');
      expect(plugin.displayName).toBe('Thanos L2 Rollup');
    });

    it('should define 5 L2 components', () => {
      expect(plugin.components).toEqual(['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'op-challenger']);
    });

    it('should define 2 meta-components', () => {
      expect(plugin.metaComponents).toEqual(['l1', 'system']);
    });

    it('should have op-geth as primary execution client', () => {
      expect(plugin.primaryExecutionClient).toBe('op-geth');
    });

    it('should define batcher and proposer EOA roles', () => {
      expect(plugin.eoaRoles).toEqual(['batcher', 'proposer', 'challenger']);
    });

    it('should define balance metrics', () => {
      expect(plugin.balanceMetrics).toEqual(['batcherBalance', 'proposerBalance', 'challengerBalance']);
    });

    it('should have l1Chain and l2Chain defined', () => {
      expect(plugin.l1Chain).toBeDefined();
      expect(plugin.l1Chain.id).toBe(11155111); // Sepolia chain ID
      expect(plugin.l2Chain).toBeDefined();
      expect(plugin.l2Chain.id).toBe(1); // Mainnet (used for L2 RPC compatibility)
    });
  });

  // ============================================================
  // Dependency Graph
  // ============================================================

  describe('dependency graph', () => {
    it('should include all components and meta-components', () => {
      const allComponents = [...plugin.components, ...plugin.metaComponents];
      for (const comp of allComponents) {
        expect(plugin.dependencyGraph[comp]).toBeDefined();
      }
    });

    it('should have correct op-geth dependencies', () => {
      const deps = plugin.dependencyGraph['op-geth'];
      expect(deps.dependsOn).toEqual(['op-node']);
      expect(deps.feeds).toEqual([]);
    });

    it('should have correct op-node dependencies', () => {
      const deps = plugin.dependencyGraph['op-node'];
      expect(deps.dependsOn).toEqual(['l1']);
      expect(deps.feeds).toContain('op-geth');
      expect(deps.feeds).toContain('op-batcher');
      expect(deps.feeds).toContain('op-proposer');
    });

    it('should have l1 as root dependency (no upstream)', () => {
      const deps = plugin.dependencyGraph['l1'];
      expect(deps.dependsOn).toEqual([]);
      expect(deps.feeds.length).toBeGreaterThan(0);
    });

    it('should have no circular dependencies', () => {
      const visited = new Set<string>();
      const visiting = new Set<string>();

      function hasCycle(node: string): boolean {
        if (visiting.has(node)) return true;
        if (visited.has(node)) return false;
        visiting.add(node);
        const deps = plugin.dependencyGraph[node];
        if (deps) {
          for (const dep of deps.dependsOn) {
            if (hasCycle(dep)) return true;
          }
        }
        visiting.delete(node);
        visited.add(node);
        return false;
      }

      for (const comp of Object.keys(plugin.dependencyGraph)) {
        expect(hasCycle(comp)).toBe(false);
      }
    });

    it('should have consistent bidirectional references', () => {
      for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
        for (const upstream of deps.dependsOn) {
          const upstreamDeps = plugin.dependencyGraph[upstream];
          expect(upstreamDeps).toBeDefined();
          expect(upstreamDeps.feeds).toContain(comp);
        }
      }
    });
  });

  // ============================================================
  // Component Name Normalization
  // ============================================================

  describe('normalizeComponentName', () => {
    it('should normalize short names to full names', () => {
      expect(plugin.normalizeComponentName('geth')).toBe('op-geth');
      expect(plugin.normalizeComponentName('node')).toBe('op-node');
      expect(plugin.normalizeComponentName('batcher')).toBe('op-batcher');
      expect(plugin.normalizeComponentName('proposer')).toBe('op-proposer');
    });

    it('should pass through full component names', () => {
      expect(plugin.normalizeComponentName('op-geth')).toBe('op-geth');
      expect(plugin.normalizeComponentName('op-node')).toBe('op-node');
      expect(plugin.normalizeComponentName('op-batcher')).toBe('op-batcher');
      expect(plugin.normalizeComponentName('op-proposer')).toBe('op-proposer');
    });

    it('should handle case-insensitive input', () => {
      expect(plugin.normalizeComponentName('GETH')).toBe('op-geth');
      expect(plugin.normalizeComponentName('Op-Node')).toBe('op-node');
    });

    it('should handle whitespace', () => {
      expect(plugin.normalizeComponentName('  geth  ')).toBe('op-geth');
    });

    it('should return system for unknown names', () => {
      expect(plugin.normalizeComponentName('unknown')).toBe('system');
      expect(plugin.normalizeComponentName('foobar')).toBe('system');
    });

    it('should normalize l1 and system', () => {
      expect(plugin.normalizeComponentName('l1')).toBe('l1');
      expect(plugin.normalizeComponentName('system')).toBe('system');
    });
  });

  // ============================================================
  // Metric to Component Mapping
  // ============================================================

  describe('mapMetricToComponent', () => {
    it('should map CPU/memory metrics to op-geth', () => {
      expect(plugin.mapMetricToComponent('cpuUsage')).toBe('op-geth');
      expect(plugin.mapMetricToComponent('memoryUsage')).toBe('op-geth');
    });

    it('should map txPool/gas metrics to op-geth', () => {
      expect(plugin.mapMetricToComponent('txPoolPending')).toBe('op-geth');
      expect(plugin.mapMetricToComponent('gasUsedRatio')).toBe('op-geth');
    });

    it('should map block metrics to op-node', () => {
      expect(plugin.mapMetricToComponent('l2BlockHeight')).toBe('op-node');
      expect(plugin.mapMetricToComponent('l2BlockInterval')).toBe('op-node');
    });

    it('should map balance metrics to respective components', () => {
      expect(plugin.mapMetricToComponent('batcherBalance')).toBe('op-batcher');
      expect(plugin.mapMetricToComponent('proposerBalance')).toBe('op-proposer');
    });

    it('should return system for unknown metrics', () => {
      expect(plugin.mapMetricToComponent('unknownMetric')).toBe('system');
    });
  });

  // ============================================================
  // K8s Components
  // ============================================================

  describe('k8sComponents', () => {
    it('should define 5 K8s components', () => {
      expect(plugin.k8sComponents).toHaveLength(5);
    });

    it('should have exactly one primary execution component', () => {
      const primary = plugin.k8sComponents.filter(c => c.isPrimaryExecution);
      expect(primary).toHaveLength(1);
      expect(primary[0].component).toBe('op-geth');
    });

    it('should have L1 RPC env vars for non-execution components', () => {
      const withL1Env = plugin.k8sComponents.filter(c => c.l1RpcEnvVar);
      expect(withL1Env.length).toBeGreaterThanOrEqual(2);
      expect(withL1Env.map(c => c.component)).toContain('op-node');
      expect(withL1Env.map(c => c.component)).toContain('op-batcher');
    });

    it('should have unique label suffixes', () => {
      const suffixes = plugin.k8sComponents.map(c => c.labelSuffix);
      expect(new Set(suffixes).size).toBe(suffixes.length);
    });
  });

  // ============================================================
  // EOA Configs
  // ============================================================

  describe('eoaConfigs', () => {
    it('should define configs for batcher, proposer, and challenger', () => {
      expect(plugin.eoaConfigs).toHaveLength(3);
      const roles = plugin.eoaConfigs.map(c => c.role);
      expect(roles).toContain('batcher');
      expect(roles).toContain('proposer');
      expect(roles).toContain('challenger');
    });

    it('should have env var names for each role', () => {
      for (const config of plugin.eoaConfigs) {
        expect(config.addressEnvVar).toBeTruthy();
        expect(config.displayName).toBeTruthy();
      }
    });
  });

  // ============================================================
  // Playbooks
  // ============================================================

  describe('getPlaybooks', () => {
    it('should return playbooks', () => {
      const playbooks = plugin.getPlaybooks();
      expect(playbooks.length).toBeGreaterThan(0);
    });

    it('should have valid playbook structure', () => {
      const playbooks = plugin.getPlaybooks();
      for (const pb of playbooks) {
        expect(pb.name).toBeTruthy();
        expect(pb.description).toBeTruthy();
        expect(pb.trigger).toBeDefined();
        expect(pb.trigger.component).toBeTruthy();
        expect(pb.trigger.indicators.length).toBeGreaterThan(0);
        expect(pb.actions.length).toBeGreaterThan(0);
        expect(typeof pb.maxAttempts).toBe('number');
      }
    });

    it('should only reference known components in triggers', () => {
      const playbooks = plugin.getPlaybooks();
      const allComponents = [...plugin.components, ...plugin.metaComponents];
      for (const pb of playbooks) {
        expect(allComponents).toContain(pb.trigger.component);
      }
    });
  });

  // ============================================================
  // AI Prompts
  // ============================================================

  describe('aiPrompts', () => {
    it('should have all required prompt fields', () => {
      const prompts = plugin.aiPrompts;
      expect(prompts.rcaSystemPrompt).toBeTruthy();
      expect(prompts.anomalyAnalyzerContext).toBeTruthy();
      expect(prompts.predictiveScalerContext).toBeTruthy();
      expect(prompts.costOptimizerContext).toBeTruthy();
      expect(prompts.dailyReportContext).toBeTruthy();
      expect(prompts.nlopsSystemContext).toBeTruthy();
      expect(prompts.failurePatterns).toBeTruthy();
    });

    it('should reference OP Stack components in RCA prompt', () => {
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-geth');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-node');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-batcher');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-proposer');
    });

    it('should reference chain context in anomaly analyzer', () => {
      expect(plugin.aiPrompts.anomalyAnalyzerContext).toContain('op-node');
      expect(plugin.aiPrompts.anomalyAnalyzerContext).toContain('op-geth');
    });
  });
});

describe('ZkstackPlugin', () => {
  let plugin: ZkstackPlugin;

  beforeEach(() => {
    delete process.env.ZKSTACK_MODE;
    plugin = new ZkstackPlugin();
  });

  it('should expose zkstack chain metadata', () => {
    expect(plugin.chainType).toBe('zkstack');
    expect(plugin.chainMode).toBe('legacy-era');
    // proofMonitoring depends on ZK_PROOF_RPC_URL env var
    expect(plugin.capabilities.proofMonitoring).toBe(Boolean(process.env.ZK_PROOF_RPC_URL));
    expect(plugin.capabilities.disputeGameMonitoring).toBe(false);
  });

  it('should switch mode to os-preview via env', () => {
    process.env.ZKSTACK_MODE = 'os-preview';
    const preview = new ZkstackPlugin();
    expect(preview.chainMode).toBe('os-preview');
  });

  it('should include zk-specific components', () => {
    expect(plugin.components).toContain('zksync-server');
    expect(plugin.components).toContain('zk-batcher');
    expect(plugin.components).toContain('zk-prover');
    expect(plugin.primaryExecutionClient).toBe('zksync-server');
  });
});

// ============================================================
// ArbitrumPlugin Tests
// ============================================================

describe('ArbitrumPlugin', () => {
  let plugin: ArbitrumPlugin;

  beforeEach(() => {
    plugin = new ArbitrumPlugin();
  });

  describe('metadata', () => {
    it('should have correct chain type', () => {
      expect(plugin.chainType).toBe('arbitrum');
      expect(plugin.chainMode).toBe('standard');
    });

    it('should have nitro-node as primary execution client', () => {
      expect(plugin.primaryExecutionClient).toBe('nitro-node');
    });

    it('should have 0.25s block interval', () => {
      expect(plugin.expectedBlockIntervalSeconds).toBe(0.25);
    });

    it('should have correct capabilities', () => {
      expect(plugin.capabilities.l1Failover).toBe(true);
      expect(plugin.capabilities.eoaBalanceMonitoring).toBe(true);
      expect(plugin.capabilities.disputeGameMonitoring).toBe(false);
    });
  });

  describe('components', () => {
    it('should define 3 L2 components', () => {
      expect(plugin.components).toEqual(['nitro-node', 'batch-poster', 'validator']);
    });

    it('should define 2 meta-components', () => {
      expect(plugin.metaComponents).toEqual(['l1', 'system']);
    });
  });

  describe('dependency graph', () => {
    it('should include all components and meta-components', () => {
      const allComponents = [...plugin.components, ...plugin.metaComponents];
      for (const comp of allComponents) {
        expect(plugin.dependencyGraph[comp]).toBeDefined();
      }
    });

    it('should have nitro-node depend on l1 and feed batch-poster + validator', () => {
      const deps = plugin.dependencyGraph['nitro-node'];
      expect(deps.dependsOn).toEqual(['l1']);
      expect(deps.feeds).toContain('batch-poster');
      expect(deps.feeds).toContain('validator');
    });

    it('should have l1 as root dependency (no upstream)', () => {
      const deps = plugin.dependencyGraph['l1'];
      expect(deps.dependsOn).toEqual([]);
      expect(deps.feeds.length).toBeGreaterThan(0);
    });

    it('should have no circular dependencies', () => {
      const visited = new Set<string>();
      const visiting = new Set<string>();

      function hasCycle(node: string): boolean {
        if (visiting.has(node)) return true;
        if (visited.has(node)) return false;
        visiting.add(node);
        const deps = plugin.dependencyGraph[node];
        if (deps) {
          for (const dep of deps.dependsOn) {
            if (hasCycle(dep)) return true;
          }
        }
        visiting.delete(node);
        visited.add(node);
        return false;
      }

      for (const comp of Object.keys(plugin.dependencyGraph)) {
        expect(hasCycle(comp)).toBe(false);
      }
    });

    it('should have consistent bidirectional references', () => {
      for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
        for (const upstream of deps.dependsOn) {
          const upstreamDeps = plugin.dependencyGraph[upstream];
          expect(upstreamDeps).toBeDefined();
          expect(upstreamDeps.feeds).toContain(comp);
        }
      }
    });
  });

  describe('normalizeComponentName', () => {
    it('should normalize aliases to canonical names', () => {
      expect(plugin.normalizeComponentName('nitro')).toBe('nitro-node');
      expect(plugin.normalizeComponentName('sequencer')).toBe('nitro-node');
      expect(plugin.normalizeComponentName('batcher')).toBe('batch-poster');
      expect(plugin.normalizeComponentName('staker')).toBe('validator');
    });

    it('should pass through full component names', () => {
      expect(plugin.normalizeComponentName('nitro-node')).toBe('nitro-node');
      expect(plugin.normalizeComponentName('batch-poster')).toBe('batch-poster');
      expect(plugin.normalizeComponentName('validator')).toBe('validator');
    });

    it('should handle case-insensitive input', () => {
      expect(plugin.normalizeComponentName('NITRO')).toBe('nitro-node');
      expect(plugin.normalizeComponentName('Batcher')).toBe('batch-poster');
    });

    it('should return system for unknown names', () => {
      expect(plugin.normalizeComponentName('unknown')).toBe('system');
      expect(plugin.normalizeComponentName('op-geth')).toBe('system');
    });
  });

  describe('mapMetricToComponent', () => {
    it('should map CPU/memory/txPool metrics to nitro-node', () => {
      expect(plugin.mapMetricToComponent('cpuUsage')).toBe('nitro-node');
      expect(plugin.mapMetricToComponent('memoryUsage')).toBe('nitro-node');
      expect(plugin.mapMetricToComponent('txPoolPending')).toBe('nitro-node');
    });

    it('should map batch metrics to batch-poster', () => {
      expect(plugin.mapMetricToComponent('batchPosterBalance')).toBe('batch-poster');
      expect(plugin.mapMetricToComponent('batchLag')).toBe('batch-poster');
    });

    it('should map validator metrics to validator', () => {
      expect(plugin.mapMetricToComponent('validatorBalance')).toBe('validator');
      expect(plugin.mapMetricToComponent('rblockCount')).toBe('validator');
    });

    it('should return system for unknown metrics', () => {
      expect(plugin.mapMetricToComponent('unknownMetric')).toBe('system');
    });
  });

  describe('k8sComponents', () => {
    it('should define 3 K8s components', () => {
      expect(plugin.k8sComponents).toHaveLength(3);
    });

    it('should have exactly one primary execution component (nitro-node)', () => {
      const primary = plugin.k8sComponents.filter(c => c.isPrimaryExecution);
      expect(primary).toHaveLength(1);
      expect(primary[0].component).toBe('nitro-node');
    });

    it('should have L1 RPC env vars for all components', () => {
      const withL1Env = plugin.k8sComponents.filter(c => c.l1RpcEnvVar);
      expect(withL1Env.length).toBe(3);
    });

    it('should have unique label suffixes', () => {
      const suffixes = plugin.k8sComponents.map(c => c.labelSuffix);
      expect(new Set(suffixes).size).toBe(suffixes.length);
    });
  });

  describe('eoaConfigs', () => {
    it('should define configs for batcher and validator roles', () => {
      expect(plugin.eoaConfigs).toHaveLength(2);
      const roles = plugin.eoaConfigs.map(c => c.role);
      expect(roles).toContain('batcher');
      expect(roles).toContain('validator');
    });

    it('should have env var names for each role', () => {
      for (const config of plugin.eoaConfigs) {
        expect(config.addressEnvVar).toBeTruthy();
        expect(config.displayName).toBeTruthy();
      }
    });
  });

  describe('getPlaybooks', () => {
    it('should return 8 playbooks', () => {
      const playbooks = plugin.getPlaybooks();
      expect(playbooks).toHaveLength(8);
    });

    it('should have valid playbook structure', () => {
      const playbooks = plugin.getPlaybooks();
      for (const pb of playbooks) {
        expect(pb.name).toBeTruthy();
        expect(pb.description).toBeTruthy();
        expect(pb.trigger).toBeDefined();
        expect(pb.trigger.component).toBeTruthy();
        expect(pb.trigger.indicators.length).toBeGreaterThan(0);
        expect(pb.actions.length).toBeGreaterThan(0);
        expect(typeof pb.maxAttempts).toBe('number');
      }
    });

    it('should only reference known components in triggers', () => {
      const playbooks = plugin.getPlaybooks();
      const allComponents = [...plugin.components, ...plugin.metaComponents];
      for (const pb of playbooks) {
        expect(allComponents).toContain(pb.trigger.component);
      }
    });
  });

  describe('aiPrompts', () => {
    it('should have all required prompt fields', () => {
      const prompts = plugin.aiPrompts;
      expect(prompts.rcaSystemPrompt).toBeTruthy();
      expect(prompts.anomalyAnalyzerContext).toBeTruthy();
      expect(prompts.predictiveScalerContext).toBeTruthy();
      expect(prompts.costOptimizerContext).toBeTruthy();
      expect(prompts.dailyReportContext).toBeTruthy();
      expect(prompts.nlopsSystemContext).toBeTruthy();
      expect(prompts.failurePatterns).toBeTruthy();
    });

    it('should reference Arbitrum components in RCA prompt', () => {
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('nitro-node');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('batch-poster');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('validator');
    });
  });
});

// ============================================================
// ZkL2GenericPlugin Tests
// ============================================================

describe('ZkL2GenericPlugin', () => {
  let plugin: ZkL2GenericPlugin;

  beforeEach(() => {
    delete process.env.CHAIN_TYPE;
    plugin = new ZkL2GenericPlugin();
  });

  it('should map execution metrics to zk-sequencer', () => {
    expect(plugin.mapMetricToComponent('cpuUsage')).toBe('zk-sequencer');
    expect(plugin.mapMetricToComponent('txPoolPending')).toBe('zk-sequencer');
    expect(plugin.mapMetricToComponent('rpcLatency')).toBe('zk-sequencer');
  });

  it('should map settlement and proof metrics to specialized components', () => {
    expect(plugin.mapMetricToComponent('settlementLag')).toBe('zk-batcher');
    expect(plugin.mapMetricToComponent('batchSubmissionDelay')).toBe('zk-batcher');
    expect(plugin.mapMetricToComponent('proofQueueDepth')).toBe('zk-prover');
  });

  it('should normalize component aliases', () => {
    expect(plugin.normalizeComponentName('SEQUENCER')).toBe('zk-sequencer');
    expect(plugin.normalizeComponentName('batcher')).toBe('zk-batcher');
    expect(plugin.normalizeComponentName('prover')).toBe('zk-prover');
    expect(plugin.normalizeComponentName('unknown')).toBe('system');
  });
});

// ============================================================
// Registry Tests
// ============================================================

describe('ChainRegistry', () => {
  beforeEach(() => {
    delete process.env.CHAIN_TYPE;
    resetChainRegistry();
  });

  it('should lazy-load ThanosPlugin by default', () => {
    const plugin = getChainPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.chainType).toBe('thanos');
  });

  it('should return same instance on repeated calls', () => {
    const first = getChainPlugin();
    const second = getChainPlugin();
    expect(first).toBe(second);
  });

  it('should return correct chain type', () => {
    expect(getChainType()).toBe('thanos');
  });

  it('should allow registering a custom plugin', () => {
    const mockPlugin: ChainPlugin = {
      chainType: 'test-chain',
      displayName: 'Test Chain',
      chainMode: 'standard',
      capabilities: {
        l1Failover: false,
        eoaBalanceMonitoring: false,
        disputeGameMonitoring: false,
        proofMonitoring: false,
        settlementMonitoring: false,
      },
      components: ['test-node'],
      metaComponents: ['l1', 'system'],
      dependencyGraph: {
        'test-node': { dependsOn: ['l1'], feeds: [] },
        'l1': { dependsOn: [], feeds: ['test-node'] },
        'system': { dependsOn: [], feeds: ['test-node'] },
      },
      componentAliases: { 'node': 'test-node' },
      k8sComponents: [],
      primaryExecutionClient: 'test-node',
      eoaRoles: [],
      eoaConfigs: [],
      balanceMetrics: [],
      expectedBlockIntervalSeconds: 2,
      l1Chain: {} as never,
      l2Chain: {} as never,
      aiPrompts: {
        rcaSystemPrompt: '',
        anomalyAnalyzerContext: '',
        predictiveScalerContext: '',
        costOptimizerContext: '',
        dailyReportContext: '',
        nlopsSystemContext: '',
        failurePatterns: '',
      },
      mapMetricToComponent: () => 'system',
      normalizeComponentName: (name: string) => name === 'node' ? 'test-node' : 'system',
      getPlaybooks: () => [],
    };

    registerChainPlugin(mockPlugin);
    expect(getChainPlugin().chainType).toBe('test-chain');
    expect(getChainType()).toBe('test-chain');
  });

  it('should reset registry correctly', () => {
    // Load default
    getChainPlugin();
    // Reset
    resetChainRegistry();
    // Re-registering should work
    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('thanos');
  });

  it('should load OptimismPlugin when CHAIN_TYPE is optimism', () => {
    process.env.CHAIN_TYPE = 'optimism';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('optimism');
    expect(plugin).toBeInstanceOf(OptimismPlugin);
  });

  it('should map CHAIN_TYPE=my-l2 to OptimismPlugin', () => {
    process.env.CHAIN_TYPE = 'my-l2';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('optimism');
    expect(plugin).toBeInstanceOf(OptimismPlugin);
  });

  it('should load ZkstackPlugin when CHAIN_TYPE is zkstack', () => {
    process.env.CHAIN_TYPE = 'zkstack';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('zkstack');
    expect(plugin).toBeInstanceOf(ZkstackPlugin);
  });

  it('should load ArbitrumPlugin when CHAIN_TYPE is arbitrum', () => {
    process.env.CHAIN_TYPE = 'arbitrum';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('arbitrum');
    expect(plugin).toBeInstanceOf(ArbitrumPlugin);
  });

  it('should map CHAIN_TYPE=arbitrum-orbit to ArbitrumPlugin', () => {
    process.env.CHAIN_TYPE = 'arbitrum-orbit';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('arbitrum');
    expect(plugin).toBeInstanceOf(ArbitrumPlugin);
  });

  it('should map CHAIN_TYPE=nitro to ArbitrumPlugin', () => {
    process.env.CHAIN_TYPE = 'nitro';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('arbitrum');
    expect(plugin).toBeInstanceOf(ArbitrumPlugin);
  });

  it('should map CHAIN_TYPE=scroll to ZkL2GenericPlugin', () => {
    process.env.CHAIN_TYPE = 'scroll';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('zkl2-generic');
    expect(plugin).toBeInstanceOf(ZkL2GenericPlugin);
  });

  it('should map CHAIN_TYPE=linea to ZkL2GenericPlugin', () => {
    process.env.CHAIN_TYPE = 'linea';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('zkl2-generic');
    expect(plugin).toBeInstanceOf(ZkL2GenericPlugin);
  });

  it('should map CHAIN_TYPE=polygon-zkevm to ZkL2GenericPlugin', () => {
    process.env.CHAIN_TYPE = 'polygon-zkevm';
    resetChainRegistry();

    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('zkl2-generic');
    expect(plugin).toBeInstanceOf(ZkL2GenericPlugin);
  });
});
