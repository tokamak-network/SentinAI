'use client';

import { PerformanceHistory, DailyMetric } from '@/lib/agent-marketplace';
import { useState } from 'react';

interface PerformanceGraphsProps {
  history: PerformanceHistory;
}

export function PerformanceGraphs({ history }: PerformanceGraphsProps) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const FONT = 'IBM Plex Mono';
  
  // Filter metrics based on period
  const filteredMetrics = getFilteredMetrics(history.metrics, period);
  
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #E0E0E0',
      borderRadius: 4,
      padding: 16,
      marginTop: 16,
      fontFamily: FONT,
    }}>
      {/* Header + Period Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#0A0A0A',
          letterSpacing: '0.08em',
        }}>
          PERFORMANCE HISTORY
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                background: period === p ? '#007A00' : '#E8E8E8',
                color: period === p ? '#fff' : '#0A0A0A',
                border: 'none',
                borderRadius: 3,
                padding: '4px 12px',
                fontSize: 8,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: FONT,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* 3 Graphs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <ResponseTimeGraph metrics={filteredMetrics} />
        <UptimeGraph metrics={filteredMetrics} />
        <RequestVolumeGraph metrics={filteredMetrics} />
      </div>
    </div>
  );
}

// Helper: Response Time Line Chart
function ResponseTimeGraph({ metrics }: { metrics: DailyMetric[] }) {
  const FONT = 'IBM Plex Mono';
  const maxValue = Math.max(...metrics.map(m => m.responseTimeMs));
  const minValue = Math.min(...metrics.map(m => m.responseTimeMs));
  const range = maxValue - minValue || 1;

  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 8, color: '#0A0A0A', fontFamily: FONT }}>
        Response Time (ms)
      </div>
      <SimpleLineChart
        data={metrics}
        valueKey="responseTimeMs"
        minValue={minValue}
        maxValue={maxValue}
        height={100}
      />
    </div>
  );
}

// Helper: Uptime Line Chart
function UptimeGraph({ metrics }: { metrics: DailyMetric[] }) {
  const FONT = 'IBM Plex Mono';
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 8, color: '#0A0A0A', fontFamily: FONT }}>
        Uptime (%)
      </div>
      <SimpleLineChart
        data={metrics}
        valueKey="uptimePercent"
        minValue={98}
        maxValue={100}
        height={100}
      />
    </div>
  );
}

// Helper: Request Volume Bar Chart
function RequestVolumeGraph({ metrics }: { metrics: DailyMetric[] }) {
  const FONT = 'IBM Plex Mono';
  const maxValue = Math.max(...metrics.map(m => m.requestCount));

  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 8, color: '#0A0A0A', fontFamily: FONT }}>
        Request Volume
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
        {metrics.map((metric, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: '#007A00',
              height: `${(metric.requestCount / maxValue) * 100}%`,
              borderRadius: 1,
              opacity: 0.8,
            }}
            title={`${metric.date}: ${metric.requestCount} calls`}
          />
        ))}
      </div>
    </div>
  );
}

// Helper: Simple Line Chart (without external libraries)
function SimpleLineChart({
  data,
  valueKey,
  minValue,
  maxValue,
  height,
}: {
  data: DailyMetric[];
  valueKey: keyof DailyMetric;
  minValue: number;
  maxValue: number;
  height: number;
}) {
  const range = maxValue - minValue || 1;
  const points = data.map((d) => ({
    value: (d[valueKey] as number) - minValue,
    normalized: ((d[valueKey] as number) - minValue) / range,
  }));

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: height,
      background: '#F8F8F8',
      borderRadius: 2,
      border: '1px solid #E0E0E0',
      padding: '8px',
      boxSizing: 'border-box',
    }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${Math.max(data.length * 10, 300)} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
      >
        {/* Line path */}
        <polyline
          points={points
            .map((p, i) => `${i * (300 / points.length)},${height - p.normalized * (height - 16)}`)
            .join(' ')}
          fill="none"
          stroke="#007A00"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        
        {/* Points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={i * (300 / points.length)}
            cy={height - p.normalized * (height - 16)}
            r="2"
            fill="#007A00"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

// Helper: Filter metrics by period
function getFilteredMetrics(metrics: DailyMetric[], period: '7d' | '30d' | '90d'): DailyMetric[] {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  return metrics.slice(Math.max(0, metrics.length - days));
}
