/**
 * Seed vCPU Manager
 * Manages simulated vCPU/Memory changes during seed scenario injection
 */

type Scenario = 'stable' | 'rising' | 'spike' | 'falling' | 'live' | null;

interface VcpuProfile {
  vcpuValues: number[];
  scenario: Scenario;
  currentIndex: number;
  startTime: number;
}

let profile: VcpuProfile | null = null;

/**
 * Generate vCPU progression based on scenario
 */
function generateVcpuProgression(scenario: Scenario): number[] {
  switch (scenario) {
    case 'stable':
      // Stable: constant 1 vCPU
      return Array(20).fill(1);

    case 'rising':
      // Rising: 1 → 2 → 4 over 20 data points
      return [1, 1, 1, 1, 1, 1.2, 1.4, 1.6, 2, 2.2, 2.5, 2.8, 3, 3.3, 3.5, 3.7, 3.9, 4, 4, 4];

    case 'spike':
      // Spike: stable then sudden jump to 4
      return [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4];

    case 'falling':
      // Falling: 4 → 2 → 1
      return [4, 4, 4, 4, 4, 3.8, 3.5, 3, 2.8, 2.5, 2.2, 2, 1.8, 1.5, 1.2, 1, 1, 1, 1, 1];

    case 'live':
    case null:
    default:
      // Live: use realistic current value
      return Array(20).fill(1);
  }
}

/**
 * Initialize vCPU profile for a scenario
 */
export function initVcpuProfile(scenario: Scenario): void {
  profile = {
    vcpuValues: generateVcpuProgression(scenario),
    scenario,
    currentIndex: 0,
    startTime: Date.now(),
  };
}

/**
 * Get current vCPU value for the scenario
 * Advances through the vCPU progression with each call
 */
export function getCurrentVcpu(): number {
  if (!profile || profile.scenario === 'live' || profile.scenario === null) {
    return 1;
  }

  const vcpu = profile.vcpuValues[profile.currentIndex];
  // Advance to next index on next call (cycle through)
  profile.currentIndex = (profile.currentIndex + 1) % profile.vcpuValues.length;
  return vcpu;
}

/**
 * Get current scenario
 */
export function getActiveScenario(): Scenario {
  return profile?.scenario || null;
}

/**
 * Clear the profile (e.g., when switching to live or stopping seed)
 */
export function clearVcpuProfile(): void {
  profile = null;
}

/**
 * Get profile info for debugging
 */
export function getProfileInfo() {
  if (!profile) {
    return {
      active: false,
      scenario: null,
    };
  }

  return {
    active: true,
    scenario: profile.scenario,
    currentIndex: profile.currentIndex,
    currentVcpu: profile.vcpuValues[profile.currentIndex],
    uptime: Date.now() - profile.startTime,
  };
}
