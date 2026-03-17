import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/nlops-bar', () => ({
  NLOpsBar: () => React.createElement('div', null, 'NLOPS BAR'),
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => React.createElement('div', null, 'TOASTER'),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/components/agent-interaction-graph', () => ({
  AgentInteractionGraph: () => React.createElement('div', null, 'GRAPH'),
}));

vi.mock('@/components/agent-roster-panel', () => ({
  AgentRosterPanel: () => React.createElement('div', null, 'ROSTER'),
}));

vi.mock('@/components/operations-panel', () => ({
  OperationsPanel: () => React.createElement('div', null, 'OPERATIONS'),
}));

const Page = (await import('@/app/page')).default;

describe('/ page', () => {
  it('renders the main dashboard page without errors', () => {
    const html = renderToStaticMarkup(React.createElement(Page));

    expect(html).toBeTruthy();
    expect(html).toContain('SENTINAI');
  });
});
