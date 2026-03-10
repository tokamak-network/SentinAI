/**
 * 체인 플러그인 공통 검증 체크리스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §8
 *
 * 신규 체인 플러그인 추가 시 반드시 통과해야 하는 공통 검증 조건:
 * 1. 기본 속성 (chainType, displayName)
 * 2. 최소 1개 이상의 컴포넌트
 * 3. 의존성 그래프 일관성 (정의된 컴포넌트만 참조)
 * 4. 순환 의존성 없음
 * 5. feeds ↔ dependsOn 양방향 대칭
 * 6. AI 프롬프트 정의
 * 7. K8s 설정 정의
 * 8. 기본 Playbook 정의
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThanosPlugin } from '@/chains/thanos';
import { OptimismPlugin } from '@/chains/optimism';
import { ZkstackPlugin } from '@/chains/zkstack';
import { ArbitrumPlugin } from '@/chains/arbitrum';
import type { ChainPlugin } from '@/chains/types';

// ============================================================
// 지원 체인 목록
// ============================================================

interface PluginFactory {
  name: string;
  create: () => ChainPlugin;
}

const CHAIN_PLUGINS: PluginFactory[] = [
  { name: 'Thanos', create: () => new ThanosPlugin() },
  { name: 'Optimism', create: () => new OptimismPlugin() },
  { name: 'ZK Stack', create: () => new ZkstackPlugin() },
  { name: 'Arbitrum', create: () => new ArbitrumPlugin() },
];

// ============================================================
// 공통 검증 함수
// ============================================================

function detectCycle(graph: Record<string, { dependsOn: string[] }>, startNode: string): boolean {
  const visited = new Set<string>();
  const path = new Set<string>();

  function dfs(node: string): boolean {
    if (path.has(node)) return true;
    if (visited.has(node)) return false;
    path.add(node);
    visited.add(node);
    for (const dep of (graph[node]?.dependsOn ?? [])) {
      if (dfs(dep)) return true;
    }
    path.delete(node);
    return false;
  }

  return dfs(startNode);
}

// ============================================================
// 체인별 공통 검증 스위트
// ============================================================

describe.each(CHAIN_PLUGINS)('$name 체인 플러그인 공통 검증', ({ create }) => {
  let plugin: ChainPlugin;

  beforeEach(() => {
    plugin = create();
  });

  // ✅ 1. 기본 속성
  describe('기본 속성', () => {
    it('chainType이 비어있지 않아야 한다', () => {
      expect(plugin.chainType).toBeTruthy();
      expect(typeof plugin.chainType).toBe('string');
    });

    it('displayName이 비어있지 않아야 한다', () => {
      expect(plugin.displayName).toBeTruthy();
      expect(typeof plugin.displayName).toBe('string');
    });
  });

  // ✅ 2. 컴포넌트 목록
  describe('컴포넌트 목록', () => {
    it('최소 1개의 L2 컴포넌트가 있어야 한다', () => {
      expect(plugin.components.length).toBeGreaterThan(0);
    });

    it('컴포넌트 이름이 모두 비어있지 않아야 한다', () => {
      for (const comp of plugin.components) {
        expect(comp).toBeTruthy();
      }
    });

    it('메타 컴포넌트(l1, system)가 있어야 한다', () => {
      expect(plugin.metaComponents).toContain('l1');
    });
  });

  // ✅ 3. 의존성 그래프 일관성
  describe('의존성 그래프 일관성', () => {
    it('모든 컴포넌트가 의존성 그래프에 정의되어야 한다', () => {
      const allComponents = [...plugin.components, ...plugin.metaComponents];
      for (const comp of allComponents) {
        expect(
          plugin.dependencyGraph[comp],
          `컴포넌트 "${comp}"가 dependencyGraph에 없음`
        ).toBeDefined();
      }
    });

    it('의존성 그래프의 모든 노드가 알려진 컴포넌트여야 한다', () => {
      const allComponents = new Set([...plugin.components, ...plugin.metaComponents]);
      for (const comp of Object.keys(plugin.dependencyGraph)) {
        expect(
          allComponents.has(comp),
          `의존성 그래프의 "${comp}"가 컴포넌트 목록에 없음`
        ).toBe(true);
      }
    });

    it('dependsOn 참조가 모두 존재하는 컴포넌트여야 한다', () => {
      const allComponents = new Set([...plugin.components, ...plugin.metaComponents]);
      for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
        for (const upstream of deps.dependsOn) {
          expect(
            allComponents.has(upstream),
            `"${comp}"의 dependsOn에 미정의 컴포넌트 "${upstream}"가 있음`
          ).toBe(true);
        }
      }
    });

    it('feeds 참조가 모두 존재하는 컴포넌트여야 한다', () => {
      const allComponents = new Set([...plugin.components, ...plugin.metaComponents]);
      for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
        for (const downstream of deps.feeds) {
          expect(
            allComponents.has(downstream),
            `"${comp}"의 feeds에 미정의 컴포넌트 "${downstream}"가 있음`
          ).toBe(true);
        }
      }
    });
  });

  // ✅ 4. 순환 의존성 없음
  describe('순환 의존성 검사', () => {
    it('의존성 그래프에 순환이 없어야 한다', () => {
      const allNodes = [...plugin.components, ...plugin.metaComponents];
      for (const node of allNodes) {
        expect(
          detectCycle(plugin.dependencyGraph, node),
          `컴포넌트 "${node}"에서 순환 의존성 발견`
        ).toBe(false);
      }
    });
  });

  // ✅ 5. 양방향 참조 대칭
  describe('양방향 참조 대칭', () => {
    it('feeds와 dependsOn이 서로 대칭이어야 한다', () => {
      for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
        for (const upstream of deps.dependsOn) {
          const upstreamDeps = plugin.dependencyGraph[upstream];
          if (upstreamDeps) {
            expect(
              upstreamDeps.feeds,
              `"${upstream}".feeds에 "${comp}"가 없음 (대칭 오류)`
            ).toContain(comp);
          }
        }
      }
    });
  });

  // ✅ 6. AI 프롬프트 정의
  describe('AI 프롬프트', () => {
    it('rcaSystemPrompt 프롬프트가 정의되어야 한다', () => {
      expect(plugin.aiPrompts.rcaSystemPrompt).toBeTruthy();
    });

    it('anomalyAnalyzerContext 프롬프트가 정의되어야 한다', () => {
      expect(plugin.aiPrompts.anomalyAnalyzerContext).toBeTruthy();
    });
  });

  // ✅ 7. K8s 설정 정의
  describe('K8s 설정', () => {
    it('k8sComponents 배열이 정의되어야 한다', () => {
      expect(plugin.k8sComponents).toBeDefined();
      expect(Array.isArray(plugin.k8sComponents)).toBe(true);
    });

    it('최소 1개 이상의 K8s 컴포넌트가 있어야 한다', () => {
      expect(plugin.k8sComponents.length).toBeGreaterThan(0);
    });
  });

  // ✅ 8. Playbook 정의
  describe('Playbook 정의', () => {
    it('getPlaybooks()가 최소 1개 이상의 Playbook을 반환해야 한다', () => {
      const playbooks = plugin.getPlaybooks();
      expect(playbooks.length).toBeGreaterThan(0);
    });

    it('각 Playbook에 name과 actions가 있어야 한다', () => {
      for (const playbook of plugin.getPlaybooks()) {
        expect(playbook.name).toBeTruthy();
        expect(playbook.actions).toBeDefined();
        expect(Array.isArray(playbook.actions)).toBe(true);
      }
    });
  });
});

// ============================================================
// 체인별 특수 검증
// ============================================================

describe('Thanos/Optimism 플러그인 특수 검증', () => {
  it('ThanosPlugin이 op-geth를 primary execution client로 정의해야 한다', () => {
    const plugin = new ThanosPlugin();
    expect(plugin.primaryExecutionClient).toBe('op-geth');
  });

  it('OptimismPlugin이 op-geth를 primary execution client로 정의해야 한다', () => {
    const plugin = new OptimismPlugin();
    expect(plugin.primaryExecutionClient).toBe('op-geth');
  });

  it('OP Stack 의존성 그래프: op-node → op-geth, op-batcher, op-proposer', () => {
    const plugin = new ThanosPlugin();
    const opNodeFeeds = plugin.dependencyGraph['op-node'].feeds;

    expect(opNodeFeeds).toContain('op-geth');
    expect(opNodeFeeds).toContain('op-batcher');
    expect(opNodeFeeds).toContain('op-proposer');
  });

  it('OP Stack: op-geth는 leaf 노드여야 한다 (feeds 없음)', () => {
    const plugin = new ThanosPlugin();
    const opGethFeeds = plugin.dependencyGraph['op-geth'].feeds;

    expect(opGethFeeds).toHaveLength(0);
  });
});

describe('Arbitrum 플러그인 특수 검증', () => {
  it('ArbitrumPlugin이 batch-poster와 validator를 포함해야 한다', () => {
    const plugin = new ArbitrumPlugin();
    expect(plugin.components).toContain('batch-poster');
    expect(plugin.components).toContain('validator');
  });

  it('Arbitrum 의존성 그래프: nitro-node → batch-poster, validator', () => {
    const plugin = new ArbitrumPlugin();
    const nitroNodeFeeds = plugin.dependencyGraph['nitro-node'].feeds;

    expect(nitroNodeFeeds).toContain('batch-poster');
    expect(nitroNodeFeeds).toContain('validator');
  });
});

describe('ZK Stack 플러그인 특수 검증', () => {
  it('ZkstackPlugin이 zksync-server를 포함해야 한다', () => {
    const plugin = new ZkstackPlugin();
    const allComponents = [...plugin.components, ...plugin.metaComponents];

    expect(allComponents).toContain('zksync-server');
  });

  it('ZK Stack: l1이 root 노드여야 한다 (dependsOn 없음)', () => {
    const plugin = new ZkstackPlugin();
    const l1Deps = plugin.dependencyGraph['l1'];

    expect(l1Deps).toBeDefined();
    expect(l1Deps.dependsOn).toHaveLength(0);
  });
});
