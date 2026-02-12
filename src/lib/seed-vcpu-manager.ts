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
  console.log(`[Seed vCPU Manager] Initialized for scenario: ${scenario}, values:`, profile.vcpuValues);
}

/**
 * Get current vCPU value for the scenario
 * Uses time-based interpolation for smoother progression
 * Each data point represents ~5-10 seconds of real time
 */
export function getCurrentVcpu(): number {
  if (!profile || profile.scenario === 'live' || profile.scenario === null) {
    return 1;
  }

  // Calculate elapsed time since profile was initialized
  const elapsedMs = Date.now() - profile.startTime;
  const intervalMs = 5_000; // Each vCPU value is for ~5 seconds

  // Calculate which index we should be at based on elapsed time
  const calculatedIndex = Math.floor(elapsedMs / intervalMs);
  const newIndex = calculatedIndex % profile.vcpuValues.length;

  // Interpolate between current and next value for smooth progression
  const nextIndex = (newIndex + 1) % profile.vcpuValues.length;
  const currentValue = profile.vcpuValues[newIndex];
  const nextValue = profile.vcpuValues[nextIndex];

  // Blend factor: how far into the interval we are (0-1)
  const blendFactor = (elapsedMs % intervalMs) / intervalMs;
  const interpolated = currentValue + (nextValue - currentValue) * blendFactor;

  if (calculatedIndex !== profile.currentIndex) {
    const prevIndex = profile.currentIndex;
    profile.currentIndex = newIndex;
    console.log(`[Seed vCPU] ${profile.scenario} scenario: elapsed ${(elapsedMs / 1000).toFixed(1)}s, index ${prevIndex} → ${newIndex}, vCPU = ${interpolated.toFixed(2)}`);
  }

  return interpolated;
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
