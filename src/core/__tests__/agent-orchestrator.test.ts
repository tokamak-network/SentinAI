/**
 * Unit Tests for AgentOrchestrator
 * Verifies per-instance agent lifecycle management without real RPC/K8s/AI calls.
 * All agent classes and their dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks
// ============================================================

// Mock all agent classes with start/stop/isRunning stubs
vi.mock('@/core/agents/collector-agent', () => ({
  CollectorAgent: vi.fn().mockImplementation(({ instanceId }: { instanceId: string }) => ({
    instanceId,
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    getLastCollectedAt: vi.fn().mockReturnValue(null),
  })),
}))

vi.mock('@/core/agents/detector-agent', () => ({
  DetectorAgent: vi.fn().mockImplementation(({ instanceId }: { instanceId: string }) => ({
    instanceId,
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  })),
}))

vi.mock('@/core/agents/analyzer-agent', () => ({
  AnalyzerAgent: vi.fn().mockImplementation(({ instanceId }: { instanceId: string }) => ({
    instanceId,
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  })),
}))

vi.mock('@/core/agents/executor-agent', () => ({
  ExecutorAgent: vi.fn().mockImplementation(({ instanceId }: { instanceId: string }) => ({
    instanceId,
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    getLastExecutedAt: vi.fn().mockReturnValue(null),
  })),
}))

vi.mock('@/core/agents/verifier-agent', () => ({
  VerifierAgent: vi.fn().mockImplementation(({ instanceId }: { instanceId: string }) => ({
    instanceId,
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  })),
}))

// Domain agent mocks
const makeDomainAgentMock = (domain: string) => ({
  instanceId: 'mock',
  domain,
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn().mockReturnValue(true),
  getTickCount: vi.fn().mockReturnValue(0),
  getLastTickAt: vi.fn().mockReturnValue(null),
})

vi.mock('@/core/agents/scaling-agent', () => ({
  ScalingAgent: vi.fn().mockImplementation(() => makeDomainAgentMock('scaling')),
}))

vi.mock('@/core/agents/security-agent', () => ({
  SecurityAgent: vi.fn().mockImplementation(() => makeDomainAgentMock('security')),
}))

vi.mock('@/core/agents/reliability-agent', () => ({
  ReliabilityAgent: vi.fn().mockImplementation(() => makeDomainAgentMock('reliability')),
}))

vi.mock('@/core/agents/rca-agent', () => ({
  RCADomainAgent: vi.fn().mockImplementation(() => makeDomainAgentMock('rca')),
}))

vi.mock('@/core/agents/cost-agent', () => ({
  CostAgent: vi.fn().mockImplementation(() => makeDomainAgentMock('cost')),
}))

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ============================================================
// Import After Mocks
// ============================================================

import { AgentOrchestrator } from '@/core/agent-orchestrator'

// ============================================================
// Helpers
// ============================================================

function makeOrchestrator(): AgentOrchestrator {
  return new AgentOrchestrator()
}

// ============================================================
// Tests
// ============================================================

describe('AgentOrchestrator', () => {
  beforeEach(() => {
    // Clear the global singleton to ensure test isolation
    delete (globalThis as Record<string, unknown>).__sentinai_agent_orchestrator
    vi.clearAllMocks()
    // Reset L2_RPC_URL so CollectorAgent is not skipped due to missing rpcUrl
    process.env.L2_RPC_URL = 'http://localhost:8545'
  })

  it('startInstance creates agents for the instance', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-1', 'opstack-l2', 'http://localhost:8545')

    expect(orchestrator.isInstanceRunning('inst-1')).toBe(true)
    expect(orchestrator.getInstanceIds()).toContain('inst-1')
  })

  it('stopInstance stops all agents for the instance', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-2', 'opstack-l2', 'http://localhost:8545')
    expect(orchestrator.isInstanceRunning('inst-2')).toBe(true)

    orchestrator.stopInstance('inst-2')

    expect(orchestrator.isInstanceRunning('inst-2')).toBe(false)
    expect(orchestrator.getInstanceIds()).not.toContain('inst-2')
  })

  it('getStatuses returns all running agent statuses', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-3', 'opstack-l2', 'http://localhost:8545')

    const statuses = orchestrator.getStatuses()

    // Should have at least one status entry for inst-3
    expect(statuses.length).toBeGreaterThan(0)
    const instanceStatuses = statuses.filter((s) => s.instanceId === 'inst-3')
    expect(instanceStatuses.length).toBeGreaterThan(0)
    // All reported statuses should indicate running=true (from mock)
    instanceStatuses.forEach((s) => expect(s.running).toBe(true))
  })

  it('two instances do not interfere with each other', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-a', 'opstack-l2', 'http://node-a:8545')
    orchestrator.startInstance('inst-b', 'opstack-l2', 'http://node-b:8545')

    expect(orchestrator.isInstanceRunning('inst-a')).toBe(true)
    expect(orchestrator.isInstanceRunning('inst-b')).toBe(true)

    // Stop only inst-a
    orchestrator.stopInstance('inst-a')

    expect(orchestrator.isInstanceRunning('inst-a')).toBe(false)
    // inst-b remains unaffected
    expect(orchestrator.isInstanceRunning('inst-b')).toBe(true)
  })

  it('stopAll stops all running instances', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-x', 'opstack-l2', 'http://localhost:8545')
    orchestrator.startInstance('inst-y', 'opstack-l2', 'http://localhost:8546')
    orchestrator.startInstance('inst-z', 'opstack-l2', 'http://localhost:8547')

    expect(orchestrator.getInstanceIds()).toHaveLength(3)

    orchestrator.stopAll()

    expect(orchestrator.getInstanceIds()).toHaveLength(0)
    expect(orchestrator.isInstanceRunning('inst-x')).toBe(false)
    expect(orchestrator.isInstanceRunning('inst-y')).toBe(false)
    expect(orchestrator.isInstanceRunning('inst-z')).toBe(false)
  })

  it('getInstanceIds returns registered instance ids', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('id-1', 'opstack-l2', 'http://localhost:8545')
    orchestrator.startInstance('id-2', 'arbitrum-nitro', 'http://localhost:8546')

    const ids = orchestrator.getInstanceIds()

    expect(ids).toContain('id-1')
    expect(ids).toContain('id-2')
    expect(ids).toHaveLength(2)
  })

  it('startInstance is idempotent — second call for same instance is a no-op', () => {
    const orchestrator = makeOrchestrator()

    orchestrator.startInstance('inst-dup', 'opstack-l2', 'http://localhost:8545')
    orchestrator.startInstance('inst-dup', 'opstack-l2', 'http://localhost:8545')

    // Should still only have one entry
    expect(orchestrator.getInstanceIds().filter((id) => id === 'inst-dup')).toHaveLength(1)
  })

  it('stopInstance on unknown id is a no-op — does not throw', () => {
    const orchestrator = makeOrchestrator()

    expect(() => orchestrator.stopInstance('nonexistent')).not.toThrow()
  })
})
