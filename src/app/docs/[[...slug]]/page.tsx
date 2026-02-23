import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocSearch from '@/components/DocSearch';

type PageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

const DOCS_ROOT = path.join(process.cwd(), 'docs');

function safeResolveDocPath(slug?: string[]) {
  const joined = (slug ?? []).join('/');
  const normalized = joined || 'README.md';
  const withExtension = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  const resolved = path.resolve(DOCS_ROOT, withExtension);

  if (!resolved.startsWith(DOCS_ROOT)) {
    return null;
  }

  return { resolved, relativePath: withExtension };
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Documentation';
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params;
  const target = safeResolveDocPath(slug);

  if (!target) notFound();

  let content = '';
  try {
    content = await fs.readFile(target.resolved, 'utf8');
  } catch {
    notFound();
  }

  const title = extractTitle(content);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-6">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">SentinAI Docs</p>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">{target.relativePath}</p>
        </div>
        <div className="flex items-center gap-3">
          <DocSearch className="w-64" />
          <Link href="/" className="whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
            ← Landing
          </Link>
        </div>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <MarkdownRenderer content={content} />
      </article>
    </main>
  );
}
