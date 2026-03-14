/**
 * Abstract Playbook Matcher
 *
 * Integrates AbstractPlaybooks with the existing playbook-matcher.
 * Implements three-layer resolution:
 * 1. Redis dynamic playbooks (proposal-32 generated)
 * 2. Chain-specific Playbook variants (existing)
 * 3. Core AbstractPlaybook set (hardcoded, chain-neutral)
 */

import type { AnomalyEvent, DeepAnalysisResult } from '@/types/anomaly'
import type { Playbook, RemediationAction } from '@/types/remediation'
import type { AbstractPlaybook, AbstractRemediationAction } from '@/playbooks/types'
import { evaluateConditions } from '@/playbooks/evaluate'
import { resolvePlaybooks, resolveAction } from '@/playbooks/resolver'
import { getChainPlugin } from '@/chains'

/**
 * Match an anomaly event to abstract playbooks (Layers 1 & 3)
 * Returns matching AbstractPlaybooks in priority order
 */
export async function matchAbstractPlaybooks(
  event: AnomalyEvent,
  nodeLayer: 'l1' | 'l2' = 'l2'
): Promise<AbstractPlaybook[]> {
  const plugin = getChainPlugin()

  // Get all abstract playbooks from Layers 1 & 3
  const candidates = await resolvePlaybooks(plugin, nodeLayer)

  // Filter by evaluated conditions
  const matches = candidates.filter(playbook => {
    try {
      return evaluateConditions(playbook.conditions, event)
    } catch {
      return false
    }
  })

  return matches
}

/**
 * Resolve abstract playbook actions to executable RemediationAction format
 * Converts ComponentRole references to actual component names
 */
export function resolvePlaybookActions(
  playbook: AbstractPlaybook,
  actionSource: 'primary' | 'fallback' = 'primary'
): RemediationAction[] {
  const plugin = getChainPlugin()
  const rawActions = actionSource === 'fallback' ? playbook.fallback || [] : playbook.actions

  return rawActions.map(action => {
    const resolved = resolveAction(action as AbstractRemediationAction, plugin)

    // Convert AbstractRemediationAction to RemediationAction
    return {
      type: resolved.type,
      safetyLevel: resolved.safetyLevel,
      target: resolved.target,
      params: resolved.params,
      waitAfterMs: resolved.waitAfterMs,
    } as RemediationAction
  })
}

/**
 * Match event to best playbook (abstract or chain-specific)
 * Returns first matching playbook with resolved actions
 */
export async function matchAndResolvePlaybook(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): Promise<{
  playbook: AbstractPlaybook | Playbook
  actions: RemediationAction[]
  source: 'abstract' | 'chain-specific'
} | null> {
  // Try abstract playbooks first (Layers 1 & 3)
  const abstractMatches = await matchAbstractPlaybooks(event, event.anomalies[0]?.metric.includes('l2') !== false ? 'l2' : 'l1')

  if (abstractMatches.length > 0) {
    const playbook = abstractMatches[0]
    const actions = resolvePlaybookActions(playbook, 'primary')

    return {
      playbook,
      actions,
      source: 'abstract',
    }
  }

  // Layer 2: Chain-specific playbooks (existing mechanism)
  // This would be integrated with the existing matchPlaybook function
  // For now, returning null indicates no match found in abstract layer

  return null
}
