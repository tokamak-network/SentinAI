/**
 * Alert Status — aggregate active alerts from anomaly pipeline
 */

import { getStore } from '@/lib/redis-store';

export interface AlertStatusSnapshot {
  activeAlerts: number;
  severity: { critical: number; warning: number; info: number };
  lastTriggered: string | null;
  generatedAt: string;
}

export async function composeAlertStatusSnapshot(): Promise<AlertStatusSnapshot> {
  const store = getStore();
  const { events: anomalies } = await store.getAnomalyEvents();

  const active = anomalies.filter(a => a.status === 'active' || !a.resolvedAt);
  const severity = { critical: 0, warning: 0, info: 0 };

  for (const a of active) {
    // AISeverity: 'low' | 'medium' | 'high' | 'critical'
    const sev = a.deepAnalysis?.severity;
    if (sev === 'critical') severity.critical++;
    else if (sev === 'high' || sev === 'medium') severity.warning++;
    else severity.info++;
  }

  const sorted = [...anomalies].sort((a, b) => b.timestamp - a.timestamp);

  return {
    activeAlerts: active.length,
    severity,
    lastTriggered: sorted[0] ? new Date(sorted[0].timestamp).toISOString() : null,
    generatedAt: new Date().toISOString(),
  };
}
