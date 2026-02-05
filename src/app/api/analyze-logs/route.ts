
import { NextResponse } from 'next/server';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { generateMockLogs, getAllLiveLogs } from '@/lib/log-ingester';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'normal'; // 'normal', 'attack', 'live'

    let logData: Record<string, string>;

    if (mode === 'live') {
        // Phase 3: Try live logs for ALL components
        logData = await getAllLiveLogs();
    } else if (mode === 'attack') {
        // Phase 1/2: Simulating Attack
        logData = generateMockLogs('attack');
    } else {
        // Phase 1/2: Normal
        logData = generateMockLogs('normal');
    }

    // Call AI (Gemini)
    const analysis = await analyzeLogChunk(logData);

    return NextResponse.json({
        source: mode === 'live' ? 'k8s-multi-pod-stream' : 'simulated-multi-log',
        raw_logs_preview: JSON.stringify(logData).substring(0, 500) + "...",
        analysis
    });
}
