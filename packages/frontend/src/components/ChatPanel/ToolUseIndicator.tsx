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
    <div
      className={`glass-panel relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border backdrop-blur-sm transition-all duration-500 overflow-hidden ${
        isRunning
          ? 'bg-[#e4eaf4]/80 dark:bg-white/[0.03] border-[#d0daeb] dark:border-white/10 shadow-sm'
          : isSuccess
            ? 'bg-emerald-50/80 dark:bg-emerald-500/[0.06] border-emerald-200/60 dark:border-emerald-500/20'
            : 'bg-red-50/80 dark:bg-red-500/[0.06] border-red-200/60 dark:border-red-500/20'
      }`}
    >
      {/* Icon badge */}
      <div
        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-500 ${
          isRunning
            ? 'bg-gradient-to-br from-slate-500 to-blue-500 dark:from-blue-500 dark:to-indigo-600 shadow-md shadow-slate-400/30 dark:shadow-blue-500/30'
            : isSuccess
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30'
              : 'bg-gradient-to-br from-red-500 to-rose-600 shadow-md shadow-red-500/30'
        }`}
      >
        {isRunning ? (
          <Icon className="w-3.5 h-3.5 text-white" />
        ) : isSuccess ? (
          <Check className="w-3.5 h-3.5 text-white" />
        ) : (
          <X className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      {/* Label */}
      <span
        className={`text-sm font-medium transition-colors duration-300 ${
          isRunning
            ? 'text-slate-700 dark:text-slate-200'
            : isSuccess
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-red-700 dark:text-red-300'
        }`}
      >
        {label}
      </span>

      <div className="flex-1" />

      {/* Bouncing dots */}
      {isRunning && (
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-500 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 dark:bg-indigo-400 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-500 animate-bounce [animation-delay:300ms]" />
        </span>
      )}

      {/* Shimmer bar at bottom */}
      {isRunning && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d0daeb] dark:bg-slate-700 overflow-hidden">
          <div className="shimmer-bar h-full w-1/3 bg-gradient-to-r from-slate-400 via-blue-400 to-slate-400 dark:from-blue-400 dark:via-indigo-400 dark:to-blue-400 rounded-full" />
        </div>
      )}
    </div>
  );
}
