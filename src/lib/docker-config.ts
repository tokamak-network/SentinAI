/**
 * Docker Configuration Module
 * Low-level Docker CLI execution utilities for Docker Compose L2 support.
 * Parallel to k8s-config.ts — used when ORCHESTRATOR_TYPE=docker.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execFileAsync = promisify(execFile);

// ============================================================
// Environment Detection
// ============================================================

/** Check if Docker Compose orchestration mode is active */
export function isDockerMode(): boolean {
  return process.env.ORCHESTRATOR_TYPE === 'docker';
}

/** Get the Docker Compose file path */
export function getComposeFile(): string {
  return process.env.DOCKER_COMPOSE_FILE || 'docker-compose.yml';
}

/** Get the Docker Compose project name */
export function getComposeProject(): string {
  return process.env.DOCKER_COMPOSE_PROJECT || '';
}

/** Get the .env file path for Docker Compose env updates */
export function getDockerEnvFile(): string {
  return process.env.DOCKER_ENV_FILE || '.env';
}

/** Get host CPU count for docker stats normalization */
export function getHostCpuCount(): number {
  const envCpus = process.env.DOCKER_HOST_CPUS;
  if (envCpus) {
    const parsed = parseInt(envCpus, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return os.cpus().length || 1;
}

// ============================================================
// Docker CLI Execution
// ============================================================

/**
 * Execute a docker command with args array (no shell injection).
 * Uses execFile which does NOT spawn a shell.
 */
export async function runDockerCommand(
  args: string[],
  options?: { timeout?: number }
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: options?.timeout ?? 15000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Docker command failed: docker ${args.join(' ')} — ${message}`);
  }
}

/**
 * Execute a docker compose command.
 * Automatically includes -f <compose-file> and -p <project> flags.
 */
export async function runComposeCommand(
  args: string[],
  options?: { timeout?: number }
): Promise<string> {
  const composeArgs = ['compose'];

  const file = getComposeFile();
  if (file) {
    composeArgs.push('-f', file);
  }

  const project = getComposeProject();
  if (project) {
    composeArgs.push('-p', project);
  }

  composeArgs.push(...args);

  return runDockerCommand(composeArgs, options);
}

// ============================================================
// Container Name Resolution
// ============================================================

/**
 * Resolve Docker container name from service name.
 * Docker Compose uses {project}-{service}-1 naming by default.
 * Falls back to docker compose ps for custom container_name.
 */
export async function resolveContainerName(service: string): Promise<string> {
  try {
    const output = await runComposeCommand(
      ['ps', service, '--format', '{{.Name}}'],
      { timeout: 5000 }
    );
    const name = output.trim().split('\n')[0];
    if (name) return name;
  } catch {
    // Fallback to convention
  }

  // Fallback: project-service-1
  const project = getComposeProject();
  if (project) {
    return `${project}-${service}-1`;
  }
  return `${service}-1`;
}

// ============================================================
// Docker Stats Parsing
// ============================================================

export interface DockerStatsJson {
  Container: string;
  Name: string;
  CPUPerc: string;    // "2.50%"
  MemUsage: string;   // "2.048GiB / 16GiB"
  MemPerc: string;    // "12.80%"
  NetIO: string;
  BlockIO: string;
  PIDs: string;
}

/**
 * Parse docker stats CPUPerc (e.g. "2.50%") to millicores.
 * CPU% is relative to total host CPU, so we multiply by host core count.
 */
export function parseCpuPercToMillicores(cpuPerc: string): number {
  const percent = parseFloat(cpuPerc.replace('%', ''));
  if (isNaN(percent)) return 0;
  const hostCpus = getHostCpuCount();
  return (percent / 100) * hostCpus * 1000;
}

/**
 * Parse docker stats MemUsage (e.g. "2.048GiB / 16GiB") to MiB.
 * Takes only the used portion (before the /).
 */
export function parseMemUsageToMiB(memUsage: string): number {
  const usedPart = memUsage.split('/')[0].trim();
  return parseMemStringToMiB(usedPart);
}

/** Parse a memory string like "2.048GiB", "512MiB", "1.5GB" to MiB */
export function parseMemStringToMiB(str: string): number {
  const s = str.trim();
  if (s.endsWith('GiB')) return parseFloat(s) * 1024;
  if (s.endsWith('MiB')) return parseFloat(s);
  if (s.endsWith('KiB')) return parseFloat(s) / 1024;
  if (s.endsWith('GB')) return parseFloat(s) * 1000 * 1000 / (1024 * 1024);
  if (s.endsWith('MB')) return parseFloat(s) * 1000 * 1000 / (1024 * 1024);
  if (s.endsWith('kB')) return parseFloat(s) * 1000 / (1024 * 1024);
  if (s.endsWith('B')) return parseFloat(s) / (1024 * 1024);
  return parseFloat(s) || 0;
}
