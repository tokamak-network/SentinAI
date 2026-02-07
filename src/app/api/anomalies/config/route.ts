/**
 * Anomaly Alert Config API
 * GET: 현재 알림 설정 조회
 * POST: 알림 설정 업데이트
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
  const config = getAlertConfig();
  const history = getAlertHistory();

  // 최근 24시간 알림 수 계산
  const alertsSent24h = history.length;

  // 다음 알림 가능 시간 (가장 최근 알림 기준)
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

    // 유효성 검증
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

    // 설정 업데이트 - build thresholds with required fields if provided
    const thresholdsUpdate = body.thresholds ? {
      notifyOn: body.thresholds.notifyOn ?? getAlertConfig().thresholds.notifyOn,
      cooldownMinutes: body.thresholds.cooldownMinutes ?? getAlertConfig().thresholds.cooldownMinutes,
    } : undefined;

    const updatedConfig = updateAlertConfig({
      webhookUrl: body.webhookUrl,
      enabled: body.enabled,
      thresholds: thresholdsUpdate,
    });

    const history = getAlertHistory();

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
