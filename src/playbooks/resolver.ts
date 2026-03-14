/**
 * Abstract Playbook Resolver
 *
 * Implements three-layer playbook resolution:
 * 1. Redis dynamic playbooks (proposal-32 generated)
 * 2. Chain-specific Playbook variants (existing)
 * 3. Core AbstractPlaybook set (hardcoded, chain-neutral)
 *
 * Also handles role resolution: ComponentRole → actual component name
 */

import type { AbstractPlaybook, AbstractRemediationAction, ComponentRole } from './types'
import type { Playbook } from '@/types/remediation'
import type { ChainPlugin } from '@/chains/types'
import { loadGeneratedPlaybooks } from './redis-loader'
import { getCorePlaybooks } from './core'

/**
 * Three-layer playbook matcher.
 * Returns all matching playbooks in priority order (Layer 1 → Layer 2 → Layer 3)
 */
export async function resolvePlaybooks(
  chainPlugin: ChainPlugin,
  nodeLayer: 'l1' | 'l2',
  requiredRoles?: ComponentRole[]
): Promise<AbstractPlaybook[]> {
  const results: AbstractPlaybook[] = []

  // Layer 1: Redis dynamic playbooks
  const generated = await loadGeneratedPlaybooks()
  results.push(
    ...generated.filter(pb => {
      // Filter by node layer if specified
      if (pb.applicableNodeLayers && !pb.applicableNodeLayers.includes(nodeLayer)) {
        return false
      }

      // Filter by required roles
      if (pb.requiredRoles && pb.requiredRoles.length > 0) {
        const roleMap = chainPlugin.roleMap ?? {}
        return pb.requiredRoles.every(role => role in roleMap)
      }

      return true
    })
  )

  // Layer 2: Chain-specific playbooks (existing Playbook type)
  // Note: Layer 2 is already handled by playbook-matcher which loads these from ChainPlugin.getPlaybooks()
  // We only include AbstractPlaybooks here, so Layer 2 is skipped in this function.
  // The integration point is in playbook-matcher.ts where both types are combined.

  // Layer 3: Core hardcoded abstract playbooks
  const core = getCorePlaybooks()
  results.push(
    ...core.filter(pb => {
      // Filter by node layer if specified
      if (pb.applicableNodeLayers && !pb.applicableNodeLayers.includes(nodeLayer)) {
        return false
      }

      // Filter by required roles
      if (pb.requiredRoles && pb.requiredRoles.length > 0) {
        const roleMap = chainPlugin.roleMap ?? {}
        return pb.requiredRoles.every(role => role in roleMap)
      }

      return true
    })
  )

  return results
}

/**
 * Resolve a ComponentRole to actual component name for a chain
 *
 * @throws Error if role not found in chainPlugin.roleMap
 */
export function resolveRole(chainPlugin: ChainPlugin, role: ComponentRole): string {
  const roleMap = chainPlugin.roleMap ?? {}
  const component = roleMap[role]

  if (!component) {
    throw new Error(`Role '${role}' not mapped in ${chainPlugin.chainType} chain plugin roleMap`)
  }

  return component
}

/**
 * Resolve an AbstractRemediationAction:
 * If targetRole is set, resolve to actual component via roleMap.
 * Otherwise, return target field unchanged.
 */
export function resolveAction(
  action: AbstractRemediationAction,
  chainPlugin: ChainPlugin
): AbstractRemediationAction {
  if (!action.targetRole) {
    return action
  }

  const resolvedComponent = resolveRole(chainPlugin, action.targetRole)

  return {
    ...action,
    target: resolvedComponent,
    targetRole: undefined, // Clear targetRole after resolution
  }
}
