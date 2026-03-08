'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Zap, TrendingUp } from 'lucide-react';

interface ScalingPanelProps {
  score: number;
  currentVcpu: number;
  targetVcpu: number;
  predictionTier?: string;
  predictionConfidence?: number;
  lastDecision?: string;
  autoScalingEnabled: boolean;
}

const TIER_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: 'Idle', color: 'text-muted-foreground' },
  2: { label: 'Normal', color: 'text-primary' },
  4: { label: 'High', color: 'text-warning' },
  8: { label: 'Emergency', color: 'text-destructive' },
};

export function ScalingPanel({
  score,
  currentVcpu,
  targetVcpu,
  predictionTier,
  predictionConfidence,
  lastDecision,
  autoScalingEnabled,
}: ScalingPanelProps) {
  const tier = TIER_LABEL[currentVcpu] ?? { label: 'Unknown', color: 'text-muted-foreground' };
  const progressColor =
    score >= 77 ? '[&>div]:bg-destructive' :
    score >= 70 ? '[&>div]:bg-warning' :
    score >= 30 ? '[&>div]:bg-primary' :
    '[&>div]:bg-accent';

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="size-3" />
          Scaling Score
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Score</span>
            <span className="font-mono font-bold text-foreground">{score}/100</span>
          </div>
          <Progress value={score} className={`h-2 bg-border ${progressColor}`} />
        </div>

        {/* Current state */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Current</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-foreground">{currentVcpu} vCPU</span>
            <Badge variant="outline" className={`text-[10px] py-0 px-1 ${tier.color} border-current/30`}>
              {tier.label}
            </Badge>
          </div>
        </div>

        {/* Target vCPU (shown when different from current) */}
        {targetVcpu !== currentVcpu && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Target</span>
            <span className="font-mono text-accent">{targetVcpu} vCPU</span>
          </div>
        )}

        {/* Auto-scaling badge */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Auto-scale</span>
          <Badge
            variant={autoScalingEnabled ? 'default' : 'secondary'}
            className="text-[10px] py-0"
          >
            {autoScalingEnabled ? 'ON' : 'OFF'}
          </Badge>
        </div>

        {/* AI prediction */}
        {predictionTier && (
          <div className="border-t border-border pt-2 space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="size-3" />
              <span>AI Prediction</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-foreground">{predictionTier}</span>
              {predictionConfidence && (
                <span className="text-muted-foreground">{predictionConfidence}%</span>
              )}
            </div>
          </div>
        )}

        {/* Last decision */}
        {lastDecision && (
          <p className="text-[10px] text-muted-foreground truncate">{lastDecision}</p>
        )}
      </CardContent>
    </Card>
  );
}
