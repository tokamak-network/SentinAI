'use client';

import { useEffect, useMemo, useState } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  content: string;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  // Derive TOC items from content using useMemo instead of useEffect
  const toc = useMemo(() => {
    const headingRegex = /^(#{2,3})\s+(.+)$/gm;
    const items: TocItem[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');

      items.push({ id, text, level });
    }

    return items;
  }, [content]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px' }
    );

    const headings = document.querySelectorAll('h2, h3');
    headings.forEach((heading) => observer.observe(heading));

    return () => observer.disconnect();
  }, [toc]);

  if (toc.length === 0) return null;

  return (
    <nav className="sticky top-24 hidden xl:block">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        On this page
      </p>
      <ul className="space-y-2 text-sm">
        {toc.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'pl-4' : ''}>
            <a
              href={`#${item.id}`}
              className={`block transition-colors ${
                activeId === item.id
                  ? 'font-medium text-blue-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
