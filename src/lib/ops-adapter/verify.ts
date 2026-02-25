import { execFile } from 'child_process';
import { promisify } from 'util';
import { getNamespace, getAppPrefix, runK8sCommand } from '@/lib/k8s-config';

const execFileAsync = promisify(execFile);

export type OpsVerifyCheck = {
  name: string;
  result: 'pass' | 'fail' | 'warn';
  detail?: string;
};

export type OpsVerifyResult = {
  requestId: string;
  planId: string;
  verified: boolean;
  checks: OpsVerifyCheck[];
  blockingIssues: string[];
};

function strictAwsVerify(): boolean {
  return process.env.SENTINAI_VERIFY_REQUIRE_AWS === 'true';
}

async function awsCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync('aws', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function checkK8sNamespaceAccess(ns: string): Promise<OpsVerifyCheck> {
  try {
    const { stdout } = await runK8sCommand(`auth can-i get pods -n ${ns}`, { timeout: 8000 });
    const ok = stdout.trim().toLowerCase() === 'yes';
    return {
      name: 'k8s_namespace_access',
      result: ok ? 'pass' : 'fail',
      detail: `kubectl auth can-i get pods -n ${ns} => ${stdout.trim()}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { name: 'k8s_namespace_access', result: 'fail', detail: `kubectl failed: ${message}` };
  }
}

async function checkK8sDeploymentsReady(ns: string): Promise<OpsVerifyCheck> {
  try {
    const { stdout } = await runK8sCommand(`get deploy -n ${ns} -o json`, { timeout: 12000 });
    const data = JSON.parse(stdout);
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
      return { name: 'k8s_deployments_ready', result: 'warn', detail: `No deployments found in namespace=${ns}` };
    }

    const bad = items
      .map((d) => {
        const name = d?.metadata?.name;
        const desired = Number(d?.spec?.replicas ?? 0);
        const available = Number(d?.status?.availableReplicas ?? 0);
        const unavailable = Number(d?.status?.unavailableReplicas ?? 0);
        return { name, desired, available, unavailable };
      })
      .filter((d) => d.name && (d.unavailable > 0 || d.available < d.desired));

    if (bad.length > 0) {
      return {
        name: 'k8s_deployments_ready',
        result: 'fail',
        detail: `Unready deployments: ${bad.map((b) => `${b.name}(desired=${b.desired},available=${b.available},unavailable=${b.unavailable})`).join(', ')}`,
      };
    }

    return {
      name: 'k8s_deployments_ready',
      result: 'pass',
      detail: `All deployments ready (count=${items.length}) ns=${ns}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { name: 'k8s_deployments_ready', result: 'warn', detail: `kubectl get deploy failed: ${message}` };
  }
}

async function checkK8sPodsRunning(ns: string, appPrefix: string): Promise<OpsVerifyCheck> {
  // Best-effort heuristic using the configured app prefix.
  const selector = `app=${appPrefix}`;
  try {
    const { stdout } = await runK8sCommand(`get pods -n ${ns} -l ${selector} -o json`, { timeout: 12000 });
    const data = JSON.parse(stdout);
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
      return { name: 'k8s_pods_running', result: 'warn', detail: `No pods found with selector ${selector} in ns=${ns}` };
    }
    const bad = items
      .map((p) => ({ name: p?.metadata?.name, phase: p?.status?.phase }))
      .filter((p) => p.name && p.phase !== 'Running');

    if (bad.length > 0) {
      return {
        name: 'k8s_pods_running',
        result: 'fail',
        detail: `Non-running pods: ${bad.map((b) => `${b.name}(${b.phase})`).join(', ')}`,
      };
    }

    return { name: 'k8s_pods_running', result: 'pass', detail: `All pods Running (count=${items.length}) selector=${selector} ns=${ns}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { name: 'k8s_pods_running', result: 'warn', detail: `kubectl get pods failed: ${message}` };
  }
}

async function checkAwsCloudWatchAccess(): Promise<OpsVerifyCheck> {
  const available = await awsCliAvailable();
  if (!available) {
    return { name: 'aws_cloudwatch_metrics_access', result: strictAwsVerify() ? 'fail' : 'warn', detail: 'aws CLI not available' };
  }

  const args = ['cloudwatch', 'list-metrics', '--namespace', 'AWS/ContainerInsights', '--max-items', '1'];
  const region = process.env.AWS_REGION;
  if (region) args.push('--region', region);
  const profile = process.env.AWS_PROFILE;
  if (profile) args.push('--profile', profile);

  try {
    const { stdout } = await execFileAsync('aws', args, { timeout: 12000 });
    const ok = stdout.trim().length > 0;
    return {
      name: 'aws_cloudwatch_metrics_access',
      result: ok ? 'pass' : strictAwsVerify() ? 'fail' : 'warn',
      detail: ok ? 'CloudWatch list-metrics succeeded' : 'CloudWatch list-metrics returned empty output',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return {
      name: 'aws_cloudwatch_metrics_access',
      result: strictAwsVerify() ? 'fail' : 'warn',
      detail: `aws cloudwatch list-metrics failed: ${message}`,
    };
  }
}

export async function runOpsVerify(input: {
  planId: string;
  requestId: string;
  dryRun: boolean;
}): Promise<OpsVerifyResult> {
  const ns = getNamespace();
  const prefix = getAppPrefix();

  const checks: OpsVerifyCheck[] = [];

  checks.push({ name: 'plan_received', result: 'pass', detail: `planId=${input.planId}` });
  checks.push({ name: 'dry_run', result: input.dryRun ? 'pass' : 'warn', detail: `dryRun=${input.dryRun}` });

  checks.push(await checkK8sNamespaceAccess(ns));
  checks.push(await checkK8sDeploymentsReady(ns));
  checks.push(await checkK8sPodsRunning(ns, prefix));

  checks.push(await checkAwsCloudWatchAccess());

  const blocking = checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.detail || 'failed'}`);
  const verified = blocking.length === 0;

  return {
    requestId: input.requestId,
    planId: input.planId,
    verified,
    checks,
    blockingIssues: blocking,
  };
}
