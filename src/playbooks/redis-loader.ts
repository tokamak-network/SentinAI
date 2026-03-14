/**
 * Abstract Playbook Redis Loader
 *
 * Loads dynamically generated AbstractPlaybooks from Redis (proposal-32 output).
 * Implements fallback to empty array if Redis unavailable.
 */

import type { AbstractPlaybook } from './types'
import { getCoreRedis } from '@/core/redis'

const REDIS_KEY = 'playbooks:abstract:generated'
const REDIS_TTL = 86400 // 24 hours

/**
 * Load generated playbooks from Redis
 * Returns empty array if Redis unavailable or no playbooks stored
 */
export async function loadGeneratedPlaybooks(): Promise<AbstractPlaybook[]> {
  try {
    const redis = getCoreRedis()
    if (!redis) return []

    const stored = await redis.get(REDIS_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored) as AbstractPlaybook[]
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn('[redis-loader] Failed to load playbooks:', error)
    return []
  }
}

/**
 * Save generated playbooks to Redis
 * Called by proposal-32 PlaybookEvolver after generating new playbooks
 */
export async function saveGeneratedPlaybooks(playbooks: AbstractPlaybook[]): Promise<boolean> {
  try {
    const redis = getCoreRedis()
    if (!redis) return false

    await redis.setex(REDIS_KEY, REDIS_TTL, JSON.stringify(playbooks))
    return true
  } catch (error) {
    console.warn('[redis-loader] Failed to save playbooks:', error)
    return false
  }
}

/**
 * Clear generated playbooks from Redis
 * Useful for testing or manual cleanup
 */
export async function clearGeneratedPlaybooks(): Promise<boolean> {
  try {
    const redis = getCoreRedis()
    if (!redis) return false

    await redis.del(REDIS_KEY)
    return true
  } catch (error) {
    console.warn('[redis-loader] Failed to clear playbooks:', error)
    return false
  }
}
