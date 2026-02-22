/**
 * L1 RPC Operator
 * Manual L1 endpoint and proxyd backend operations.
 */

import {
  executeFailover,
  getActiveL1RpcUrl,
  maskUrl,
  replaceProxydBackendUrl,
  setActiveL1RpcUrl,
} from '@/lib/l1-rpc-failover';

export interface SwitchL1RpcInput {
  targetUrl?: string;
  reason?: string;
  dryRun?: boolean;
}

export interface SwitchL1RpcResult {
  success: boolean;
  fromUrl: string;
  fromUrlRaw: string;
  toUrl: string;
  toUrlRaw: string;
  message: string;
  k8sUpdated: boolean;
}

export async function switchL1RpcUrl(input: SwitchL1RpcInput): Promise<SwitchL1RpcResult> {
  const fromUrlRaw = getActiveL1RpcUrl();
  const fromUrl = maskUrl(fromUrlRaw);
  const reason = input.reason || 'manual L1 RPC switch';
  const dryRun = input.dryRun === true;

  if (dryRun) {
    const dryTarget = input.targetUrl?.trim() || '<next-healthy-endpoint>';
    return {
      success: true,
      fromUrl,
      fromUrlRaw,
      toUrl: dryTarget === '<next-healthy-endpoint>' ? dryTarget : maskUrl(dryTarget),
      toUrlRaw: dryTarget,
      message: `[DRY RUN] switch_l1_rpc ${fromUrl} -> ${dryTarget}`,
      k8sUpdated: false,
    };
  }

  const event = input.targetUrl
    ? await setActiveL1RpcUrl(input.targetUrl, reason)
    : await executeFailover(reason);

  if (!event) {
    return {
      success: false,
      fromUrl,
      fromUrlRaw,
      toUrl: fromUrl,
      toUrlRaw: fromUrlRaw,
      message: 'L1 RPC switch failed or no healthy candidate was found',
      k8sUpdated: false,
    };
  }

  const toUrlRaw = getActiveL1RpcUrl();
  return {
    success: true,
    fromUrl: event.fromUrl,
    fromUrlRaw,
    toUrl: event.toUrl,
    toUrlRaw,
    message: `L1 RPC switched: ${event.fromUrl} -> ${event.toUrl}`,
    k8sUpdated: event.k8sUpdated,
  };
}

export interface UpdateProxydBackendInput {
  backendName: string;
  newRpcUrl: string;
  reason?: string;
  dryRun?: boolean;
}

export interface UpdateProxydBackendResult {
  success: boolean;
  backendName: string;
  oldUrl: string;
  oldUrlRaw: string;
  newUrl: string;
  newUrlRaw: string;
  message: string;
}

export async function updateProxydBackendUrl(
  input: UpdateProxydBackendInput
): Promise<UpdateProxydBackendResult> {
  const backendName = input.backendName.trim();
  const newRpcUrl = input.newRpcUrl.trim();
  const dryRun = input.dryRun === true;
  const reason = input.reason || 'manual proxyd backend update';

  if (!backendName || !newRpcUrl) {
    return {
      success: false,
      backendName: backendName || input.backendName,
      oldUrl: 'n/a',
      oldUrlRaw: '',
      newUrl: 'n/a',
      newUrlRaw: '',
      message: 'backendName and newRpcUrl are required',
    };
  }

  if (dryRun) {
    return {
      success: true,
      backendName,
      oldUrl: '<current>',
      oldUrlRaw: '<current>',
      newUrl: maskUrl(newRpcUrl),
      newUrlRaw: newRpcUrl,
      message: `[DRY RUN] update_proxyd_backend ${backendName} -> ${maskUrl(newRpcUrl)}`,
    };
  }

  const result = await replaceProxydBackendUrl(backendName, newRpcUrl, reason);
  if (!result.success || !result.previousUrl || !result.newUrl) {
    return {
      success: false,
      backendName,
      oldUrl: 'n/a',
      oldUrlRaw: '',
      newUrl: maskUrl(newRpcUrl),
      newUrlRaw: newRpcUrl,
      message: result.error || 'proxyd backend update failed',
    };
  }

  return {
    success: true,
    backendName,
    oldUrl: maskUrl(result.previousUrl),
    oldUrlRaw: result.previousUrl,
    newUrl: maskUrl(result.newUrl),
    newUrlRaw: result.newUrl,
    message: `Proxyd backend updated: ${backendName} ${maskUrl(result.previousUrl)} -> ${maskUrl(result.newUrl)}`,
  };
}
