import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocsSidebar from '@/components/DocsSidebar';
import TableOfContents from '@/components/TableOfContents';

// During Vercel build: process.cwd() = /vercel/path0/website/
// So ../docs = /vercel/path0/docs/ (full repo is cloned)
const DOCS_ROOT = path.join(process.cwd(), '../docs');

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

function safeResolveDocPath(slug?: string[]) {
  const joined = (slug ?? []).join('/');
  const normalized = joined || 'README.md';
  const withExtension = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  const resolved = path.resolve(DOCS_ROOT, withExtension);

  if (!resolved.startsWith(DOCS_ROOT)) return null;

  return { resolved, relativePath: withExtension };
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Documentation';
}

async function getAllMarkdownFiles(dir: string, base = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const subFiles = await getAllMarkdownFiles(path.join(dir, entry.name), relativePath);
      files.push(...subFiles);
    } else if (entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }
  return files;
}

export async function generateStaticParams() {
  const files = await getAllMarkdownFiles(DOCS_ROOT);

  return files.map((file) => {
    const withoutExt = file.replace(/\.md$/, '');
    if (withoutExt === 'README') return { slug: [] };
    return { slug: withoutExt.split('/') };
  });
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
        <div className="mx-auto max-w-4xl xl:max-w-5xl">
          <div className="mb-6 flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
            <div className="flex-1 w-full">
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-1.5">
                SentinAI Docs
              </p>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 break-words leading-tight">
                {title}
              </h1>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Link
                href="/"
                className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
              >
                ← Home
              </Link>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row gap-6">
            <article className="flex-1 rounded-xl border border-slate-200 bg-white px-6 py-5 sm:px-8 sm:py-6 shadow-sm overflow-hidden">
              <MarkdownRenderer content={content} skipFirstH1 />
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
