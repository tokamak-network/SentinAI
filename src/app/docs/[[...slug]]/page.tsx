import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocsSidebar from '@/components/DocsSidebar';
import TableOfContents from '@/components/TableOfContents';

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
    <div className="flex min-h-screen">
      <DocsSidebar />
      
      <main className="flex-1 px-3 sm:px-4 lg:px-6 py-8 lg:ml-0">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-6 flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
            <div className="flex-1 w-full">
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-1.5">SentinAI Docs</p>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 break-words leading-tight">{title}</h1>
              <p className="text-xs text-slate-500 mt-1 break-all">{target.relativePath}</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Link href="/" className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors">
                ← Landing
              </Link>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row gap-6">
            <article className="flex-1 rounded-xl border border-slate-200 bg-white px-6 py-5 sm:px-8 sm:py-6 shadow-sm overflow-hidden">
              <MarkdownRenderer content={content} />
            </article>
            
            <div className="xl:w-52">
              <TableOfContents content={content} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
