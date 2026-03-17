/**
 * Catalog API routes (GET, POST)
 * - GET: Retrieve all catalog agents with ops scores
 * - POST: Create a new catalog agent
 * - Requires: sentinai_admin_session cookie (validated in middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceStore } from '@/lib/marketplace-store';
import { calculateOpsScore } from '@/lib/ops-score-calculator';
import type { CatalogAgent } from '@/types/marketplace';
import logger from '@/lib/logger';

interface CreateCatalogAgentRequest {
  name: string;
  description: string;
  status: 'active' | 'suspended' | 'probation';
  capabilities: string[];
}

function validateStatus(status: unknown): status is 'active' | 'suspended' | 'probation' {
  return status === 'active' || status === 'suspended' || status === 'probation';
}

function validateCreateRequest(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    errors.push('Request body must be an object');
    return { valid: false, errors };
  }

  const req = body as Record<string, unknown>;

  // Validate name
  if (typeof req.name !== 'string' || !req.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  } else if (req.name.length > 255) {
    errors.push('name must not exceed 255 characters');
  }

  // Validate description
  if (typeof req.description !== 'string' || !req.description.trim()) {
    errors.push('description is required and must be a non-empty string');
  }

  // Validate status
  if (!validateStatus(req.status)) {
    errors.push('status must be one of: active, suspended, probation');
  }

  // Validate capabilities
  if (!Array.isArray(req.capabilities)) {
    errors.push('capabilities must be an array');
  } else if (req.capabilities.length === 0) {
    errors.push('capabilities must not be empty');
  } else if (!req.capabilities.every((cap) => typeof cap === 'string' && cap.trim())) {
    errors.push('capabilities must be an array of non-empty strings');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * GET /api/admin/catalog
 * Returns all catalog agents with computed ops scores
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const store = getMarketplaceStore();
    const agents = await store.getCatalogAgents();

    // Compute ops scores for each agent in parallel
    const agentsWithScores = await Promise.all(
      agents.map(async (agent) => {
        try {
          const { opsScore, breakdown } = await calculateOpsScore(agent.id, 'default');
          return { ...agent, opsScore, opsBreakdown: breakdown };
        } catch {
          return { ...agent, opsScore: 0, opsBreakdown: null };
        }
      })
    );

    return NextResponse.json(
      { success: true, agents: agentsWithScores },
      { status: 200 }
    );
  } catch (error) {
    logger.error('[Catalog API] Failed to fetch agents:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/catalog
 * Creates a new catalog agent
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as unknown;

    const { valid, errors } = validateCreateRequest(body);
    if (!valid) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      );
    }

    const createReq = body as CreateCatalogAgentRequest;
    const store = getMarketplaceStore();

    const newAgent = await store.createCatalogAgent({
      name: createReq.name.trim(),
      description: createReq.description.trim(),
      status: createReq.status,
      capabilities: createReq.capabilities,
    });

    logger.info('[Catalog API] Agent created:', {
      id: newAgent.id,
      name: newAgent.name,
      status: newAgent.status,
    });

    return NextResponse.json(
      { success: true, agent: newAgent },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[Catalog API] Failed to create agent:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { success: false, error: 'Failed to create agent' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/admin/catalog
 * CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
