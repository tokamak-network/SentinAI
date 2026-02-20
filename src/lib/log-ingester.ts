import { getChainPlugin } from '@/chains';

// L2 Components dynamically loaded from chain plugin
function getL2Components() {
    const appPrefix = process.env.K8S_APP_PREFIX || 'op';
    const plugin = getChainPlugin();
    return plugin.k8sComponents.map(c => ({
        name: c.component,
        label: `app=${appPrefix}-${c.labelSuffix}`,
    }));
}

// Mock Data Generator for all components
export function generateMockLogs(mode: 'normal' | 'attack' = 'normal'): Record<string, string> {
    const timestamp = new Date().toISOString();
    const logs: Record<string, string> = {};

    // op-geth
    logs['op-geth'] = mode === 'normal'
        ? `INFO [${timestamp}] Imported new chain segment blocks=1 txs=25 mgas=3.21`
        : `WARN [${timestamp}] Peer dropped: too many requests (limit: 10/s, current: 500/s)\nERROR [${timestamp}] P2P Handler: inbound queue full`;

    // op-node
    logs['op-node'] = mode === 'normal'
        ? `INFO [${timestamp}] Derived attributes for block. L2 Head: 123456`
        : `WARN [${timestamp}] Derivation stalled: L1 origin unsafe. Reorg detected?`;

    // op-batcher
    logs['op-batcher'] = `INFO [${timestamp}] Batcher loop started. Waiting for next channel...`;

    // op-proposer
    logs['op-proposer'] = `INFO [${timestamp}] Proposer loop: Active. L2 Output submitted.`;

    return logs;
}

import { runK8sCommand, getNamespace, getAppPrefix } from '@/lib/k8s-config';
import { isDockerMode } from '@/lib/docker-config';
import { getDockerContainerLogs } from '@/lib/docker-orchestrator';

// Fetch logs from ALL components
export async function getAllLiveLogs(namespace?: string): Promise<Record<string, string>> {
    const ns = namespace || getNamespace();
    const results: Record<string, string> = {};
    const components = getL2Components();
    // Run in parallel
    await Promise.all(components.map(async (comp) => {
        results[comp.name] = await getLiveLogs(ns, comp.label);
    }));
    return results;
}

// Real K8s Logic using kubectl (or Docker fallback)
export async function getLiveLogs(namespace?: string, labelSelector?: string): Promise<string> {
    const label = labelSelector || `app=${getAppPrefix()}-geth`;

    // Docker mode: use docker compose logs instead of kubectl
    if (isDockerMode()) {
        const component = label.split('=')[1] || 'op-geth';
        return getDockerContainerLogs(component, 50);
    }

    const ns = namespace || getNamespace();
    try {
        // 1. Find Pod Name
        const { stdout: podName } = await runK8sCommand(
            `get pods -n ${ns} -l ${label} -o jsonpath="{.items[0].metadata.name}"`
        );

        if (!podName || podName.trim() === '') {
            console.warn(`[LogIngester] No pods found for ${label}`);
            return `WARN [System] No active pods found matching '${label}' in namespace '${ns}'.
            Verify your K8s context and pod labels.`;
        }

        const cleanPodName = podName.trim();
        console.info(`[LogIngester] Tailing logs from: ${cleanPodName}`);

        // 2. Fetch Logs (Tail)
        const { stdout: logs, stderr: logsErr } = await runK8sCommand(
            `logs ${cleanPodName} -n ${ns} --tail=50`
        );

        if (logsErr && !logs) {
            throw new Error(logsErr);
        }

        return logs || "INFO [System] Log stream is empty.";

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error("[LogIngester] kubectl Error:", errorMessage);

        if (errorMessage.includes('command not found')) {
            return `ERROR [System] 'kubectl' command not found on server.
            Please ensure kubectl is installed and in the PATH.`;
        }

        return `ERROR [System] Failed to fetch K8s logs:
        ${errorMessage}`;
    }
}
