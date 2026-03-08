'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, Info, Zap, Radio } from 'lucide-react';

type EventType = 'anomaly' | 'scale' | 'rca' | 'remediate' | 'info';

interface StreamEvent {
  id: string;
  time: string;
  type: EventType;
  message: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

interface EventStreamProps {
  events: StreamEvent[];
}

const EVENT_ICONS: Record<EventType, React.ReactNode> = {
  anomaly:   <AlertTriangle className="size-3" />,
  scale:     <Zap className="size-3" />,
  rca:       <Info className="size-3" />,
  remediate: <CheckCircle2 className="size-3" />,
  info:      <Info className="size-3" />,
};

// Left border color per severity (2px colored border-l)
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-[#F87171]',
  high:     'border-[#FB923C]',
  medium:   'border-[#6EE7F7]',
  low:      'border-white/20',
};

// Icon color per event type
const EVENT_ICON_COLOR: Record<EventType, string> = {
  anomaly:   'text-[#FB923C]',
  scale:     'text-[#6EE7F7]',
  rca:       'text-[#A78BFA]',
  remediate: 'text-[#4ADE80]',
  info:      'text-white/40',
};

export function EventStream({ events }: EventStreamProps) {
  return (
    <div className="glass-panel rounded-xl h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <Radio className="size-3 text-white/40" />
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          Live Events
        </span>
      </div>

      {/* Events */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2 space-y-1">
          {events.map((event) => (
            <div
              key={event.id}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-md border-l-2 hover:bg-white/[0.03] transition-colors animate-in fade-in slide-in-from-top-1 duration-200 ${
                event.severity ? SEVERITY_BORDER[event.severity] : 'border-white/10'
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${EVENT_ICON_COLOR[event.type]}`}>
                {EVENT_ICONS[event.type]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/80 truncate">{event.message}</p>
                <p className="text-[10px] text-white/30 font-mono mt-0.5">{event.time}</p>
              </div>
              {event.severity && (
                <span className={`text-[9px] font-mono shrink-0 mt-0.5 ${
                  event.severity === 'critical' ? 'text-[#F87171]' :
                  event.severity === 'high'     ? 'text-[#FB923C]' :
                  event.severity === 'medium'   ? 'text-[#6EE7F7]' :
                                                  'text-white/30'
                }`}>
                  {event.severity.toUpperCase()}
                </span>
              )}
            </div>
          ))}

          {events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Radio className="size-5 text-white/15" />
              <p className="text-[10px] text-white/25 font-mono">No events</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export type { StreamEvent };
