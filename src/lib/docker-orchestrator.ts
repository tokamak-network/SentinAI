/**
 * Docker Compose Orchestrator
 * Business functions for Docker Compose-based L2 node management.
 * Each function is a Docker equivalent of corresponding K8s operations.
 */

import {
  runDockerCommand,
  runComposeCommand,
  resolveContainerName,
  getDockerEnvFile,
  parseCpuPercToMillicores,
  parseMemUsageToMiB,
  type DockerStatsJson,
} from './docker-config';
import type { ContainerResourceUsage } from './k8s-scaler';
import { getChainPlugin } from '@/chains';
import fs from 'fs/promises';

// ============================================================
// Metrics
// ============================================================

/**
 * Get container CPU/memory metrics via docker stats.
 * Returns normalized ContainerResourceUsage (millicores + MiB).
 */
export async function getDockerContainerMetrics(
  service: string
): Promise<ContainerResourceUsage | null> {
  try {
    const containerName = await resolveContainerName(service);
    const output = await runDockerCommand(
      ['stats', containerName, '--no-stream', '--format', '{{json .}}'],
      { timeout: 10000 }
    );

    const stats: DockerStatsJson = JSON.parse(output.trim());
    const cpuMillicores = parseCpuPercToMillicores(stats.CPUPerc);
    const memoryMiB = parseMemUsageToMiB(stats.MemUsage);

    if (isNaN(cpuMillicores) || isNaN(memoryMiB)) return null;
    return { cpuMillicores, memoryMiB };
  } catch {
    return null;
  }
}

/**
 * Get metrics for all L2 component containers.
 * Returns Map keyed by component name (e.g. "op-geth").
 */
export async function getAllDockerContainerMetrics(): Promise<Map<string, ContainerResourceUsage> | null> {
  const plugin = getChainPlugin();
  const result = new Map<string, ContainerResourceUsage>();

  const entries = await Promise.allSettled(
    plugin.k8sComponents.map(async (comp) => {
      const service = comp.dockerServiceName || comp.component;
      const metrics = await getDockerContainerMetrics(service);
      return { component: comp.component, metrics };
    })
  );

  for (const entry of entries) {
    if (entry.status === 'fulfilled' && entry.value.metrics) {
      result.set(entry.value.component, entry.value.metrics);
    }
  }

  return result.size > 0 ? result : null;
}

// ============================================================
// Status & Discovery
// ============================================================

/**
 * Get component details for the metrics API response.
 * Docker equivalent of getComponentDetails() in metrics/route.ts.
 */
export async function getDockerComponentDetails(
  service: string,
  displayName: string,
  icon: string,
  strategy: string = 'Static'
): Promise<{
  name: string;
  type: string;
  strategy: string;
  current: string;
  status: string;
  icon: string;
  rawCpu: number;
  nodeName?: string;
  metrics?: { cpuReq: string; memReq: string; node: string };
  usage?: { cpuPercent: number; memoryMiB: number };
} | null> {
  try {
    const containerName = await resolveContainerName(service);
    const output = await runDockerCommand(
      ['inspect', containerName, '--format', 'json'],
      { timeout: 10000 }
    );

    const inspectData = JSON.parse(output.trim());
    const container = Array.isArray(inspectData) ? inspectData[0] : inspectData;

    const nanoCpus = container.HostConfig?.NanoCpus ?? 0;
    const memoryBytes = container.HostConfig?.Memory ?? 0;

    const rawCpu = nanoCpus > 0 ? nanoCpus / 1e9 : 0;
    const cpuDisp = rawCpu > 0 ? `${rawCpu.toFixed(1)} vCPU` : 'No limit';
    const memMiB = memoryBytes > 0 ? memoryBytes / (1024 * 1024) : 0;
    const memDisp = memMiB > 0
      ? (memMiB >= 1024 ? `${(memMiB / 1024).toFixed(0)}Gi` : `${memMiB.toFixed(0)}Mi`)
      : 'No limit';

    const isRunning = container.State?.Running === true;
    const statusDisp = isRunning ? 'Running' : (container.State?.Status || 'Stopped');

    return {
      name: displayName,
      type: 'Container',
      strategy,
      current: `Docker (${cpuDisp} / ${memDisp})`,
      status: statusDisp,
      icon,
      rawCpu,
      nodeName: 'docker-host',
      metrics: {
        cpuReq: cpuDisp,
        memReq: memDisp,
        node: 'docker-host',
      },
    };
  } catch (error) {
    if (process.env.DEBUG_K8S === 'true') {
      console.error(`[Docker] Failed to inspect ${service}:`, error);
    }
    return {
      name: displayName,
      type: 'Unknown',
      strategy,
      current: 'Error Fetching',
      status: 'Error',
      icon,
      rawCpu: 0,
    };
  }
}

/**
 * Get current CPU allocation in cores via docker inspect.
 */
export async function getDockerCurrentCpuCores(service: string): Promise<number> {
  try {
    const containerName = await resolveContainerName(service);
    const output = await runDockerCommand(
      ['inspect', containerName, '--format', '{{.HostConfig.NanoCpus}}'],
      { timeout: 5000 }
    );

    const nanoCpus = parseInt(output.trim(), 10);
    if (isNaN(nanoCpus) || nanoCpus <= 0) return 1; // Default 1 core if no limit
    return nanoCpus / 1e9;
  } catch {
    return 1;
  }
}

// ============================================================
// Scaling
// ============================================================

/**
 * Scale container CPU/memory via docker update.
 */
export async function scaleDockerContainer(
  service: string,
  cpuCores: number,
  memoryGiB: number
): Promise<void> {
  const containerName = await resolveContainerName(service);
  const memoryBytes = Math.round(memoryGiB * 1024 * 1024 * 1024);

  await runDockerCommand(
    ['update', `--cpus=${cpuCores}`, `--memory=${memoryBytes}`, containerName],
    { timeout: 15000 }
  );
}

// ============================================================
// Logs
// ============================================================

/**
 * Get container logs via docker compose logs.
 */
export async function getDockerContainerLogs(
  service: string,
  tailLines: number = 50
): Promise<string> {
  try {
    const output = await runComposeCommand(
      ['logs', service, '--tail', String(tailLines), '--no-log-prefix'],
      { timeout: 10000 }
    );
    return output || 'INFO [System] Log stream is empty.';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('command not found')) {
      return "ERROR [System] 'docker compose' command not found on server.";
    }
    return `ERROR [System] Failed to fetch Docker logs: ${message}`;
  }
}

// ============================================================
// Lifecycle Operations
// ============================================================

/**
 * Restart a service via docker compose restart.
 */
export async function restartDockerContainer(service: string): Promise<void> {
  await runComposeCommand(['restart', service], { timeout: 90000 });
}

/**
 * Execute a command inside a container via docker exec.
 */
export async function execInDocker(
  service: string,
  command: string
): Promise<string> {
  const containerName = await resolveContainerName(service);
  const output = await runDockerCommand(
    ['exec', containerName, 'sh', '-c', command],
    { timeout: 15000 }
  );
  return output;
}

/**
 * Get full container inspection output.
 */
export async function inspectDockerContainer(service: string): Promise<string> {
  const containerName = await resolveContainerName(service);
  const output = await runDockerCommand(
    ['inspect', containerName],
    { timeout: 10000 }
  );
  return output.substring(0, 2000); // Truncate for UI display
}

// ============================================================
// Environment Update
// ============================================================

/**
 * Update .env file and recreate the service.
 * Reads the env file, updates/adds key=value pairs, writes atomically,
 * then runs docker compose up -d to apply.
 */
export async function setDockerEnvAndRecreate(
  service: string,
  envMap: Record<string, string>
): Promise<void> {
  const envPath = getDockerEnvFile();

  // 1. Read existing .env (create if not exists)
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist, start fresh
  }

  // 2. Parse and update
  const lines = content.split('\n');
  const updatedKeys = new Set<string>();

  const newLines = lines.map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match && envMap[match[1]] !== undefined) {
      updatedKeys.add(match[1]);
      return `${match[1]}=${envMap[match[1]]}`;
    }
    return line;
  });

  // Append new keys not found in existing file
  for (const [key, value] of Object.entries(envMap)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  // 3. Atomic write (temp file + rename)
  const tempPath = `${envPath}.tmp.${Date.now()}`;
  await fs.writeFile(tempPath, newLines.join('\n'));
  await fs.rename(tempPath, envPath);

  // 4. Recreate service
  await runComposeCommand(['up', '-d', service], { timeout: 60000 });
}
