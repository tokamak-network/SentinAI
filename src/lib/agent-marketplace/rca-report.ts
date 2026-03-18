import { getRCAHistory, getRCAHistoryCount } from '@/lib/rca-engine';
import type { RCAReportSnapshot } from '@/types/agent-marketplace';

export async function composeRCAReportSnapshot(): Promise<RCAReportSnapshot> {
  const [entries, totalCount] = await Promise.all([getRCAHistory(10), getRCAHistoryCount()]);

  return {
    available: entries.length > 0,
    totalCount,
    reports: entries.map((entry) => ({
      id: entry.id,
      rootCause: {
        component: entry.result.rootCause.component,
        description: entry.result.rootCause.description,
        confidence: entry.result.rootCause.confidence,
      },
      affectedComponents: entry.result.affectedComponents,
      remediation: {
        immediate: entry.result.remediation.immediate,
        preventive: entry.result.remediation.preventive,
      },
      triggeredBy: entry.triggeredBy,
      triggeredAt: entry.triggeredAt,
    })),
    updatedAt: new Date().toISOString(),
  };
}
