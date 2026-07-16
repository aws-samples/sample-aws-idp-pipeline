import { cn } from '../../../lib/utils';
import type { ChartBarRow } from './types';

/**
 * Horizontal-bar chart card - one bar per metric, value compared against an
 * optional cap. Pure CSS, no charting deps. Embedded inside an assistant
 * message right after the prose summary so the number AND the visual read at
 * one glance.
 */

const TONE_CLASS: Record<NonNullable<ChartBarRow['tone']>, string> = {
  ok: 'bg-blue-500',
  warn: 'bg-amber-400',
  danger: 'bg-rose-500',
};

export function HBarChart({
  title,
  subtitle,
  note,
  series,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  series: ChartBarRow[];
}) {
  // Fallback scale when no row carries a `max`: largest value renders
  // full-width and the rest scale proportionally.
  const fallbackMax = Math.max(...series.map((s) => s.value || 0), 1);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      <header className="border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5">
        <div className="text-[12px] font-bold leading-tight text-slate-800 dark:text-slate-100">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
            {subtitle}
          </div>
        ) : null}
      </header>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        {series.map((row, i) => {
          const cap = row.max && row.max > 0 ? row.max : fallbackMax;
          const pct = Math.max(0, Math.min(1, (row.value || 0) / cap)) * 100;
          const tone =
            row.tone ?? (row.max && row.value > row.max ? 'danger' : 'ok');
          return (
            <div
              key={`${row.label}-${i}`}
              className="grid grid-cols-[64px_1fr_80px] items-center gap-2 text-[11px]"
            >
              <span
                className="truncate text-slate-500 dark:text-slate-400"
                title={row.label}
              >
                {row.label}
              </span>
              <div className="relative h-2 rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500 ease-out',
                    TONE_CLASS[tone],
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={cn(
                  'text-right font-mono tabular-nums leading-none',
                  tone === 'danger'
                    ? 'text-rose-600 dark:text-rose-400 font-bold'
                    : tone === 'warn'
                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : 'text-slate-800 dark:text-slate-100',
                )}
                title={
                  row.max ? `${row.value} / ${row.max}` : String(row.value)
                }
              >
                {formatNumber(row.value)}
                {row.unit ? (
                  <span className="ml-0.5 text-[9.5px] text-slate-400 dark:text-slate-500">
                    {row.unit}
                  </span>
                ) : null}
                {row.max ? (
                  <span className="ml-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                    /{formatNumber(row.max)}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {note ? (
        <footer className="border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 px-3 py-1 text-[9.5px] text-slate-400 dark:text-slate-500">
          {note}
        </footer>
      ) : null}
    </div>
  );
}

/** Compact number formatting - keeps mid-range values readable ("1,800" not
 *  "1800") while shortening large values ("12k" not "12000"). */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1,
    });
  }
  return n.toFixed(2);
}
