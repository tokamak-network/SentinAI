'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Stethoscope, Wrench } from 'lucide-react';

interface NLOpsBarProps {
  onSend: (message: string) => void;
  onRunRca: () => void;
  onRemediate: () => void;
  isLoading?: boolean;
}

export function NLOpsBar({ onSend, onRunRca, onRemediate, isLoading }: NLOpsBarProps) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex items-center gap-2 px-4 h-12 border-t border-border bg-card/80 backdrop-blur-sm shrink-0">
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
