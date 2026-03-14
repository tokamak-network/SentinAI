/**
 * Core Abstract Playbooks Index
 *
 * Exports all hardcoded, chain-agnostic remediation playbooks.
 * These playbooks respond to common anomalies detected across all L1/L2 chains.
 */

import type { AbstractPlaybook } from '../types'
import { resourcePressure } from './resource-pressure'
import { txPoolBacklog } from './tx-pool-backlog'
import { syncStall } from './sync-stall'
import { eoaBalanceLow } from './eoa-balance-low'

/**
 * Get all core playbooks
 *
 * @returns Array of hardcoded AbstractPlaybooks
 */
export function getCorePlaybooks(): AbstractPlaybook[] {
  return [resourcePressure, txPoolBacklog, syncStall, eoaBalanceLow]
}

export { resourcePressure, txPoolBacklog, syncStall, eoaBalanceLow }
