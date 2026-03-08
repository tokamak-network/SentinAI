'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Stethoscope, Wrench, FlaskConical } from 'lucide-react';

const SCENARIOS = [
  { id: 'spike',  label: 'Spike',  color: 'text-red-400' },
  { id: 'rising', label: 'Rising', color: 'text-amber-400' },
  { id: 'stable', label: 'Stable', color: 'text-emerald-400' },
  { id: 'live',   label: 'Live',   color: 'text-blue-400' },
] as const;

interface NLOpsBarProps {
  onSend: (message: string) => void;
  onRunRca: () => void;
  onRemediate: () => void;
  onInjectScenario?: (scenario: string) => void;
  isLoading?: boolean;
}

export function NLOpsBar({ onSend, onRunRca, onRemediate, onInjectScenario, isLoading }: NLOpsBarProps) {
  const [input, setInput] = useState('');
  const [showScenarios, setShowScenarios] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  const handleScenario = (id: string) => {
    onInjectScenario?.(id);
    setShowScenarios(false);
  };

  return (
    <div className="relative flex items-center gap-2 px-4 h-12 border-t border-border bg-card/80 backdrop-blur-sm shrink-0">
      {/* Scenario picker popover */}
      {showScenarios && (
        <div className="absolute bottom-full left-4 mb-1 flex gap-1 p-1.5 rounded-lg border border-border bg-card shadow-xl">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleScenario(s.id)}
              className={`px-3 py-1 text-xs rounded-md font-medium hover:bg-muted transition-colors ${s.color}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground"
        onClick={onRunRca}
      >
        <Stethoscope className="size-3" />
        Run RCA
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground"
        onClick={onRemediate}
      >
        <Wrench className="size-3" />
        Remediate
      </Button>
      {onInjectScenario && (
        <Button
          variant="outline"
          size="sm"
          className={`text-xs gap-1.5 border-border hover:text-foreground ${showScenarios ? 'text-amber-400 border-amber-500/40' : 'text-muted-foreground'}`}
          onClick={() => setShowScenarios((v) => !v)}
        >
          <FlaskConical className="size-3" />
          Simulate
        </Button>
      )}

      {/* NLOps input */}
      <div className="flex-1 flex items-center gap-2 bg-input border border-border rounded-md px-3 h-8">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          data-testid="nlops-input"
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground hover:text-accent"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          data-testid="nlops-send"
        >
          <Send className="size-3" />
        </Button>
      </div>
    </div>
  );
}
