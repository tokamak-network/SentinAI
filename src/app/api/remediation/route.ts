/**
 * Auto-Remediation API Endpoint
 * GET /api/remediation — Query status and history
 * POST /api/remediation — Manually trigger playbook
 * PATCH /api/remediation — Update configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRemediationConfig,
  updateRemediationConfig,
  getExecutionHistory,
  getCircuitBreakerStates,
  resetCircuitBreaker,
  executePlaybook,
} from '@/lib/remediation-engine';

// ============================================================
// GET — Query state
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const config = getRemediationConfig();
    const circuitBreakers = getCircuitBreakerStates();
    const recentExecutions = getExecutionHistory(limit);

    return NextResponse.json({
      config,
      circuitBreakers,
      recentExecutions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Remediation API] GET error:', message);
    
    return NextResponse.json(
      { error: 'Failed to fetch remediation state', details: message },
      { status: 500 }
    );
  }
}

// ============================================================
// POST — Manual playbook execution or circuit breaker reset
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Action: Reset circuit breaker
    if (body.action === 'reset_circuit' && body.playbookName) {
      resetCircuitBreaker(body.playbookName);
      
      return NextResponse.json({
        success: true,
        message: `Circuit breaker reset for ${body.playbookName}`,
      });
    }

    // Action: Trigger playbook
    if (body.playbookName) {
      const execution = await executePlaybook(body.playbookName, 'manual');
      
      return NextResponse.json({
        success: execution.status === 'success',
        execution,
      });
    }

    return NextResponse.json(
      { error: 'Missing playbookName or action in request body' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Remediation API] POST error:', message);
    
    return NextResponse.json(
      { error: 'Failed to execute playbook', details: message },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH — Update configuration
// ============================================================

export async function PATCH(request: NextRequest) {
  try {
    const updates = await request.json();
    
    const newConfig = updateRemediationConfig(updates);
    
    return NextResponse.json({
      success: true,
      config: newConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Remediation API] PATCH error:', message);
    
    return NextResponse.json(
      { error: 'Failed to update configuration', details: message },
      { status: 500 }
    );
  }
}
