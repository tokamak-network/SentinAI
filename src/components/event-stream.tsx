'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Info, Zap } from 'lucide-react';

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
  anomaly: <AlertTriangle className="size-3" />,
  scale: <Zap className="size-3" />,
  rca: <Info className="size-3" />,
  remediate: <CheckCircle2 className="size-3" />,
  info: <Info className="size-3" />,
};

const EVENT_COLORS: Record<EventType, string> = {
  anomaly: 'text-warning',
  scale: 'text-primary',
  rca: 'text-accent',
  remediate: 'text-accent',
  info: 'text-muted-foreground',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-destructive/20 text-destructive border-destructive/30',
  high: 'bg-warning/20 text-warning border-warning/30',
  medium: 'bg-primary/20 text-primary border-primary/30',
  low: 'bg-muted text-muted-foreground border-border',
};

export function EventStream({ events }: EventStreamProps) {
  return (
    <Card className="glass-panel border-border h-full flex flex-col">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Live Events
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea className="h-full px-3 pb-2">
          <div className="space-y-1.5">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 text-xs animate-in slide-in-from-top-1 duration-300"
              >
                <span className={`mt-0.5 shrink-0 ${EVENT_COLORS[event.type]}`}>
                  {EVENT_ICONS[event.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground truncate">{event.message}</p>
                  <p className="text-muted-foreground">{event.time}</p>
                </div>
                {event.severity && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 px-1 shrink-0 ${SEVERITY_BADGE[event.severity]}`}
                  >
                    {event.severity.toUpperCase()}
                  </Badge>
                )}
              </div>
            ))}
            {events.length === 0 && (
              <p className="text-muted-foreground text-xs text-center py-4">이벤트 없음</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export type { StreamEvent };
