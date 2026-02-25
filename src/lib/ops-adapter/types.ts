export type OpsRole = 'viewer' | 'operator' | 'admin';

export interface OpsAuthContext {
  role: OpsRole;
  tokenId?: string;
}

export type OpsJobType = 'execute' | 'rollback' | 'verify';
export type OpsJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface OpsJobRecord {
  jobId: string;
  type: OpsJobType;
  status: OpsJobStatus;
  progress: number;
  summary?: string;
  logs: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  // linkage
  planId?: string;
  operationId?: string;
  requestId?: string;
  dryRun?: boolean;
  // result payload (optional; returned via /v1/ops/jobs/{jobId})
  result?: unknown;
  error?: { message: string };
}

export interface OpsPlanRecord {
  requestId: string;
  planId: string;
  createdAt: string;
  dryRun: boolean;
  confirmToken: string;
  // payload for translating to autonomous intent
  intent?: string;
  action?: string;
  target?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}
