import { runHealthDiagnostics } from '@/lib/component-operator';
import type { HealthDiagnosticsSnapshot } from '@/types/agent-marketplace';

export async function composeHealthDiagnosticsSnapshot(): Promise<HealthDiagnosticsSnapshot> {
  return runHealthDiagnostics();
}
