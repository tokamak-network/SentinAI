import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const readFileMock = vi.fn();
  const notFoundMock = vi.fn(() => {
    throw new Error('notFound');
  });
  const docSearchMock = vi.fn(() => React.createElement('div', null, 'DocSearch'));

  return {
    readFileMock,
    notFoundMock,
    docSearchMock,
  };
});

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: hoisted.readFileMock,
  },
}));

vi.mock('next/navigation', () => ({
  notFound: hoisted.notFoundMock,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

vi.mock('@/components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) =>
    React.createElement('div', { 'data-testid': 'markdown-renderer' }, content),
}));

vi.mock('@/components/DocsSidebar', () => ({
  default: () => React.createElement('aside', { 'data-testid': 'docs-sidebar' }),
}));

vi.mock('@/components/TableOfContents', () => ({
  default: ({ content }: { content: string }) =>
    React.createElement('nav', { 'data-testid': 'table-of-contents' }, content),
}));

vi.mock('@/components/DocSearch', () => ({
  default: hoisted.docSearchMock,
}));

function containsElementType(node: unknown, target: unknown): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  const element = node as {
    type?: unknown;
    props?: { children?: unknown };
  };

  if (element.type === target) {
    return true;
  }

  const children = element.props?.children;
  if (Array.isArray(children)) {
    return children.some((child) => containsElementType(child, target));
  }

  return containsElementType(children, target);
}

describe('DocsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.readFileMock.mockResolvedValue('# Setup Guide\n\nSentinAI docs body');
  });

  it('does not render the docs search UI in the docs header', async () => {
    const { default: DocsPage } = await import('@/app/docs/[[...slug]]/page');

    const element = await DocsPage({
      params: Promise.resolve({ slug: ['guide', 'setup'] }),
    });

    expect(containsElementType(element, hoisted.docSearchMock)).toBe(false);
  });
});
