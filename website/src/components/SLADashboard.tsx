'use client';

import { ServiceSLA } from '@/lib/agent-marketplace';

interface SLADashboardProps {
  sla: ServiceSLA;
}

export function SLADashboard({ sla }: SLADashboardProps) {
  const FONT = 'IBM Plex Mono';
  
  return (
    <div style={{
      background: '#F8F8F8',
      border: '1px solid #E0E0E0',
      borderRadius: 4,
      padding: 16,
      marginTop: 12,
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#0A0A0A',
        letterSpacing: '0.08em',
        marginBottom: 12,
      }}>
        SLA GUARANTEES
      </div>

      {/* Availability Gauge */}
      <SLAGauge
        label="Availability"
        value={sla.availabilityPercent}
        unit="%"
        maxValue={100}
      />

      {/* Response Time Gauge */}
      <SLAGauge
        label="Response Time"
        value={sla.responseTimeMs}
        unit="ms"
        maxValue={1000}
      />

      {/* Support Level Badge */}
      <div style={{ marginBottom: 8, marginTop: 12 }}>
        <SLABadge level={sla.supportLevel} />
      </div>

      {/* Refund Policy */}
      <div style={{
        fontSize: 8,
        color: '#707070',
        marginTop: 8,
        lineHeight: 1.4,
      }}>
        {sla.refundPolicy}
      </div>
    </div>
  );
}

// Helper: SLA Gauge (progress bar)
function SLAGauge({
  label,
  value,
  unit,
  maxValue = 100,
}: {
  label: string;
  value: number;
  unit: string;
  maxValue?: number;
}) {
  const percentage = Math.min((value / maxValue) * 100, 100);
  const FONT = 'IBM Plex Mono';

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9,
        color: '#707070',
        marginBottom: 4,
        fontFamily: FONT,
      }}>
        {label}: {value}{unit}
      </div>
      <div style={{
        background: '#E8E8E8',
        borderRadius: 2,
        height: 5,
        overflow: 'hidden',
      }}>
        <div style={{
          background: '#007A00',
          height: '100%',
          width: `${percentage}%`,
          transition: 'width 0.2s ease',
        }} />
      </div>
    </div>
  );
}

// Helper: Support Level Badge
function SLABadge({ level }: { level: 'Basic' | 'Standard' | '24/7 Premium' }) {
  const colors = {
    'Basic': { bg: '#C0C0C0', fg: '#000' },
    'Standard': { bg: '#FFB800', fg: '#000' },
    '24/7 Premium': { bg: '#007A00', fg: '#fff' },
  };
  const color = colors[level];
  const FONT = 'IBM Plex Mono';

  return (
    <span style={{
      display: 'inline-block',
      background: color.bg,
      color: color.fg,
      padding: '3px 8px',
      borderRadius: 2,
      fontSize: 8,
      fontWeight: 700,
      fontFamily: FONT,
      letterSpacing: '0.05em',
    }}>
      {level}
    </span>
  );
}