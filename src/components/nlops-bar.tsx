'use client';

import { useState } from 'react';
import { Send, Stethoscope, Wrench, FlaskConical } from 'lucide-react';

const SCENARIOS = [
  { id: 'spike',  label: 'Spike',  color: 'text-[#F87171]' },
  { id: 'rising', label: 'Rising', color: 'text-[#FB923C]' },
  { id: 'stable', label: 'Stable', color: 'text-[#4ADE80]' },
  { id: 'live',   label: 'Live',   color: 'text-[#6EE7F7]' },
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
    <div className="relative flex items-center gap-2 px-4 h-12 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl shrink-0">
      {/* Scenario picker popover */}
      {showScenarios && (
        <div className="absolute bottom-full left-4 mb-2 flex gap-1 p-1.5 rounded-xl border border-white/[0.08] glass-panel shadow-xl">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleScenario(s.id)}
              className={`px-3 py-1 text-[10px] rounded-lg font-mono hover:bg-white/[0.06] transition-colors ${s.color}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick action buttons */}
      <button
        onClick={onRunRca}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] transition-all"
      >
        <Stethoscope className="size-3" />
        Run RCA
      </button>
      <button
        onClick={onRemediate}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] transition-all"
      >
        <Wrench className="size-3" />
        Remediate
      </button>
      {onInjectScenario && (
        <button
          onClick={() => setShowScenarios((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono bg-white/[0.05] hover:bg-white/[0.08] border transition-all ${
            showScenarios
              ? 'text-[#FB923C] border-[#FB923C]/30 bg-[#FB923C]/[0.06]'
              : 'text-white/50 hover:text-white/80 border-white/[0.08]'
          }`}
        >
          <FlaskConical className="size-3" />
          Simulate
        </button>
      )}

      {/* NLOps input */}
      <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/[0.10] focus-within:border-white/[0.20] focus-within:shadow-[0_0_12px_rgba(110,231,247,0.08)] rounded-xl px-3 h-8 transition-all">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a command..."
          className="flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/25 font-mono outline-none"
          data-testid="nlops-input"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className={`size-5 flex items-center justify-center rounded-md transition-all ${
            input.trim()
              ? 'text-[#6EE7F7] hover:bg-[#6EE7F7]/10'
              : 'text-white/20 pointer-events-none'
          }`}
          data-testid="nlops-send"
        >
          <Send className="size-3" />
        </button>
      </div>
    </div>
  );
}
