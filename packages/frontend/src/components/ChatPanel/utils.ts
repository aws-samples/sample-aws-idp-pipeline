import DOMPurify from 'isomorphic-dompurify';
import type { LucideIcon } from 'lucide-react';
import { FileText, FileSpreadsheet, FileCode, File } from 'lucide-react';
import type { WebSearchResult, FetchContentPreview } from './types';

export const formatToolDisplayName = (rawName: string): string => {
  const base = rawName.split('___')[0];
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

export const parseWebSearchResults = (
  text: string,
): WebSearchResult[] | null => {
  if (!text.includes('search results')) return null;
  const results: WebSearchResult[] = [];
  const blocks = text.split(/\n\n\d+\.\s+/);
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n').map((l) => l.trim());
    const title = lines[0] || '';
    const urlLine = lines.find((l) => l.startsWith('URL:'));
    const summaryLine = lines.find((l) => l.startsWith('Summary:'));
    if (title && urlLine) {
      results.push({
        title,
        url: urlLine.replace('URL: ', ''),
        summary: summaryLine?.replace('Summary: ', '') || '',
      });
    }
  }
  return results.length > 0 ? results : null;
};

export const getDomainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
};

export const parseFetchContent = (text: string): FetchContentPreview | null => {
  if (!text || text.length < 50) return null;
  const lines = text.split('\n').filter((l) => l.trim());
  const title = lines[0]?.slice(0, 120) || '';
  const snippetLines = lines.slice(1, 6).join('\n');
  const snippet =
    snippetLines.length > 300
      ? snippetLines.slice(0, 300) + '...'
      : snippetLines;
  return { title, snippet };
};

export const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getFileTypeInfo = (
  filename: string,
): { icon: LucideIcon; color: string; bgColor: string } => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return {
        icon: FileText,
        color: 'text-red-500',
        bgColor: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'doc':
    case 'docx':
      return {
        icon: FileText,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      };
    case 'xls':
    case 'xlsx':
    case 'csv':
      return {
        icon: FileSpreadsheet,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
      };
    case 'html':
    case 'md':
      return {
        icon: FileCode,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      };
    case 'txt':
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
    default:
      return {
        icon: File,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100 dark:bg-slate-600',
      };
  }
};

/** Prepare content for markdown parsing */
export const prepareMarkdown = (content: string): string => {
  const entityMap: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  let result = content.replace(
    /&(?:lt|gt|amp|quot|nbsp|#39);/g,
    (match) => entityMap[match] ?? match,
  );

  result = result
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<(?!\/?(?:strong|em))[^>]*>/g, '');

  result = result.replace(/^[ \t]*[•●◦‣⁃]/gm, '-');

  result = result
    .replace(/\\\*/g, '___ESCAPED_ASTERISK___')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\`/g, '`')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']');

  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/___ESCAPED_ASTERISK___/g, '*');

  return DOMPurify.sanitize(result);
};
