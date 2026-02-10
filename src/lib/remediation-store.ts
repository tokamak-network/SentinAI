/**
 * Remediation Store
 * In-memory state management for execution history and circuit breakers
 */

import type {
  RemediationExecution,
  CircuitBreakerState,
  RemediationConfig,
} from '@/types/remediation';

// ============================================================
// In-Memory State
// ============================================================

const executions: RemediationExecution[] = [];
const circuitBreakers: Map<string, CircuitBreakerState> = new Map();
const lastExecutionTimes: Map<string, number> = new Map(); // playbookName → timestamp

let config: RemediationConfig = {
  enabled: process.env.AUTO_REMEDIATION_ENABLED === 'true',
  allowGuardedActions: process.env.REMEDIATION_ALLOW_GUARDED !== 'false', // Default: true
  cooldownMinutes: parseInt(process.env.REMEDIATION_COOLDOWN_MIN || '5', 10),
  maxExecutionsPerHour: 3,
  maxExecutionsPerDay: 10,
  maxAutoScaleVcpu: parseInt(process.env.REMEDIATION_MAX_VCPU || '4', 10),
  circuitBreakerThreshold: 3,
};

const MAX_EXECUTIONS = 100; // Circular buffer size

// ============================================================
// Execution History
// ============================================================

/**
 * Add execution record
 */
export function addExecution(execution: RemediationExecution): void {
  executions.unshift(execution); // Newest first

  // Circular buffer: Keep only last 100
  if (executions.length > MAX_EXECUTIONS) {
    executions.pop();
  }
}

/**
 * Get recent executions
 */
export function getExecutions(limit: number = 20): RemediationExecution[] {
  return executions.slice(0, limit);
}

/**
 * Get execution by ID
 */
export function getExecutionById(id: string): RemediationExecution | null {
  return executions.find(e => e.id === id) || null;
}

/**
 * Get last execution time for a playbook (for cooldown)
 */
export function getLastExecutionTime(playbookName: string): Date | null {
  const timestamp = lastExecutionTimes.get(playbookName);
  return timestamp ? new Date(timestamp) : null;
}

/**
 * Update last execution time
 */
export function setLastExecutionTime(playbookName: string, timestamp: number): void {
  lastExecutionTimes.set(playbookName, timestamp);
}

/**
 * Get execution count within time window
 */
export function getExecutionCount(windowMs: number): number {
  const now = Date.now();
  const cutoff = now - windowMs;

  return executions.filter(e => {
    const execTime = new Date(e.startedAt).getTime();
    return execTime >= cutoff;
  }).length;
}

// ============================================================
// Circuit Breaker
// ============================================================

/**
 * Record a failure for circuit breaker
 */
export function recordFailure(playbookName: string): void {
  const state = circuitBreakers.get(playbookName) || {
    playbookName,
    consecutiveFailures: 0,
    isOpen: false,
  };

  state.consecutiveFailures += 1;

  // Open circuit if threshold exceeded
  if (state.consecutiveFailures >= config.circuitBreakerThreshold) {
    state.isOpen = true;
    state.openedAt = new Date().toISOString();
    // Reset after 24 hours
    const resetTime = new Date();
    resetTime.setHours(resetTime.getHours() + 24);
    state.resetAt = resetTime.toISOString();
  }

  circuitBreakers.set(playbookName, state);
}

/**
 * Record a success (resets consecutive failures)
 */
export function recordSuccess(playbookName: string): void {
  const state = circuitBreakers.get(playbookName);
  
  if (state) {
    state.consecutiveFailures = 0;
    state.isOpen = false;
    state.openedAt = undefined;
    state.resetAt = undefined;
    circuitBreakers.set(playbookName, state);
  }
}

/**
 * Check if circuit is open (disabled)
 */
export function isCircuitOpen(playbookName: string): boolean {
  const state = circuitBreakers.get(playbookName);
  
  if (!state || !state.isOpen) return false;

  // Check if reset time has passed
  if (state.resetAt) {
    const resetTime = new Date(state.resetAt).getTime();
    if (Date.now() >= resetTime) {
      // Auto-close circuit
      state.isOpen = false;
      state.consecutiveFailures = 0;
      state.openedAt = undefined;
      state.resetAt = undefined;
      circuitBreakers.set(playbookName, state);
      return false;
    }
  }

  return true;
}

/**
 * Get all circuit breaker states
 */
export function getCircuitStates(): CircuitBreakerState[] {
  return Array.from(circuitBreakers.values());
}

/**
 * Manually reset a circuit breaker
 */
export function resetCircuit(playbookName: string): void {
  const state = circuitBreakers.get(playbookName);
  
  if (state) {
    state.isOpen = false;
    state.consecutiveFailures = 0;
    state.openedAt = undefined;
    state.resetAt = undefined;
    circuitBreakers.set(playbookName, state);
  }
}

// ============================================================
// Configuration
// ============================================================

/**
 * Get current configuration
 */
export function getConfig(): RemediationConfig {
  return { ...config };
}

/**
 * Update configuration
 */
export function updateConfig(updates: Partial<RemediationConfig>): RemediationConfig {
  config = { ...config, ...updates };
  return { ...config };
}

// ============================================================
// Clear State (Testing)
// ============================================================

/**
 * Clear all state (for testing)
 */
export function clearAll(): void {
  executions.length = 0;
  circuitBreakers.clear();
  lastExecutionTimes.clear();
  
  // Reset config to defaults
  config = {
    enabled: process.env.AUTO_REMEDIATION_ENABLED === 'true',
    allowGuardedActions: process.env.REMEDIATION_ALLOW_GUARDED !== 'false',
    cooldownMinutes: parseInt(process.env.REMEDIATION_COOLDOWN_MIN || '5', 10),
    maxExecutionsPerHour: 3,
    maxExecutionsPerDay: 10,
    maxAutoScaleVcpu: parseInt(process.env.REMEDIATION_MAX_VCPU || '4', 10),
    circuitBreakerThreshold: 3,
  };
}
