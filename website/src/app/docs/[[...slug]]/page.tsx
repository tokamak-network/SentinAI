import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocsSidebar from '@/components/DocsSidebar';
import TableOfContents from '@/components/TableOfContents';
import { buildDocsNav, flattenNav, type DocNavSection } from '@/lib/docs-nav';

// During Vercel build: process.cwd() = /vercel/path0/website/
// So ../docs = /vercel/path0/docs/ (full repo is cloned)
const DOCS_ROOT = path.join(process.cwd(), '../docs');

// Emoji per top-level section (falls back to a generic doc icon).
const SECTION_EMOJI: Record<string, string> = {
  Overview: '🚀',
  Guide: '📖',
  Reference: '📚',
  Proposals: '🧪',
};

// ============================================================================
// Docs landing page (shown when /docs is visited with no slug)
// ============================================================================

function DocsLandingPage({ nav }: { nav: DocNavSection[] }) {
  const firstDoc = flattenNav(nav)[0];
  return (
    <div className="flex min-h-screen">
      <DocsSidebar nav={nav} />
      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-10 lg:ml-0">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">
              SentinAI Docs
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">
              Documentation
            </h1>
            <p className="text-slate-500 text-base mb-6 max-w-xl">
              Autonomous monitoring and auto-scaling for L2 blockchain nodes.
            </p>
            {firstDoc && (
              <div className="flex gap-3 flex-wrap">
                <Link
                  href={firstDoc.href}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Get Started →
                </Link>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {nav.map((section) => (
              <div
                key={section.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">{SECTION_EMOJI[section.title] ?? '📄'}</span>
                  <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                </div>
                <ul className="space-y-1.5">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-blue-600 hover:text-blue-500 hover:underline transition-colors"
                      >
                        {item.title} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

// Try multiple candidate paths for a slug (handles directory-level slugs)
async function readDocFile(slug?: string[]): Promise<string | null> {
  const joined = (slug ?? []).join('/');
  const candidates = joined
    ? [
        joined.endsWith('.md') ? joined : `${joined}.md`,
        `${joined}/README.md`,
        `${joined}/overview.md`,
      ]
    : ['README.md'];

  for (const candidate of candidates) {
    const resolved = path.resolve(DOCS_ROOT, candidate);
    if (!resolved.startsWith(DOCS_ROOT)) return null;
    try {
      return await fs.readFile(resolved, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
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
    // Expose directory README.md files as directory-level slugs too
    if (withoutExt.endsWith('/README')) {
      return { slug: withoutExt.replace('/README', '').split('/') };
    }
    return { slug: withoutExt.split('/') };
  });
}

function buildBreadcrumbs(slug: string[], title: string) {
  const crumbs: { label: string; href?: string }[] = [{ label: 'Docs', href: '/docs' }];
  // Intermediate directory crumbs are non-clickable: docs/<dir> has no index page.
  if (slug[0] === 'guide') crumbs.push({ label: 'Guide' });
  else if (slug[0] === 'spec') crumbs.push({ label: 'Spec' });
  else if (slug[0] === 'verification') crumbs.push({ label: 'Verification' });
  crumbs.push({ label: title });
  return crumbs;
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params;
  const nav = await buildDocsNav();

  // Show landing page when no slug provided
  if (!slug || slug.length === 0) {
    return <DocsLandingPage nav={nav} />;
  }

  const content = await readDocFile(slug);
  if (!content) notFound();

  const title = extractTitle(content);
  const currentHref = `/docs/${slug.join('/')}`;
  const flat = flattenNav(nav);
  const navIdx = flat.findIndex((n) => n.href === currentHref);
  const prevPage = navIdx > 0 ? flat[navIdx - 1] : null;
  const nextPage = navIdx >= 0 && navIdx < flat.length - 1 ? flat[navIdx + 1] : null;
  const breadcrumbs = buildBreadcrumbs(slug, title);

  return (
    <div className="flex min-h-screen">
      <DocsSidebar nav={nav} />

      <main className="flex-1 px-3 sm:px-4 lg:px-10 py-8 lg:ml-0">
        <div className="mx-auto max-w-4xl xl:max-w-5xl">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-4" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-300">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-slate-700 transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-700">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>

          {/* Page title */}
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 break-words leading-tight mb-6">
            {title}
          </h1>

          {/* Content + TOC */}
          <div className="flex flex-col lg:flex-row gap-8">
            <article className="flex-1 min-w-0">
              <MarkdownRenderer content={content} skipFirstH1 />

              {/* Prev / Next navigation */}
              {(prevPage || nextPage) && (
                <div className="flex items-center justify-between gap-4 mt-12 pt-6 border-t border-slate-200">
                  {prevPage ? (
                    <Link
                      href={prevPage.href}
                      className="group flex flex-col items-start gap-0.5 max-w-[45%]"
                    >
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Previous</span>
                      <span className="text-sm font-medium text-blue-600 group-hover:text-blue-500 transition-colors">
                        ← {prevPage.title}
                      </span>
                    </Link>
                  ) : (
                    <div />
                  )}
                  {nextPage ? (
                    <Link
                      href={nextPage.href}
                      className="group flex flex-col items-end gap-0.5 max-w-[45%]"
                    >
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Next</span>
                      <span className="text-sm font-medium text-blue-600 group-hover:text-blue-500 transition-colors">
                        {nextPage.title} →
                      </span>
                    </Link>
                  ) : (
                    <div />
                  )}
                </div>
              )}
            </article>

            <div className="lg:w-52 lg:flex-shrink-0">
              <TableOfContents content={content} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
