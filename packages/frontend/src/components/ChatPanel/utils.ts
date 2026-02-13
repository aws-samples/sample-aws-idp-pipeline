import DOMPurify from 'isomorphic-dompurify';
import type { WebSearchResult, FetchContentPreview } from './types';
export { formatFileSize, getFileTypeInfo } from '../../lib/fileTypeUtils';

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
    .replace(/<\/p>\s*<p>/gi, '\n\n');
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/<(?!\/?(?:strong|em))[^>]*>/g, '');
  }

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
