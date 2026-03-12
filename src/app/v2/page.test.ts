import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

vi.mock('recharts', () => {
  const MockChart = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const MockPrimitive = () => React.createElement('div');

  return {
    ResponsiveContainer: MockChart,
    AreaChart: MockChart,
    Area: MockPrimitive,
    CartesianGrid: MockPrimitive,
    XAxis: MockPrimitive,
    YAxis: MockPrimitive,
    Tooltip: MockPrimitive,
    LineChart: MockChart,
    Line: MockPrimitive,
  };
});

const DashboardV2 = (await import('@/app/v2/page')).default;

describe('/v2 page', () => {
  it('links the dashboard shell to the marketplace ops console', () => {
    const html = renderToStaticMarkup(React.createElement(DashboardV2));

    expect(html).toContain('/v2/marketplace');
    expect(html).toContain('Marketplace');
  });
});
