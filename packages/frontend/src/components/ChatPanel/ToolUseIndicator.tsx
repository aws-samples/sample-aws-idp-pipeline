import { Check, X } from 'lucide-react';
import { getToolUseIcon } from './toolRegistry';
import { formatToolDisplayName } from './utils';

interface ToolUseIndicatorProps {
  name: string;
  status?: 'running' | 'success' | 'error';
}

export default function ToolUseIndicator({
  name,
  status,
}: ToolUseIndicatorProps) {
  const isRunning = !status || status === 'running';
  const isSuccess = status === 'success';
  const Icon = getToolUseIcon(name);
  const label = formatToolDisplayName(name);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* Status icon */}
      <div
        className={`flex items-center justify-center w-4 h-4 flex-shrink-0 ${
          isRunning
            ? 'text-indigo-500 dark:text-indigo-400'
            : isSuccess
              ? 'text-indigo-400 dark:text-indigo-500'
              : 'text-red-500 dark:text-red-400'
        }`}
      >
        {isRunning ? (
          <Icon className="w-3.5 h-3.5" />
        ) : isSuccess ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </div>

      {/* Label with shimmer when running */}
      <span
        className={`text-sm ${
          isRunning
            ? 'shimmer-text-effect text-indigo-500 dark:text-indigo-400'
            : isSuccess
              ? 'text-indigo-400 dark:text-indigo-500'
              : 'text-red-600 dark:text-red-400'
        }`}
      >
        {label}
        {isRunning && ' ...'}
      </span>
    </div>
  );
}
