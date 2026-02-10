/**
 * Anomaly Alert Config API
 * GET: Retrieve current alert configuration
 * POST: Update alert configuration
 */

import { NextResponse } from 'next/server';
import {
  getAlertConfig,
  updateAlertConfig,
  getAlertHistory
} from '@/lib/alert-dispatcher';
import type { AlertConfigResponse, AlertConfigUpdateRequest } from '@/types/anomaly';
import type { AISeverity } from '@/types/scaling';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<AlertConfigResponse>> {
  const config = await getAlertConfig();
  const history = await getAlertHistory();

  // Calculate alert count in the last 24 hours
  const alertsSent24h = history.length;

  // Next available alert time (based on most recent alert)
  let nextAlertAvailableAt: string | undefined;
  if (history.length > 0) {
    const lastAlert = history[history.length - 1];
    const lastAlertTime = new Date(lastAlert.sentAt).getTime();
    const cooldownMs = config.thresholds.cooldownMinutes * 60 * 1000;
    const nextAvailable = lastAlertTime + cooldownMs;

    if (Date.now() < nextAvailable) {
      nextAlertAvailableAt = new Date(nextAvailable).toISOString();
    }
  }

  return NextResponse.json({
    config,
    alertsSent24h,
    nextAlertAvailableAt,
  });
}

export async function POST(request: Request): Promise<NextResponse<AlertConfigResponse | { error: string }>> {
  try {
    const body: AlertConfigUpdateRequest = await request.json();

    // Validation
    if (body.thresholds?.notifyOn) {
      const validSeverities: AISeverity[] = ['low', 'medium', 'high', 'critical'];
      const invalidSeverities = body.thresholds.notifyOn.filter(s => !validSeverities.includes(s));
      if (invalidSeverities.length > 0) {
        return NextResponse.json(
          { error: `Invalid severity values: ${invalidSeverities.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (body.thresholds?.cooldownMinutes !== undefined) {
      if (body.thresholds.cooldownMinutes < 1 || body.thresholds.cooldownMinutes > 1440) {
        return NextResponse.json(
          { error: 'cooldownMinutes must be between 1 and 1440 (24 hours)' },
          { status: 400 }
        );
      }
    }

    // Update config - build thresholds with required fields if provided
    const currentConfig = await getAlertConfig();
    const thresholdsUpdate = body.thresholds ? {
      notifyOn: body.thresholds.notifyOn ?? currentConfig.thresholds.notifyOn,
      cooldownMinutes: body.thresholds.cooldownMinutes ?? currentConfig.thresholds.cooldownMinutes,
    } : undefined;

    const updatedConfig = await updateAlertConfig({
      webhookUrl: body.webhookUrl,
      enabled: body.enabled,
      thresholds: thresholdsUpdate,
    });

    const history = await getAlertHistory();

    return NextResponse.json({
      config: updatedConfig,
      alertsSent24h: history.length,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to update config: ${errorMessage}` },
      { status: 500 }
    );
  }
}
