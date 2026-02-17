/**
 * Daily Report HTML View Endpoint
 * Converts markdown report to styled HTML for browser viewing
 * GET /api/reports/daily/view?date=YYYY-MM-DD
 */

import { NextRequest, NextResponse } from 'next/server';
import { readExistingReport } from '@/lib/daily-report-generator';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// Frontmatter Parser
// ============================================================

function parseFrontmatter(markdown: string): { meta: Record<string, string>; content: string } {
  const meta: Record<string, string> = {};
  const lines = markdown.split('\n');

  if (lines[0]?.trim() !== '---') return { meta, content: markdown };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
    const match = lines[i].match(/^(\w+):\s*(.+)$/);
    if (match) meta[match[1]] = match[2].trim();
  }

  if (endIdx === -1) return { meta, content: markdown };
  return { meta, content: lines.slice(endIdx + 1).join('\n').trim() };
}

// ============================================================
// Inline Formatting
// ============================================================

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyInlineFormatting(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
  result = result.replace(/`(.*?)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-blue-300">$1</code>');
  return result;
}

// ============================================================
// Line-Based Markdown-to-HTML Converter
// ============================================================

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];

  let i = 0;
  let paraBuffer: string[] = [];

  function flushParagraph() {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join('<br />');
    output.push(`<p class="my-3 text-gray-300 leading-relaxed">${applyInlineFormatting(text)}</p>`);
    paraBuffer = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line → flush paragraph
    if (trimmed === '') {
      flushParagraph();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      output.push('<hr class="my-8 border-gray-700/50" />');
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const text = applyInlineFormatting(escapeHtml(headingMatch[2]));
      if (level === 1) {
        output.push(`<h1 class="text-3xl font-bold text-white mb-4 mt-2">${text}</h1>`);
      } else if (level === 2) {
        output.push(`<h2 class="text-xl font-bold text-white mt-10 mb-4 pb-3 border-b border-gray-700/50 flex items-center gap-2"><span class="w-1 h-5 bg-blue-500 rounded-full inline-block"></span>${text}</h2>`);
      } else {
        output.push(`<h3 class="text-base font-bold text-gray-200 mt-6 mb-2">${text}</h3>`);
      }
      i++;
      continue;
    }

    // Table block
    if (trimmed.startsWith('|')) {
      flushParagraph();
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableRows.push(lines[i].trim());
        i++;
      }

      if (tableRows.length >= 2) {
        const headerCells = tableRows[0].split('|').filter(c => c.trim());
        // Check if row 1 is separator
        const isSeparator = (row: string) => /^\|[\s\-:|]+\|$/.test(row);
        const startRow = isSeparator(tableRows[1]) ? 2 : 1;

        let tableHtml = '<div class="overflow-x-auto my-4"><table class="w-full text-sm">';
        // Header
        tableHtml += '<thead><tr>';
        for (const cell of headerCells) {
          tableHtml += `<th class="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400 bg-white/5 border-b border-gray-700">${applyInlineFormatting(escapeHtml(cell.trim()))}</th>`;
        }
        tableHtml += '</tr></thead>';
        // Body
        tableHtml += '<tbody>';
        for (let r = startRow; r < tableRows.length; r++) {
          if (isSeparator(tableRows[r])) continue;
          const cells = tableRows[r].split('|').filter(c => c.trim());
          const rowClass = r % 2 === 0 ? 'bg-white/[0.02]' : '';
          tableHtml += `<tr class="${rowClass} hover:bg-white/5 transition-colors">`;
          for (const cell of cells) {
            let cellHtml = applyInlineFormatting(escapeHtml(cell.trim()));
            // Status badges inside table cells
            cellHtml = cellHtml.replace(/\bNormal\b/g, '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Normal</span>');
            cellHtml = cellHtml.replace(/\bCaution\b/g, '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">Caution</span>');
            cellHtml = cellHtml.replace(/\bCritical\b/g, '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">Critical</span>');
            tableHtml += `<td class="px-4 py-2.5 text-gray-300 border-b border-gray-800/50">${cellHtml}</td>`;
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table></div>';
        output.push(tableHtml);
      }
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      const quoteHtml = quoteLines.map(l => applyInlineFormatting(escapeHtml(l))).join('<br />');
      output.push(`<blockquote class="my-4 pl-4 border-l-2 border-blue-500/50 text-gray-400 italic">${quoteHtml}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*]\s/.test(line)) {
      flushParagraph();
      const listItems: string[] = [];
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, '');
        listItems.push(applyInlineFormatting(escapeHtml(itemText)));
        i++;
      }
      output.push('<ul class="my-3 space-y-1.5">');
      for (const item of listItems) {
        output.push(`<li class="flex gap-2 text-gray-300"><span class="text-blue-400/60 mt-1.5 shrink-0">&#8226;</span><span>${item}</span></li>`);
      }
      output.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
        listItems.push(applyInlineFormatting(escapeHtml(itemText)));
        i++;
      }
      output.push('<ol class="my-3 space-y-1.5">');
      listItems.forEach((item, idx) => {
        output.push(`<li class="flex gap-2 text-gray-300"><span class="text-blue-400 font-mono text-sm shrink-0 w-5 text-right">${idx + 1}.</span><span>${item}</span></li>`);
      });
      output.push('</ol>');
      continue;
    }

    // Regular text → accumulate for paragraph
    paraBuffer.push(applyInlineFormatting(escapeHtml(trimmed)));
    i++;
  }

  flushParagraph();
  return output.join('\n');
}

// ============================================================
// Date Navigation Helpers
// ============================================================

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// ============================================================
// Route Handler
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date parameter required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const markdown = await readExistingReport(date);
    if (!markdown) {
      return NextResponse.json(
        { success: false, error: `No report found for ${date}` },
        { status: 404 }
      );
    }

    const { meta, content } = parseFrontmatter(markdown);
    const html = markdownToHtml(content);

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME || 'L2 Network';
    const prevDate = offsetDate(date, -1);
    const nextDate = offsetDate(date, 1);
    const generatedAt = meta.generated ? new Date(meta.generated).toLocaleString('en-US', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }) : '';
    const generator = meta.generator || 'unknown';

    const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Report — ${date} | SentinAI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    code { white-space: pre-wrap; word-break: break-word; }
    table { table-layout: auto; }
    table td, table th { word-break: break-word; }
    @media print {
      body { background: white !important; color: #1a1a1a !important; }
      .no-print { display: none !important; }
      .print-light { background: white !important; color: #1a1a1a !important; border-color: #e5e7eb !important; }
      .print-light h1, .print-light h2, .print-light h3 { color: #1a1a1a !important; }
      .print-light p, .print-light li, .print-light td, .print-light th { color: #374151 !important; }
    }
  </style>
</head>
<body class="bg-[#0F1117] text-gray-200 min-h-screen">
  <div class="max-w-4xl mx-auto px-4 py-8">

    <!-- Navigation Bar -->
    <nav class="flex items-center justify-between mb-6 no-print">
      <a href="${basePath}/api/reports/daily/view?date=${prevDate}"
         class="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-white/5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        ${prevDate}
      </a>
      <a href="${basePath}/"
         class="text-sm text-gray-500 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-white/5">
        Dashboard
      </a>
      <a href="${basePath}/api/reports/daily/view?date=${nextDate}"
         class="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-white/5">
        ${nextDate}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </a>
    </nav>

    <!-- Report Card -->
    <article class="bg-[#1A1D21] rounded-2xl border border-gray-800 shadow-2xl overflow-hidden print-light">

      <!-- Header -->
      <div class="px-8 pt-8 pb-6 border-b border-gray-800">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p class="text-blue-400 text-sm font-semibold tracking-wide uppercase mb-1">Daily Operations Report</p>
            <h1 class="text-3xl font-bold text-white">${date}</h1>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            ${generatedAt ? `<span class="text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-lg border border-gray-800">${generatedAt}</span>` : ''}
            <span class="text-[11px] font-mono text-gray-500 bg-white/5 px-3 py-1.5 rounded-lg border border-gray-800">${generator}</span>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="px-8 py-6">
        ${html}
      </div>

      <!-- Footer -->
      <div class="px-8 py-5 border-t border-gray-800 text-center">
        <p class="text-xs text-gray-600">SentinAI — ${networkName} Monitoring &amp; Auto-Scaling</p>
      </div>
    </article>

  </div>
</body>
</html>`;

    return new NextResponse(page, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/reports/daily/view error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
