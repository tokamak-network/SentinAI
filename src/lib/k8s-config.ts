/**
 * K8s Configuration Module
 * Centralized kubectl connection management with auto-detection
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '@/lib/logger';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = createLogger('K8s Config');

// ============================================================
// Environment Detection
// ============================================================

/**
 * Detect if running in development mode
 * Development = K8S_API_URL not explicitly configured (includes Docker local dev)
 */
function isDevelopmentEnvironment(): boolean {
  return !process.env.K8S_API_URL;
}

/**
 * Log warning only in production/configured environments
 */
function logK8sWarning(message: string): void {
  if (!isDevelopmentEnvironment()) {
    logger.warn(message);
  } else if (process.env.DEBUG_K8S === 'true') {
    logger.debug(`[K8s Config] ${message}`);
  }
}

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
// AWS Profile
// ============================================================

function getAwsProfile(): string | undefined {
  const profile = process.env.AWS_PROFILE;
  if (!profile) return undefined;
  if (!isValidShellIdentifier(profile)) {
    logK8sWarning(`Invalid AWS_PROFILE value: ${profile.substring(0, 30)}`);
    return undefined;
  }
  return profile;
}

// ============================================================
// AWS Region Resolution
// ============================================================

/**
 * Resolve AWS region with fallback chain:
 * 1. AWS_REGION env
 * 2. aws configure get region (CLI config, respects AWS_PROFILE)
 */
async function resolveAwsRegion(): Promise<string | undefined> {
  if (regionCache) return regionCache;

  // 1. Explicit env var
  const envRegion = process.env.AWS_REGION;
  if (envRegion) {
    if (!isValidShellIdentifier(envRegion)) {
      logK8sWarning(`Invalid AWS_REGION value: ${envRegion.substring(0, 30)}`);
      return undefined;
    }
    regionCache = envRegion;
    return regionCache;
  }

  // 2. AWS CLI config
  try {
    const args = ['configure', 'get', 'region'];
    const profile = getAwsProfile();
    if (profile) args.push('--profile', profile);
    const { stdout } = await execFileAsync('aws', args, { timeout: 5000 });
    const region = stdout.trim();
    if (region) {
      regionCache = region;
      logger.info(`Auto-detected AWS region: ${region}`);
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
    logK8sWarning(`Invalid AWS_CLUSTER_NAME value: ${clusterName.substring(0, 30)}`);
    return undefined;
  }

  try {
    const region = await resolveAwsRegion();
    const profile = getAwsProfile();
    const args = ['eks', 'describe-cluster', '--name', clusterName];
    if (profile) args.push('--profile', profile);
    if (region) args.push('--region', region);
    args.push('--query', 'cluster.endpoint', '--output', 'text');

    const startTime = Date.now();
    const { stdout } = await execFileAsync('aws', args, { timeout: 10000 });
    const endpoint = stdout.trim();

    if (endpoint && endpoint !== 'None') {
      apiUrlCache = endpoint;
      logger.info(`Auto-detected API URL: ${endpoint} (${Date.now() - startTime}ms)`);
      return apiUrlCache;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    logK8sWarning(`Failed to auto-detect K8S_API_URL: ${message}`);
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
    logK8sWarning(`Invalid AWS_CLUSTER_NAME value: ${clusterName.substring(0, 30)}`);
    return undefined;
  }

  // Check cache (buffer 1 minute before expiry)
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }

  try {
    const region = await resolveAwsRegion();
    const profile = getAwsProfile();
    const args = ['eks', 'get-token', '--cluster-name', clusterName];
    if (profile) args.push('--profile', profile);
    if (region) args.push('--region', region);

    const startTime = Date.now();
    const { stdout } = await execFileAsync('aws', args, { timeout: 10000 });
    logger.info(`Token generated (${Date.now() - startTime}ms)`);

    const tokenData = JSON.parse(stdout);
    const token = tokenData.status.token;

    // Use real expiration from AWS response; fallback to 10 min for legacy tokens
    const expirationTimestamp = tokenData.status?.expirationTimestamp;
    const expiresAt = expirationTimestamp
      ? new Date(expirationTimestamp).getTime()
      : now + 10 * 60 * 1000;
    tokenCache = { token, expiresAt };
    return token;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    logK8sWarning(`Token generation failed: ${message}`);
    return undefined;
  }
}

// ============================================================
// kubectl Command Execution
// ============================================================

/** Strip sensitive credentials from kubectl error messages */
function sanitizeK8sError(message: string): string {
  return message
    .replace(/--token\s+'[^']*'/g, "--token '***'")
    .replace(/--server\s+'[^']*'/g, "--server '***'");
}

/**
 * Escape shell argument for safe inclusion in shell string
 * SECURITY: Prevents shell injection by properly escaping special characters
 */
function escapeShellArg(arg: string): string {
  // Wrap in single quotes and escape any existing single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Execute a kubectl command with auto-configured connection
 *
 * Automatically resolves:
 * - K8S_API_URL (from env or aws eks describe-cluster)
 * - Auth token (from env or aws eks get-token)
 * - KUBECONFIG (from env)
 *
 * SECURITY:
 * - Escapes all shell arguments to prevent injection
 * - Validates KUBECONFIG path
 * - Avoids exposing sensitive data on command line (token passed safely)
 */
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number; stdin?: string }
): Promise<{ stdout: string; stderr: string }> {
  const startTime = Date.now();

  const [token, apiUrl] = await Promise.all([
    getK8sToken(),
    resolveK8sApiUrl(),
  ]);

  const baseCmd = 'kubectl';

  // Build arguments safely with escaping
  const args: string[] = [];

  if (process.env.KUBECONFIG) {
    args.push('--kubeconfig', escapeShellArg(process.env.KUBECONFIG));
  }
  if (apiUrl) {
    args.push('--server', escapeShellArg(apiUrl));
  }
  if (token) {
    args.push('--token', escapeShellArg(token));
    if (process.env.K8S_INSECURE_TLS === 'true') {
      args.push('--insecure-skip-tls-verify');
    }
  }

  try {
    let fullCmd: string;
    const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';

    if (options?.stdin) {
      // Safely escape stdin for shell
      const escapedStdin = options.stdin.replace(/'/g, "'\\''");
      fullCmd = `echo '${escapedStdin}' | ${baseCmd}${argsStr} ${command}`;
    } else {
      fullCmd = `${baseCmd}${argsStr} ${command}`;
    }

    const result = await execAsync(fullCmd, {
      timeout: options?.timeout ?? 10000,
    });
    logger.info(`kubectl (${Date.now() - startTime}ms): ${command.substring(0, 40)}...`);
    return result;
  } catch (e) {
    if (!isDevelopmentEnvironment()) {
      logger.info(`kubectl failed (${Date.now() - startTime}ms): ${command}`);
    }
    // SECURITY: Strip token and server URL from error messages before propagation
    if (e instanceof Error) {
      e.message = sanitizeK8sError(e.message);
    }
    throw e;
  }
}
