'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface DocSearchProps {
  className?: string;
}

interface SearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export default function DocSearch({ className = '' }: DocSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const searchDocs = async () => {
      setIsLoading(true);
      try {
        // Simple client-side search (can be replaced with server-side later)
        const mockResults: SearchResult[] = [
          {
            path: '/docs/guide/quickstart',
            title: 'Quick Start',
            excerpt: 'Get SentinAI running locally in under 5 minutes...',
            score: 1.0,
          },
          {
            path: '/docs/guide/troubleshooting',
            title: 'Troubleshooting Guide',
            excerpt: 'Common issues and solutions when running SentinAI...',
            score: 0.9,
          },
          {
            path: '/docs/guide/setup',
            title: 'Setup Guide',
            excerpt: 'Quick Start (Local Development) npm install...',
            score: 0.8,
          },
        ].filter(
          (r) =>
            r.title.toLowerCase().includes(query.toLowerCase()) ||
            r.excerpt.toLowerCase().includes(query.toLowerCase())
        );

        setResults(mockResults);
        setIsOpen(mockResults.length > 0);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(searchDocs, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  function handleSelect(path: string) {
    router.push(path);
    setIsOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={searchRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search docs..."
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pl-10 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <svg
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-2 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="max-h-96 overflow-y-auto p-2">
            {results.map((result, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(result.path)}
                className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <div className="font-medium text-slate-900">{result.title}</div>
                <div className="mt-1 text-sm text-slate-600 line-clamp-2">{result.excerpt}</div>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Press <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">ESC</kbd> to close
          </div>
        </div>
      )}

      {isOpen && query.trim() && results.length === 0 && !isLoading && (
        <div className="absolute z-50 mt-2 w-full rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-lg">
          No results found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
