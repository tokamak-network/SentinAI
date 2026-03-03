'use client';

import { RefreshCw } from 'lucide-react';
import type {
  AutonomousIntentData,
  AutonomyDemoAction,
  AutonomyLevel,
} from './types';
import { AUTONOMY_LEVELS, AUTONOMOUS_INTENT_OPTIONS } from './types';

interface AutonomyControlsProps {
  currentLevel: AutonomyLevel | undefined;
  autonomousIntent: AutonomousIntentData;
  actionRunning: AutonomyDemoAction | null;
  goalManagerEnabled: boolean;
  hasOperationId: boolean;
  hasPlan: boolean;
  onLevelChange: (level: AutonomyLevel) => void;
  onIntentChange: (intent: AutonomousIntentData) => void;
  onAction: (action: AutonomyDemoAction) => void;
  onRefresh: () => void;
}

export function AutonomyControls({
  currentLevel,
  autonomousIntent,
  actionRunning,
  goalManagerEnabled,
  hasOperationId,
  hasPlan,
  onLevelChange,
  onIntentChange,
  onAction,
  onRefresh,
}: AutonomyControlsProps) {
  const disabled = actionRunning !== null;

  return (
    <div className="space-y-3">
      {/* Row 1: Autonomy Level */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Level</span>
        {AUTONOMY_LEVELS.map((level) => (
          <button
            key={level}
            data-testid={`autonomy-level-btn-${level}`}
            onClick={() => onLevelChange(level)}
            disabled={disabled}
            className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all disabled:opacity-50 ${
              currentLevel === level
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {level}
          </button>
        ))}
        <button
          onClick={onRefresh}
          disabled={disabled}
          className="ml-auto p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Row 2: Seed Scenarios + Goal Manager */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Seed</span>
        {(['seed-stable', 'seed-rising', 'seed-spike'] as const).map((action) => {
          const label = action.replace('seed-', '');
          const colors: Record<typeof action, string> = {
            'seed-stable': 'bg-blue-900/50 text-blue-400 hover:bg-blue-900/70',
            'seed-rising': 'bg-amber-900/50 text-amber-400 hover:bg-amber-900/70',
            'seed-spike': 'bg-red-900/50 text-red-400 hover:bg-red-900/70',
          };
          return (
            <button
              key={action}
              onClick={() => onAction(action)}
              disabled={disabled}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-md disabled:opacity-50 ${colors[action]}`}
            >
              {actionRunning === action ? '...' : label}
            </button>
          );
        })}

        <div className="w-px h-4 bg-gray-700 mx-1" />

        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Goal</span>
        <button
          onClick={() => onAction('goal-tick')}
          disabled={disabled || !goalManagerEnabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-50"
        >
          {actionRunning === 'goal-tick' ? '...' : 'Tick'}
        </button>
        <button
          onClick={() => onAction('goal-dispatch-dry-run')}
          disabled={disabled || !goalManagerEnabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-indigo-900/50 text-indigo-400 hover:bg-indigo-900/70 disabled:opacity-50"
        >
          {actionRunning === 'goal-dispatch-dry-run' ? '...' : 'Dispatch'}
        </button>
      </div>

      {/* Row 3: Autonomous Ops */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400 font-semibold uppercase shrink-0">Ops</span>
        <select
          value={autonomousIntent}
          onChange={(e) => onIntentChange(e.target.value as AutonomousIntentData)}
          disabled={disabled}
          className="px-2 py-1 text-[10px] rounded-md bg-gray-800 text-gray-300 border border-gray-700 disabled:opacity-50"
        >
          {AUTONOMOUS_INTENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={() => onAction('autonomous-plan')}
          disabled={disabled}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-plan' ? '...' : 'Plan'}
        </button>
        <button
          onClick={() => onAction('autonomous-execute')}
          disabled={disabled || !hasPlan}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-cyan-900/50 text-cyan-400 hover:bg-cyan-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-execute' ? '...' : 'Execute'}
        </button>
        <button
          onClick={() => onAction('autonomous-verify')}
          disabled={disabled || !hasOperationId}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-violet-900/50 text-violet-400 hover:bg-violet-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-verify' ? '...' : 'Verify'}
        </button>
        <button
          onClick={() => onAction('autonomous-rollback')}
          disabled={disabled || !hasOperationId}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-rose-900/50 text-rose-400 hover:bg-rose-900/70 disabled:opacity-50"
        >
          {actionRunning === 'autonomous-rollback' ? '...' : 'Rollback'}
        </button>
      </div>
    </div>
  );
}
