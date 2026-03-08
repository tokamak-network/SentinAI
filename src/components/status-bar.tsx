'use client';

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

function scoreColor(score: number): string {
  if (score >= 77) return 'text-[#F87171]';
  if (score >= 70) return 'text-[#FB923C]';
  if (score >= 30) return 'text-[#6EE7F7]';
  return 'text-[#4ADE80]';
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
  const isLive = agentPhase !== 'error' && agentPhase !== 'idle';

  return (
    <header className="flex items-center gap-3 px-6 h-10 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl text-xs shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-1.5 text-[#6EE7F7] font-semibold mr-2">
        <Shield className="size-3.5" />
        <span className="font-mono tracking-wide">SentinAI</span>
      </div>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* L1 */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">L1</span>
      <span className="font-mono text-white/80">#{l1BlockHeight.toLocaleString()}</span>
      {l1BlockDelta > 0 && <span className="text-[#6EE7F7] text-[10px]">↑{l1BlockDelta}</span>}

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* L2 */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">L2</span>
      <span className="font-mono text-white/80">#{l2BlockHeight.toLocaleString()}</span>
      {l2BlockDelta > 0 && <span className="text-[#6EE7F7] text-[10px]">↑{l2BlockDelta}</span>}
      {peerCount !== undefined && (
        <span className="text-white/30 text-[10px]">Peers {peerCount}</span>
      )}
      <span className={`text-[10px] font-mono ${isSyncing ? 'text-[#FB923C]' : 'text-[#4ADE80]'}`}>
        {isSyncing ? 'Syncing' : '✓ Sync'}
      </span>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* TxPool */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">TxPool</span>
      <span className="font-mono text-white/80">{txPoolPending}</span>

      <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />

      {/* Score */}
      <span className="text-[10px] uppercase tracking-widest text-white/40">Score</span>
      <span className={`font-mono font-bold tabular-nums ${scoreColor(agentScore)}`}>
        {agentScore}
      </span>

      {/* Network name */}
      {networkName && (
        <>
          <Separator orientation="vertical" className="h-3.5 bg-white/[0.08]" />
          <span className="text-white/30 text-[10px] font-mono">{networkName}</span>
        </>
      )}

      {/* Live indicator */}
      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${isLive ? 'bg-[#4ADE80] animate-pulse' : 'bg-white/20'}`}
        />
        <span className={`text-[10px] font-mono ${isLive ? 'text-[#4ADE80]' : 'text-white/30'}`}>
          {isLive ? 'Live' : 'Idle'}
        </span>
      </div>
    </header>
  );
}
