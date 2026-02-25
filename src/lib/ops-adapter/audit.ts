import { mkdir, appendFile } from 'fs/promises';
import path from 'path';
import type { OpsAuthContext } from '@/lib/ops-adapter/types';

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
  const file = auditPath();
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify(entry);
  await appendFile(file, line + '\n', { encoding: 'utf-8' });
}
