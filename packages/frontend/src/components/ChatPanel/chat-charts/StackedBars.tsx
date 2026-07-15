import { cn } from '../../../lib/utils';
import type { ChartStackedRow } from './types';

/**
 * Vertical stacked-bar chart card - each label gets one bar split into named
 * segments stacked on top of each other. Bars normalize against the tallest
 * total so part-to-whole comparison across categories stays fair. Pure CSS/
 * flex, no charting deps.
 */

const TONE_CLASS: Record<
  NonNullable<ChartStackedRow['segments'][number]['tone']>,
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

const BAR_AREA_PX = 140;

export function StackedBars({
  title,
  subtitle,
  note,
  series,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  series: ChartStackedRow[];
}) {
  // Stable legend from the first appearance of each segment name.
  const legend: string[] = [];
  for (const row of series) {
    for (const seg of row.segments) {
      if (!legend.includes(seg.name)) legend.push(seg.name);
    }
  }
  const colorFor = (name: string, tone?: 'ok' | 'warn' | 'danger') =>
    tone
      ? TONE_CLASS[tone]
      : SERIES_PALETTE[legend.indexOf(name) % SERIES_PALETTE.length] ||
        'bg-blue-500';

  const maxTotal = Math.max(
    ...series.map((r) => r.segments.reduce((s, x) => s + (x.value || 0), 0)),
    1,
  );

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
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
      <div
        className="flex items-end justify-around gap-3 px-3 pt-3"
        style={{ height: BAR_AREA_PX + 24 }}
      >
        {series.map((row, i) => {
          const total = row.segments.reduce((s, x) => s + (x.value || 0), 0);
          const barH = (total / maxTotal) * BAR_AREA_PX;
          return (
            <div
              key={`${row.label}-${i}`}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <span className="font-mono text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                {formatNumber(total)}
              </span>
              <div
                className="flex w-full max-w-12 flex-col overflow-hidden rounded"
                style={{ height: barH }}
                title={`${row.label}: ${formatNumber(total)}`}
              >
                {row.segments.map((seg, si) => {
                  const h = total > 0 ? ((seg.value || 0) / total) * 100 : 0;
                  return (
                    <div
                      key={`${seg.name}-${si}`}
                      className={cn(colorFor(seg.name, seg.tone))}
                      style={{ height: `${h}%` }}
                      title={`${seg.name}: ${formatNumber(seg.value)}${row.unit ? ' ' + row.unit : ''}`}
                    />
                  );
                })}
              </div>
              <span
                className="max-w-full truncate text-[10px] text-slate-500 dark:text-slate-400"
                title={row.label}
              >
                {row.label}
              </span>
            </div>
          );
        })}
      </div>
      {note ? (
        <footer className="mt-1 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 px-3 py-1 text-[9.5px] text-slate-400 dark:text-slate-500">
          {note}
        </footer>
      ) : (
        <div className="h-2" />
      )}
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
