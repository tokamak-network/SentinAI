/**
 * Core Playbook: Resource Pressure Recovery
 *
 * Responds to high CPU or memory usage by scaling up the block producer,
 * then verifying health.
 *
 * Applicable to: All chains (L1 and L2)
 */

import type { AbstractPlaybook } from '../types'

export const resourcePressure: AbstractPlaybook = {
  id: 'core-resource-pressure',
  name: 'Resource Pressure Recovery',
  description: 'High CPU or memory — scale up block producer then verify health',
  source: 'hardcoded',

  applicableNodeLayers: ['l1', 'l2'],

  conditions: [
    {
      metric: 'cpuUsage',
      op: 'gt',
      threshold: 90,
    },
  ],

  actions: [
    {
      type: 'scale_up',
      safetyLevel: 'guarded',
      targetRole: 'block-producer',
      params: { targetVcpu: 'next_tier' },
    },
    {
      type: 'health_check',
      safetyLevel: 'safe',
      targetRole: 'block-producer',
      waitAfterMs: 30000,
    },
  ],

  fallback: [
    {
      type: 'restart_pod',
      safetyLevel: 'guarded',
      targetRole: 'block-producer',
    },
  ],

  maxAttempts: 2,
}
