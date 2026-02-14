/**
 * Chain Plugin System Tests
 * Validates ChainPlugin interface, OptimismPlugin implementation, and registry behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OptimismPlugin } from '@/chains/optimism';
import {
  getChainPlugin,
  resetChainRegistry,
  registerChainPlugin,
  getChainType,
} from '@/chains/registry';
import type { ChainPlugin } from '@/chains/types';

describe('OptimismPlugin', () => {
  let plugin: OptimismPlugin;

  beforeEach(() => {
    plugin = new OptimismPlugin();
  });

  // ============================================================
  // Basic Properties
  // ============================================================

  describe('properties', () => {
    it('should have correct chain type and display name', () => {
      expect(plugin.chainType).toBe('optimism');
      expect(plugin.displayName).toBe('Optimism L2 Rollup');
    });

    it('should define 4 L2 components', () => {
      expect(plugin.components).toEqual(['op-geth', 'op-node', 'op-batcher', 'op-proposer']);
    });

    it('should define 2 meta-components', () => {
      expect(plugin.metaComponents).toEqual(['l1', 'system']);
    });

    it('should have op-geth as primary execution client', () => {
      expect(plugin.primaryExecutionClient).toBe('op-geth');
    });

    it('should define batcher and proposer EOA roles', () => {
      expect(plugin.eoaRoles).toEqual(['batcher', 'proposer']);
    });

    it('should define balance metrics', () => {
      expect(plugin.balanceMetrics).toEqual(['batcherBalance', 'proposerBalance']);
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
    it('should define 4 K8s components', () => {
      expect(plugin.k8sComponents).toHaveLength(4);
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
    it('should define configs for batcher and proposer', () => {
      expect(plugin.eoaConfigs).toHaveLength(2);
      const roles = plugin.eoaConfigs.map(c => c.role);
      expect(roles).toContain('batcher');
      expect(roles).toContain('proposer');
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

    it('should reference Optimism components in RCA prompt', () => {
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-geth');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-node');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-batcher');
      expect(plugin.aiPrompts.rcaSystemPrompt).toContain('op-proposer');
    });

    it('should reference Optimism in anomaly analyzer context', () => {
      expect(plugin.aiPrompts.anomalyAnalyzerContext).toContain('op-node');
      expect(plugin.aiPrompts.anomalyAnalyzerContext).toContain('op-geth');
    });
  });
});

// ============================================================
// Registry Tests
// ============================================================

describe('ChainRegistry', () => {
  beforeEach(() => {
    resetChainRegistry();
  });

  it('should lazy-load OptimismPlugin by default', () => {
    const plugin = getChainPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.chainType).toBe('optimism');
  });

  it('should return same instance on repeated calls', () => {
    const first = getChainPlugin();
    const second = getChainPlugin();
    expect(first).toBe(second);
  });

  it('should return correct chain type', () => {
    expect(getChainType()).toBe('optimism');
  });

  it('should allow registering a custom plugin', () => {
    const mockPlugin: ChainPlugin = {
      chainType: 'test-chain',
      displayName: 'Test Chain',
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
    expect(plugin.chainType).toBe('optimism');
  });
});
