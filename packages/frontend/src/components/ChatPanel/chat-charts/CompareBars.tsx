import { cn } from '../../../lib/utils';
import type { ChartCompareRow } from './types';

/**
 * Side-by-side compare chart - one row per metric, N bars per row. The bar
 * widths within a row normalize against that row's largest value so
 * cross-metric comparison stays visually fair.
 */

const TONE_CLASS: Record<
  NonNullable<ChartCompareRow['values'][number]['tone']>,
  string
> = {
  ok: 'bg-blue-500',
  warn: 'bg-amber-400',
  danger: 'bg-rose-500',
};

const SERIES_PALETTE = [
  'bg-sky-400',
  'bg-violet-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-rose-400',
];

export function CompareBars({
  title,
  subtitle,
  note,
  series,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  series: ChartCompareRow[];
}) {
  // Collect unique series names from all rows for a stable legend.
  const legend: string[] = [];
  for (const row of series) {
    for (const v of row.values) {
      if (!legend.includes(v.name)) legend.push(v.name);
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      <header className="border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold leading-tight text-slate-800 dark:text-slate-100">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
                {subtitle}
              </div>
            ) : null}
          </div>
          {legend.length > 1 ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {legend.map((name, i) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400"
                >
                  <span
                    className={cn(
                      'inline-block h-2 w-2 rounded-sm',
                      SERIES_PALETTE[i % SERIES_PALETTE.length],
                    )}
                  />
                  {name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      <div className="flex flex-col gap-2 px-3 py-2">
        {series.map((row, i) => {
          const rowMax = Math.max(...row.values.map((v) => v.value || 0), 1);
          return (
            <div key={`${row.label}-${i}`} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="font-semibold text-slate-500 dark:text-slate-400">
                  {row.label}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {row.values.map((v, idx) => {
                  const pct = Math.max(0, Math.min(1, v.value / rowMax)) * 100;
                  // Tone wins over the legend palette so danger/warn rows
                  // stand out even in a multi-series chart.
                  const cls = v.tone
                    ? TONE_CLASS[v.tone]
                    : SERIES_PALETTE[
                        legend.indexOf(v.name) %
                          Math.max(SERIES_PALETTE.length, 1)
                      ] || 'bg-blue-500';
                  return (
                    <div
                      key={`${v.name}-${idx}`}
                      className="grid grid-cols-[60px_1fr_80px] items-center gap-2"
                    >
                      <span
                        className="truncate text-[10px] text-slate-400 dark:text-slate-500"
                        title={v.name}
                      >
                        {v.name}
                      </span>
                      <div className="relative h-2 rounded-full bg-slate-100 dark:bg-white/10">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-500 ease-out',
                            cls,
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-right font-mono text-[10.5px] tabular-nums leading-none',
                          v.tone === 'danger'
                            ? 'text-rose-600 dark:text-rose-400 font-bold'
                            : v.tone === 'warn'
                              ? 'text-amber-600 dark:text-amber-400 font-semibold'
                              : 'text-slate-800 dark:text-slate-100',
                        )}
                      >
                        {formatNumber(v.value)}
                        {row.unit ? (
                          <span className="ml-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                            {row.unit}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
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

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1,
    });
  }
  return n.toFixed(2);
}
