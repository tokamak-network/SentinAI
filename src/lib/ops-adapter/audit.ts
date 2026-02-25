import { mkdir, appendFile } from 'fs/promises';
import path from 'path';
import type { OpsAuthContext } from '@/lib/ops-adapter/types';
import logger from '@/lib/logger';

function auditPath(): string {
  const dir = process.env.SENTINAI_AUDIT_DIR?.trim() || path.join(process.cwd(), 'data', 'audit');
  return path.join(dir, 'ops-audit.log');
}

export async function writeAuditLog(entry: {
  at: string;
  actor: OpsAuthContext;
  action: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const file = auditPath();
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(entry);
    await appendFile(file, line + '\n', { encoding: 'utf-8' });
  } catch (error) {
    // Graceful degradation: log to console if filesystem write fails
    // This ensures audit failures don't break critical operations
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[audit] Failed to write audit log:', message);
  }
}
