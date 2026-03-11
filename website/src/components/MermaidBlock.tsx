'use client';
import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

export default function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg: renderedSvg }) => setSvg(renderedSvg))
      .catch(() => setError(true));
  }, [chart, id]);

  if (error) {
    return (
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto my-6 text-sm">
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return <div className="my-6 h-32 bg-slate-100 animate-pulse rounded-lg" />;
  }

  return (
    <div
      ref={ref}
      className="my-6 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
