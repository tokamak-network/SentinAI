import { NextResponse } from 'next/server';
import { computeExperienceStats } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import { calculateTier } from '@/lib/agent-resume';
import { getStore } from '@/lib/redis-store';
import { createLogger } from '@/lib/logger';

const logger = createLogger('API:experience');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20), 100);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const category = url.searchParams.get('category') || undefined;
    const instanceId = url.searchParams.get('instanceId') || undefined;

    // Single store fetch — derive stats, entries, and patterns from this
    const allEntries = await getStore().getExperience(5000);
    const stats = computeExperienceStats(allEntries);

    // Slice for display entries
    let displayEntries = instanceId
      ? allEntries.filter(e => e.instanceId === instanceId)
      : allEntries;

    if (category) {
      displayEntries = displayEntries.filter(e => e.category === category);
    }

    displayEntries = displayEntries.slice(offset, offset + limit);

    // Extract patterns from recent entries
    const { patterns } = extractPatterns(allEntries.slice(0, 500));

    return NextResponse.json({
      stats,
      entries: displayEntries.map(e => ({
        id: e.id,
        category: e.category,
        action: e.action,
        outcome: e.outcome,
        timestamp: e.timestamp,
      })),
      patterns: patterns.slice(0, 5).map(p => ({
        id: p.id,
        description: p.description,
        occurrences: p.occurrences,
        successRate: p.successRate,
        confidence: p.confidence,
      })),
      tier: calculateTier(stats.operatingDays),
      total: allEntries.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
