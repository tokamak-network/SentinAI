'use client';

import { useIsMobile } from '@/lib/useMediaQuery';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const TABS = [
  { key: 'registry', label: 'REGISTRY' },
  { key: 'operators', label: 'OPERATORS' },
  { key: 'instance', label: 'INSTANCE' },
  { key: 'guide', label: 'GUIDE' },
  { key: 'sandbox', label: 'SANDBOX' },
] as const;

export type MarketplaceTab = (typeof TABS)[number]['key'];

interface MarketplaceNavProps {
  activeTab: MarketplaceTab;
  onChange: (tab: MarketplaceTab) => void;
  operatorCount?: number;
}

export default function MarketplaceNav({ activeTab, onChange, operatorCount }: MarketplaceNavProps) {
  const isMobile = useIsMobile();

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      marginBottom: '24px',
      borderBottom: '1px solid #D0D0D0',
      overflowX: 'auto',
    }}>
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            flex: isMobile ? 'none' : 1,
            padding: isMobile ? '10px 10px' : '12px 16px',
            fontFamily: FONT,
            fontSize: isMobile ? '8px' : '10px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            border: 'none',
            background: activeTab === key ? '#D40000' : '#F7F7F7',
            color: activeTab === key ? 'white' : '#3A3A3A',
            cursor: 'pointer',
            borderBottom: activeTab === key ? '3px solid #D40000' : 'none',
            transition: 'all 200ms',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {label}
          {key === 'operators' && operatorCount !== undefined && (
            <span style={{
              background: activeTab === key ? 'rgba(255,255,255,0.3)' : '#E8E8E8',
              color: activeTab === key ? 'white' : '#707070',
              fontSize: '8px',
              padding: '1px 5px',
              borderRadius: '8px',
              fontWeight: 600,
            }}>
              {operatorCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
