'use client';

import { ServiceSLA } from '@/lib/agent-marketplace';

interface SLADashboardProps {
  sla: ServiceSLA;
}

export function SLADashboard({ sla }: SLADashboardProps) {
  const FONT = 'IBM Plex Mono';

  const colors: Record<string, { bg: string; fg: string }> = {
    'Basic': { bg: '#E0E0E0', fg: '#555' },
    'Standard': { bg: '#FFB800', fg: '#000' },
    '24/7 Premium': { bg: '#007A00', fg: '#fff' },
  };
  const badgeColor = colors[sla.supportLevel] ?? colors['Basic'];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginTop: 8,
      fontFamily: FONT,
      flexWrap: 'wrap',
    }}>
      {/* SLA label */}
      <span style={{
        fontSize: 8,
        fontWeight: 700,
        color: '#A0A0A0',
        letterSpacing: '0.1em',
      }}>
        SLA
      </span>

      {/* Availability */}
      <span style={{ fontSize: 9, color: '#3A3A3A' }}>
        <span style={{ color: '#007A00', fontWeight: 700 }}>{sla.availabilityPercent}%</span>
        <span style={{ color: '#A0A0A0' }}> uptime</span>
      </span>

      {/* Separator */}
      <span style={{ color: '#D0D0D0', fontSize: 9 }}>·</span>

      {/* Response Time */}
      <span style={{ fontSize: 9, color: '#3A3A3A' }}>
        <span style={{ fontWeight: 700 }}>≤{sla.responseTimeMs}ms</span>
      </span>

      {/* Separator */}
      <span style={{ color: '#D0D0D0', fontSize: 9 }}>·</span>

      {/* Support Level Badge */}
      <span style={{
        display: 'inline-block',
        background: badgeColor.bg,
        color: badgeColor.fg,
        padding: '1px 6px',
        borderRadius: 2,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.05em',
      }}>
        {sla.supportLevel}
      </span>

      {/* Refund Policy */}
      <span style={{ fontSize: 8, color: '#A0A0A0' }}>
        {sla.refundPolicy}
      </span>
    </div>
  );
}
