import { FileText } from 'lucide-react';

/** Parse message content and render artifact/document references as chips */
export const renderMessageWithMentions = (content: string) => {
  const mentionPattern = /\[(artifact|document):([^\]]+)\]\(([^)]+)\)/g;
  const parts: (
    | string
    | { type: 'artifact' | 'document'; id: string; filename: string }
  )[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push({
      type: match[1] as 'artifact' | 'document',
      id: match[2],
      filename: match[3],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  if (parts.length === 1 && typeof parts[0] === 'string') {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        if (typeof part === 'string') {
          return <span key={index}>{part}</span>;
        }
        const isDocument = part.type === 'document';
        return (
          <span
            key={index}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-xs font-medium align-middle ${
              isDocument
                ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                : 'bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300'
            }`}
            title={part.id}
          >
            {isDocument ? (
              <FileText className="w-3 h-3" />
            ) : (
              <svg
                className="w-3 h-3 text-violet-500 dark:text-violet-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
                <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
                <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
              </svg>
            )}
            <span className="max-w-24 truncate">{part.filename}</span>
          </span>
        );
      })}
    </span>
  );
};
