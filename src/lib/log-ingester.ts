// Mock Data Generator for Phase 1 & 2
// L2 Components with configurable K8s labels via K8S_APP_PREFIX env var
function getL2Components() {
    const appPrefix = process.env.K8S_APP_PREFIX || 'op';
    return [
        { name: 'op-geth', label: `app=${appPrefix}-geth` },
        { name: 'op-node', label: `app=${appPrefix}-node` },
        { name: 'op-batcher', label: `app=${appPrefix}-batcher` },
        { name: 'op-proposer', label: `app=${appPrefix}-proposer` },
    ];
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

// Fetch logs from ALL components
export async function getAllLiveLogs(namespace?: string): Promise<Record<string, string>> {
    const ns = namespace || process.env.K8S_NAMESPACE || 'default';
    const results: Record<string, string> = {};
    const components = getL2Components();
    // Run in parallel
    await Promise.all(components.map(async (comp) => {
        results[comp.name] = await getLiveLogs(ns, comp.label);
    }));
    return results;
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Real K8s Logic using kubectl (Phase 3)
export async function getLiveLogs(namespace?: string, labelSelector?: string): Promise<string> {
    const ns = namespace || process.env.K8S_NAMESPACE || 'default';
    const appPrefix = process.env.K8S_APP_PREFIX || 'op';
    const label = labelSelector || `app=${appPrefix}-geth`;
    try {
        let token = process.env.K8S_TOKEN;

        // AWS EKS Dynamic Token Generation (Option 3 - Priority)
        // Always attempt to generate a fresh token if Cluster Name is provided, 
        // to avoid using stale tokens from env.
        if (process.env.AWS_CLUSTER_NAME) {
            try {
                const clusterName = process.env.AWS_CLUSTER_NAME;
                // console.log(`[LogIngester] Generating EKS token for cluster: ${clusterName}`);
                const { stdout } = await execAsync(`aws eks get-token --cluster-name ${clusterName}`);
                const tokenData = JSON.parse(stdout);
                token = tokenData.status.token;
            } catch (e) {
                const message = e instanceof Error ? e.message : 'Unknown error';
                console.warn(`[LogIngester] AWS Token Generation Warning: ${message}`);
                // Fallback to static token if generation fails
            }
        }

        // Construct base kubectl command with env overrides
        let baseCmd = 'kubectl';

        if (process.env.KUBECONFIG) {
            baseCmd += ` --kubeconfig="${process.env.KUBECONFIG}"`;
        }
        if (process.env.K8S_API_URL) {
            baseCmd += ` --server="${process.env.K8S_API_URL}"`;
        }
        if (token) {
            baseCmd += ` --token="${token}" --insecure-skip-tls-verify`;
        }

        // 1. Find Pod Name
        const findPodCmd = `${baseCmd} get pods -n ${ns} -l ${label} -o jsonpath="{.items[0].metadata.name}"`;
        console.log(`[LogIngester] Finding pod: ${findPodCmd.replace(/--token="[^"]+"/, '--token="***"')}`);

        const { stdout: podName, stderr: findErr } = await execAsync(findPodCmd);

        if (!podName || podName.trim() === '') {
            console.warn(`[LogIngester] No pods found for ${label}`);
            return `WARN [System] No active pods found matching '${label}' in namespace '${ns}'.
            Verify your K8s context and pod labels.`;
        }

        const cleanPodName = podName.trim();
        console.log(`[LogIngester] Tailing logs from: ${cleanPodName}`);

        // 2. Fetch Logs (Tail)
        const logsCmd = `${baseCmd} logs ${cleanPodName} -n ${ns} --tail=50`;
        const { stdout: logs, stderr: logsErr } = await execAsync(logsCmd);

        if (logsErr && !logs) {
            // kubectl logs might imply stderr info, but usually checking logs is enough
            throw new Error(logsErr);
        }

        return logs || "INFO [System] Log stream is empty.";

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error("[LogIngester] kubectl Error:", errorMessage);
        // Fallback or Error Message
        // If it's a "command not found" mock it for the user if they don't have kubectl
        if (errorMessage.includes('command not found')) {
            return `ERROR [System] 'kubectl' command not found on server.
            Please ensure kubectl is installed and in the PATH.`;
        }

        return `ERROR [System] Failed to fetch K8s logs:
        ${errorMessage}`;
    }
}
