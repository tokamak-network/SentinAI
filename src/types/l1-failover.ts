/**
 * L1 RPC Auto-Failover Types
 * Multi-endpoint management with automatic failover for L1 RPC connections.
 */

/** L1 RPC endpoint with health tracking */
export interface L1RpcEndpoint {
  url: string;
  healthy: boolean;
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
}

/** Failover event record */
export interface FailoverEvent {
  timestamp: string;
  fromUrl: string;
  toUrl: string;
  /** Unmasked full URLs for operator notifications */
  rawFromUrl?: string;
  rawToUrl?: string;
  reason: string;
  /** Whether K8s components were also updated */
  k8sUpdated: boolean;
  /** Components successfully updated */
  k8sComponents: string[];
  /** Whether this was simulated (no real kubectl) */
  simulated: boolean;
}

/** Proxyd backend health tracking */
export interface ProxydBackendHealth {
  name: string;
  rpcUrl: string;
  /** Consecutive failover-eligible failures (429, 5xx, timeout/network) */
  consecutiveFailures: number;
  healthy: boolean;
  replaced: boolean;
  replacedWith?: string;
  lastChecked?: number;
  /** Recent error patterns detected from Proxyd pod logs */
  logErrors?: ProxydLogError[];
}

/** Error signal parsed from Proxyd pod logs */
export interface ProxydLogError {
  timestamp: string;
  backendName: string;
  statusCode: number;
  message: string;
}

/** Backend replacement event */
export interface BackendReplacementEvent {
  timestamp: string;
  backendName: string;
  oldUrl: string;
  newUrl: string;
  reason: string;
  simulated: boolean;
}

/** L1 failover module state */
export interface L1FailoverState {
  activeUrl: string;
  activeIndex: number;
  endpoints: L1RpcEndpoint[];
  lastFailoverTime: number | null;
  /** Recent failover events (ring buffer) */
  events: FailoverEvent[];
  /** Proxyd backend health tracking */
  proxydHealth: ProxydBackendHealth[];
  /** Backend replacement events */
  backendReplacements: BackendReplacementEvent[];
  /** Spare RPC URLs for backend replacement */
  spareUrls: string[];
  /** In proxyd mode, the name of the active backend (e.g. "infura_theo1") */
  proxydActiveBackendName?: string;
}

/** Proxyd ConfigMap configuration */
export interface ProxydConfig {
  configMapName: string;
  dataKey: string;
  upstreamGroup: string;
  updateMode: 'replace' | 'append';
}

/** ConfigMap update result */
export interface ConfigMapUpdateResult {
  success: boolean;
  configMapName: string;
  previousUrl?: string;
  newUrl?: string;
  error?: string;
}

/** K8s component L1 RPC env var mapping - Extended with strategy support */
export interface L1ComponentConfig {
  type: 'statefulset' | 'proxyd';
  statefulSetName?: string;
  envVarName?: string;
  proxydConfig?: ProxydConfig;
}

/** Result of K8s L1 RPC update - Extended with ConfigMap result */
export interface K8sUpdateResult {
  updated: string[];
  errors: string[];
  configMapResult?: ConfigMapUpdateResult;
}

/** L2 nodes L1 RPC status */
export interface L2NodeL1RpcStatus {
  component: string;
  l1RpcUrl: string; // Masked URL
  healthy: boolean;
}
