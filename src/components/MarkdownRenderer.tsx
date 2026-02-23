'use client';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:scroll-mt-20 prose-a:text-blue-600 hover:prose-a:text-blue-500 prose-code:text-sm prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-slate-900 prose-pre:text-slate-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          h1: ({ children }) => {
            const id = String(children)
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-');
            return (
              <h1 id={id} className="text-4xl font-bold text-slate-900 mb-6 mt-8 first:mt-0">
                {children}
              </h1>
            );
          },
          h2: ({ children }) => {
            const id = String(children)
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-');
            return (
              <h2 id={id} className="text-3xl font-semibold text-slate-800 mb-4 mt-8 border-b border-slate-200 pb-2">
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const id = String(children)
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-');
            return (
              <h3 id={id} className="text-2xl font-semibold text-slate-800 mb-3 mt-6">
                {children}
              </h3>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-blue-600 hover:text-blue-500 underline decoration-blue-200 hover:decoration-blue-400 transition-colors"
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className;
            return inline ? (
              <code
                className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto my-6">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 italic text-slate-600 my-6">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-6">
              <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 bg-slate-50 text-left text-sm font-semibold text-slate-700 border-b border-slate-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 text-sm text-slate-600 border-b border-slate-100">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
