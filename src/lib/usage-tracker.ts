/**
 * Usage Tracker Module (Redis-backed)
 * vCPU 사용 패턴을 추적하여 비용 최적화 분석에 활용
 */

import {
  UsageDataPoint,
  UsagePattern,
  HourlyProfile,
} from '@/types/cost';
import { getStore } from './redis-store';

/**
 * 환경 변수로 추적 활성화 여부 결정
 */
function isTrackingEnabled(): boolean {
  return process.env.COST_TRACKING_ENABLED !== 'false';
}

/**
 * 사용량 데이터 기록
 *
 * @param vcpu - 현재 할당된 vCPU (1, 2, 4, 8 등)
 * @param cpuUtilization - 현재 CPU 사용률 (0-100)
 */
export async function recordUsage(vcpu: number, cpuUtilization: number): Promise<void> {
  if (!isTrackingEnabled()) {
    return;
  }

  // 스트레스 테스트 모드의 시뮬레이션 데이터는 제외 (vcpu가 8인 경우)
  if (vcpu === 8) {
    return;
  }

  const dataPoint: UsageDataPoint = {
    timestamp: Date.now(),
    vcpu,
    cpuUtilization: Math.min(Math.max(cpuUtilization, 0), 100),
  };

  const store = getStore();
  await store.pushUsageData(dataPoint);
}

/**
 * 지정된 기간의 사용량 데이터 조회
 *
 * @param days - 조회할 기간 (일)
 * @returns 해당 기간의 UsageDataPoint 배열
 */
export async function getUsageData(days: number): Promise<UsageDataPoint[]> {
  const store = getStore();
  return store.getUsageData(days);
}

/**
 * 전체 사용량 데이터 개수 조회 (디버깅용)
 */
export async function getUsageDataCount(): Promise<number> {
  const store = getStore();
  return store.getUsageDataCount();
}

/**
 * 사용량 데이터 초기화 (테스트용)
 */
export async function clearUsageData(): Promise<void> {
  const store = getStore();
  await store.clearUsageData();
}

// ============================================================
// Pattern Analysis
// ============================================================

/**
 * 시간대별 사용 패턴 분석
 *
 * 7일 x 24시간 = 168개의 버킷으로 그룹화하여 통계 계산
 *
 * @param days - 분석할 기간 (일), 기본값 7
 * @returns UsagePattern 배열 (최대 168개)
 */
export async function analyzePatterns(days: number = 7): Promise<UsagePattern[]> {
  const data = await getUsageData(days);

  if (data.length === 0) {
    return [];
  }

  // 버킷 초기화
  type Bucket = {
    vcpuSum: number;
    vcpuMax: number;
    utilSum: number;
    count: number;
  };

  const buckets: Map<string, Bucket> = new Map();

  // 데이터를 버킷에 분류
  for (const point of data) {
    const date = new Date(point.timestamp);
    const dayOfWeek = date.getDay();
    const hourOfDay = date.getHours();
    const key = `${dayOfWeek}-${hourOfDay}`;

    const bucket = buckets.get(key) || {
      vcpuSum: 0,
      vcpuMax: 0,
      utilSum: 0,
      count: 0,
    };

    bucket.vcpuSum += point.vcpu;
    bucket.vcpuMax = Math.max(bucket.vcpuMax, point.vcpu);
    bucket.utilSum += point.cpuUtilization;
    bucket.count += 1;

    buckets.set(key, bucket);
  }

  // 버킷을 UsagePattern으로 변환
  const patterns: UsagePattern[] = [];

  buckets.forEach((bucket, key) => {
    const [dayStr, hourStr] = key.split('-');
    const dayOfWeek = parseInt(dayStr, 10);
    const hourOfDay = parseInt(hourStr, 10);

    patterns.push({
      dayOfWeek,
      hourOfDay,
      avgVcpu: Math.round((bucket.vcpuSum / bucket.count) * 100) / 100,
      peakVcpu: bucket.vcpuMax,
      avgUtilization: Math.round((bucket.utilSum / bucket.count) * 100) / 100,
      sampleCount: bucket.count,
    });
  });

  // 정렬: 요일 → 시간 순
  patterns.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) {
      return a.dayOfWeek - b.dayOfWeek;
    }
    return a.hourOfDay - b.hourOfDay;
  });

  return patterns;
}

/**
 * 24시간 프로파일 생성 (요일 무관)
 *
 * @returns 24개의 HourlyProfile
 */
export async function getHourlyBreakdown(): Promise<HourlyProfile[]> {
  const data = await getUsageData(7);

  if (data.length === 0) {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      avgVcpu: 1,
      avgUtilization: 0,
    }));
  }

  // 시간별 누적
  const hourlyBuckets: Array<{ vcpuSum: number; utilSum: number; count: number }> =
    Array.from({ length: 24 }, () => ({ vcpuSum: 0, utilSum: 0, count: 0 }));

  for (const point of data) {
    const hour = new Date(point.timestamp).getHours();
    hourlyBuckets[hour].vcpuSum += point.vcpu;
    hourlyBuckets[hour].utilSum += point.cpuUtilization;
    hourlyBuckets[hour].count += 1;
  }

  return hourlyBuckets.map((bucket, hour) => ({
    hour,
    avgVcpu: bucket.count > 0
      ? Math.round((bucket.vcpuSum / bucket.count) * 100) / 100
      : 1,
    avgUtilization: bucket.count > 0
      ? Math.round((bucket.utilSum / bucket.count) * 100) / 100
      : 0,
  }));
}

/**
 * 사용 패턴 요약 통계
 *
 * @param days - 분석 기간
 * @returns 요약 통계
 */
export async function getUsageSummary(days: number = 7): Promise<{
  avgVcpu: number;
  peakVcpu: number;
  avgUtilization: number;
  dataPointCount: number;
  oldestDataAge: number;
}> {
  const data = await getUsageData(days);

  if (data.length === 0) {
    return {
      avgVcpu: 1,
      peakVcpu: 1,
      avgUtilization: 0,
      dataPointCount: 0,
      oldestDataAge: 0,
    };
  }

  let vcpuSum = 0;
  let peakVcpu = 0;
  let utilSum = 0;

  for (const point of data) {
    vcpuSum += point.vcpu;
    peakVcpu = Math.max(peakVcpu, point.vcpu);
    utilSum += point.cpuUtilization;
  }

  const oldestTimestamp = data[0].timestamp;
  const oldestDataAge = (Date.now() - oldestTimestamp) / (1000 * 60 * 60);

  return {
    avgVcpu: Math.round((vcpuSum / data.length) * 100) / 100,
    peakVcpu,
    avgUtilization: Math.round((utilSum / data.length) * 100) / 100,
    dataPointCount: data.length,
    oldestDataAge: Math.round(oldestDataAge * 10) / 10,
  };
}
