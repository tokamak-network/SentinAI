/**
 * Daily Report HTML View Endpoint
 * Converts markdown report to styled HTML for browser viewing
 * GET /api/reports/daily/view?date=YYYY-MM-DD
 */

import { NextRequest, NextResponse } from 'next/server';
import { readExistingReport } from '@/lib/daily-report-generator';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML special characters
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 class="text-2xl font-bold mt-6 mb-3">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 class="text-3xl font-bold mb-4">$1</h1>');

  // Bold text
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');

  // Inline code
  html = html.replace(/`(.*?)`/g, '<code class="bg-gray-200 px-2 py-1 rounded font-mono text-sm">$1</code>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter((cell) => cell.trim());
    if (cells.length === 0) return match;

    const isHeader = cells.length > 0;
    const tag = isHeader ? 'th' : 'td';
    const cellHtml = cells
      .map((cell) => `<${tag} class="px-3 py-2 text-left border border-gray-300">${cell.trim()}</${tag}>`)
      .join('');
    return `<tr>${cellHtml}</tr>`;
  });

  // Wrap table rows in table tag
  if (html.includes('<tr>')) {
    html = html.replace(
      /(<tr>[\s\S]*?<\/tr>)/g,
      '<table class="w-full border-collapse border border-gray-300 my-4">$1</table>'
    );
  }

  // Unordered lists
  html = html.replace(/^[\s]*[-*] (.*?)$/gm, '<li class="ml-6">$1</li>');
  html = html.replace(/(<li[\s\S]*?<\/li>)/, '<ul class="list-disc my-3">$1</ul>');

  // Line breaks and paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-3">');
  html = html.replace(/\n/g, '<br />');
  html = `<p class="my-3">${html}</p>`;

  // Horizontal rules
  html = html.replace(/---/g, '<hr class="my-6 border-t-2 border-gray-300" />');

  // Emoji preservation
  html = html.replace(/&amp;#(\d+);/g, '&#$1;');

  return html;
}

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

    const html = markdownToHtml(markdown);

    // Return HTML page
    const page = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SentinAI Daily Report - ${date}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          }
          code {
            white-space: pre-wrap;
            word-break: break-word;
          }
          table {
            table-layout: auto;
          }
          table td, table th {
            word-break: break-word;
          }
        </style>
      </head>
      <body class="bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
        <div class="min-h-screen py-8 px-4">
          <div class="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8">
            <!-- Header -->
            <div class="border-b-2 border-blue-200 pb-6 mb-8">
              <div class="flex items-center justify-between">
                <div>
                  <h1 class="text-4xl font-bold text-blue-600 mb-2">SentinAI Daily Report</h1>
                  <p class="text-gray-600">Generated: ${date}</p>
                </div>
              </div>
            </div>

            <!-- Content -->
            <div class="prose prose-sm max-w-none text-slate-700 leading-relaxed">
              ${html}
            </div>

            <!-- Footer -->
            <div class="mt-12 pt-6 border-t border-gray-300 text-center text-sm text-gray-600">
              <p>🤖 SentinAI - Optimism L2 Node Monitoring & Auto-Scaling</p>
              <p class="mt-2">
                <a href="${process.env.NEXT_PUBLIC_BASE_PATH || '/'}" class="text-blue-600 hover:underline">
                  Back to Dashboard
                </a>
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return new NextResponse(page, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
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
