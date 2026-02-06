/**
 * K8s Configuration Module
 * Centralized kubectl connection management with auto-detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================
// Input Validation
// ============================================================

/**
 * Validate that a value is safe for shell interpolation.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function isValidShellIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

// ============================================================
// Cache State
// ============================================================

let tokenCache: { token: string; expiresAt: number } | null = null;
let apiUrlCache: string | null = null;
let regionCache: string | null = null;

/**
 * Clear all cached values (useful for testing or config reload)
 */
export function clearK8sConfigCache(): void {
  tokenCache = null;
  apiUrlCache = null;
  regionCache = null;
}

// ============================================================
// Helpers (exported)
// ============================================================

export function getNamespace(): string {
  return process.env.K8S_NAMESPACE || 'default';
}

export function getAppPrefix(): string {
  return process.env.K8S_APP_PREFIX || 'op';
}

// ============================================================
// AWS Region Resolution
// ============================================================

/**
 * Resolve AWS region with fallback chain:
 * 1. AWS_REGION env
 * 2. AWS_DEFAULT_REGION env
 * 3. aws configure get region (CLI config)
 */
async function resolveAwsRegion(): Promise<string | undefined> {
  if (regionCache) return regionCache;

  // 1. Explicit env vars
  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (envRegion) {
    if (!isValidShellIdentifier(envRegion)) {
      console.warn(`[K8s Config] Invalid AWS_REGION value: ${envRegion.substring(0, 30)}`);
      return undefined;
    }
    regionCache = envRegion;
    return regionCache;
  }

  // 2. AWS CLI config
  try {
    const { stdout } = await execAsync('aws configure get region', { timeout: 5000 });
    const region = stdout.trim();
    if (region) {
      regionCache = region;
      console.log(`[K8s Config] Auto-detected AWS region: ${region}`);
      return regionCache;
    }
  } catch {
    // aws cli not configured or not installed
  }

  return undefined;
}

// ============================================================
// K8S API URL Resolution
// ============================================================

/**
 * Resolve K8s API server URL with fallback chain:
 * 1. K8S_API_URL env (explicit override)
 * 2. aws eks describe-cluster (auto-detect from cluster name)
 */
async function resolveK8sApiUrl(): Promise<string | undefined> {
  // 1. Explicit env var always wins
  if (process.env.K8S_API_URL) {
    return process.env.K8S_API_URL;
  }

  // 2. Auto-detect from cluster name (cached)
  if (apiUrlCache) return apiUrlCache;

  const clusterName = process.env.AWS_CLUSTER_NAME;
  if (!clusterName) return undefined;

  if (!isValidShellIdentifier(clusterName)) {
    console.warn(`[K8s Config] Invalid AWS_CLUSTER_NAME value: ${clusterName.substring(0, 30)}`);
    return undefined;
  }

  try {
    const region = await resolveAwsRegion();
    const regionFlag = region ? ` --region ${region}` : '';
    const cmd = `aws eks describe-cluster --name ${clusterName}${regionFlag} --query "cluster.endpoint" --output text`;

    const startTime = Date.now();
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    const endpoint = stdout.trim();

    if (endpoint && endpoint !== 'None') {
      apiUrlCache = endpoint;
      console.log(`[K8s Config] Auto-detected API URL: ${endpoint} (${Date.now() - startTime}ms)`);
      return apiUrlCache;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.warn(`[K8s Config] Failed to auto-detect K8S_API_URL: ${message}`);
  }

  return undefined;
}

// ============================================================
// Token Management
// ============================================================

/**
 * Get K8s authentication token with fallback chain:
 * 1. K8S_TOKEN env (static token)
 * 2. aws eks get-token (dynamic, cached 10 min)
 */
async function getK8sToken(): Promise<string | undefined> {
  // 1. Static token
  if (process.env.K8S_TOKEN) return process.env.K8S_TOKEN;

  // 2. Dynamic AWS EKS token
  const clusterName = process.env.AWS_CLUSTER_NAME;
  if (!clusterName) return undefined;

  if (!isValidShellIdentifier(clusterName)) {
    console.warn(`[K8s Config] Invalid AWS_CLUSTER_NAME value: ${clusterName.substring(0, 30)}`);
    return undefined;
  }

  // Check cache (buffer 1 minute before expiry)
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }

  try {
    const region = await resolveAwsRegion();
    const regionFlag = region ? ` --region ${region}` : '';
    const cmd = `aws eks get-token --cluster-name ${clusterName}${regionFlag}`;

    const startTime = Date.now();
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    console.log(`[K8s Config] Token generated (${Date.now() - startTime}ms)`);

    const tokenData = JSON.parse(stdout);
    const token = tokenData.status.token;

    // Cache for 10 minutes (AWS tokens last 15 min)
    tokenCache = { token, expiresAt: now + 10 * 60 * 1000 };
    return token;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.warn(`[K8s Config] Token generation failed: ${message}`);
    return undefined;
  }
}

// ============================================================
// kubectl Command Execution
// ============================================================

/**
 * Execute a kubectl command with auto-configured connection
 *
 * Automatically resolves:
 * - K8S_API_URL (from env or aws eks describe-cluster)
 * - Auth token (from env or aws eks get-token)
 * - KUBECONFIG (from env)
 */
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const startTime = Date.now();

  const [token, apiUrl] = await Promise.all([
    getK8sToken(),
    resolveK8sApiUrl(),
  ]);

  let baseCmd = 'kubectl';

  if (process.env.KUBECONFIG) {
    baseCmd += ` --kubeconfig="${process.env.KUBECONFIG}"`;
  }
  if (apiUrl) {
    baseCmd += ` --server="${apiUrl}"`;
  }
  if (token) {
    baseCmd += ` --token="${token}"`;
    if (process.env.K8S_INSECURE_TLS === 'true') {
      baseCmd += ' --insecure-skip-tls-verify';
    }
  }

  try {
    const result = await execAsync(`${baseCmd} ${command}`, {
      timeout: options?.timeout ?? 10000,
    });
    console.log(`[K8s Config] kubectl (${Date.now() - startTime}ms): ${command.substring(0, 40)}...`);
    return result;
  } catch (e) {
    console.log(`[K8s Config] kubectl failed (${Date.now() - startTime}ms): ${command}`);
    throw e;
  }
}
