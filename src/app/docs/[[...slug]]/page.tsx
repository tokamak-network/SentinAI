import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';

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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">SentinAI Docs</p>
          <h1 className="text-2xl font-bold text-slate-900">{target.relativePath}</h1>
        </div>
        <Link href="/" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          ← Back to landing
        </Link>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{content}</pre>
      </article>
    </main>
  );
}
