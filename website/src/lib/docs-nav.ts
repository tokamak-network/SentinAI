import fs from 'node:fs/promises';
import path from 'node:path';

// During Vercel build: process.cwd() = website/, so ../docs = repo/docs.
const DOCS_ROOT = path.join(process.cwd(), '../docs');

export interface DocNavItem {
  title: string;
  href: string;
}

export interface DocNavSection {
  title: string;
  items: DocNavItem[];
}

// Section label + display order keyed by top-level docs/ directory.
// Unknown sections sort alphabetically after these.
const SECTION_ORDER = ['Overview', 'Guide', 'Reference', 'Proposals'];

function sectionForFile(relPath: string): string {
  const top = relPath.includes('/') ? relPath.split('/')[0] : '';
  if (top === '') return 'Overview'; // root-level docs/*.md
  if (top === 'guide') return 'Guide';
  if (top === 'todo') return 'Proposals';
  return top.charAt(0).toUpperCase() + top.slice(1); // Title-case unknown dirs
}

async function readAllMarkdown(dir: string, base = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await readAllMarkdown(path.join(dir, entry.name), rel)));
    } else if (entry.name.endsWith('.md') && entry.name !== 'CLAUDE.md') {
      out.push(rel);
    }
  }
  return out;
}

function fallbackTitle(relPathNoExt: string): string {
  const base = relPathNoExt.split('/').pop() || relPathNoExt;
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleFromContent(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/**
 * Build the docs navigation tree by scanning docs/ at build time.
 * The filesystem is the single source of truth — no hardcoded link lists.
 */
export async function buildDocsNav(): Promise<DocNavSection[]> {
  const files = await readAllMarkdown(DOCS_ROOT);
  const bySection = new Map<string, DocNavItem[]>();

  for (const file of files) {
    const noExt = file.replace(/\.md$/, '');
    if (noExt === 'README') continue; // root README is the /docs landing itself
    const href = '/docs/' + noExt.replace(/\/README$/, '');
    let title = fallbackTitle(noExt);
    try {
      title = titleFromContent(await fs.readFile(path.join(DOCS_ROOT, file), 'utf8'), title);
    } catch {
      // keep fallback title
    }
    const section = sectionForFile(file);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push({ title, href });
  }

  for (const items of bySection.values()) {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  return [...bySection.entries()]
    .map(([title, items]) => ({ title, items }))
    .sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a.title);
      const bi = SECTION_ORDER.indexOf(b.title);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.title.localeCompare(b.title);
    });
}

/** Flat, ordered item list used for prev/next page navigation. */
export function flattenNav(sections: DocNavSection[]): DocNavItem[] {
  return sections.flatMap((s) => s.items);
}
