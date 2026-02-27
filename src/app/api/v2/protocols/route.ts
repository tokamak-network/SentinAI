/**
 * v2 Protocols Endpoint
 * GET → List all registered ProtocolDescriptors
 *
 * Returns: protocolId, displayName, capabilities, collectorType
 */

import { NextResponse } from 'next/server';
import { listProtocols } from '@/core/protocol-registry';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

export async function GET(): Promise<NextResponse> {
  try {
    const descriptors = listProtocols();

    const protocols = descriptors.map((d) => ({
      protocolId: d.protocolId,
      displayName: d.displayName,
      version: d.version,
      capabilities: d.capabilities,
      collectorType: d.collectorType,
    }));

    return NextResponse.json({
      data: protocols,
      meta: { ...meta(), total: protocols.length },
    });
  } catch (error) {
    logger.error('[v2 GET /protocols] error:', error);
    return NextResponse.json(
      { error: '프로토콜 목록 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
