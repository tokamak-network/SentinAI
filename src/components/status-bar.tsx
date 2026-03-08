'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Shield } from 'lucide-react';

interface StatusBarProps {
  l1BlockHeight: number;
  l2BlockHeight: number;
  l1BlockDelta: number;
  l2BlockDelta: number;
  txPoolPending: number;
  agentScore: number;
  agentPhase: string;
  peerCount?: number;
  isSyncing: boolean;
  networkName?: string;
}

export function StatusBar({
  l1BlockHeight,
  l2BlockHeight,
  l1BlockDelta,
  l2BlockDelta,
  txPoolPending,
  agentScore,
  agentPhase,
  peerCount,
  isSyncing,
  networkName,
}: StatusBarProps) {
  const scoreColor =
    agentScore >= 77 ? 'text-destructive' :
    agentScore >= 70 ? 'text-warning' :
    agentScore >= 30 ? 'text-primary' :
    'text-accent';

  const isLive = agentPhase !== 'error' && agentPhase !== 'idle';

  return (
    <header className="flex items-center gap-3 px-4 h-10 border-b border-border bg-card/80 backdrop-blur-sm text-sm font-mono shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-1.5 text-primary font-semibold mr-2">
        <Shield className="size-4" />
        <span>SentinAI</span>
      </div>

      <Separator orientation="vertical" className="h-4" />

      {/* L1 */}
      <span className="text-muted-foreground">L1</span>
      <span className="text-foreground">#{l1BlockHeight.toLocaleString()}</span>
      {l1BlockDelta > 0 && <span className="text-accent text-xs">↑{l1BlockDelta}</span>}

      <Separator orientation="vertical" className="h-4" />

      {/* L2 */}
      <span className="text-muted-foreground">L2</span>
      <span className="text-foreground">#{l2BlockHeight.toLocaleString()}</span>
      {l2BlockDelta > 0 && <span className="text-accent text-xs">↑{l2BlockDelta}</span>}
      {peerCount !== undefined && (
        <span className="text-muted-foreground text-xs">Peers {peerCount}</span>
      )}
      <Badge variant={isSyncing ? 'outline' : 'secondary'} className="text-xs py-0">
        {isSyncing ? 'Syncing' : '✓ Sync'}
      </Badge>

      <Separator orientation="vertical" className="h-4" />

      {/* TxPool */}
      <span className="text-muted-foreground">TxPool</span>
      <span className="text-foreground">{txPoolPending}</span>

      <Separator orientation="vertical" className="h-4" />

      {/* Agent Score */}
      <span className="text-muted-foreground">Score</span>
      <span className={scoreColor + ' font-bold'}>{agentScore}</span>

      {/* Network name */}
      {networkName && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground text-xs">{networkName}</span>
        </>
      )}

      {/* Live indicator — pushed to right */}
      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={`size-2 rounded-full ${isLive ? 'bg-accent animate-pulse' : 'bg-muted-foreground'}`}
        />
        <span className="text-muted-foreground text-xs">{isLive ? 'Live' : 'Idle'}</span>
      </div>
    </header>
  );
}
