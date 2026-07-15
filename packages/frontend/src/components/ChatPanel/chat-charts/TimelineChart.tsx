import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { ChartTimelinePoint } from './types';

/**
 * Vertical timeline chart - a value over time. Each point is one row
 * [date | bar | value], and between consecutive rows a connector shows the
 * day gap so the reader sees both "how much" and "how long between" in one
 * card. Bars normalize against the largest realized value; a null value (an
 * upcoming, not-yet-realized point) renders a muted "scheduled" pill. The gap
 * is computed from the two ISO dates here, so the LLM payload stays date +
 * value.
 */

const TONE_BAR: Record<NonNullable<ChartTimelinePoint['tone']>, string> = {
  ok: 'bg-blue-500',
  warn: 'bg-amber-400',
  danger: 'bg-rose-500',
};

const TONE_TEXT: Record<NonNullable<ChartTimelinePoint['tone']>, string> = {
  ok: 'text-slate-800 dark:text-slate-100',
  warn: 'text-amber-600 dark:text-amber-400 font-semibold',
  danger: 'text-rose-600 dark:text-rose-400 font-bold',
};

export function TimelineChart({
  title,
  subtitle,
  note,
  unit = '',
  series,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  unit?: string;
  series: ChartTimelinePoint[];
}) {
  const { t } = useTranslation();
  const realized = series
    .map((p) => p.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  // Fallback to 1 so an all-pending timeline still renders rows.
  const barMax = Math.max(...realized, 1);

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
      <div className="px-3 py-2">
        {series.map((point, i) => {
          const next = series[i + 1];
          const gap = next ? dayGap(point.date, next.date) : null;
          const hasValue =
            typeof point.value === 'number' && Number.isFinite(point.value);
          const tone = point.tone ?? 'ok';
          const pct = hasValue
            ? Math.max(0, Math.min(1, (point.value as number) / barMax)) * 100
            : 0;
          return (
            <div key={`${point.date}-${i}`}>
              <div className="grid grid-cols-[80px_1fr_auto] items-center gap-2 text-[11px]">
                <span
                  className="font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400"
                  title={point.date}
                >
                  {formatDate(point.date)}
                </span>
                <div className="relative h-2 rounded-full bg-slate-100 dark:bg-white/10">
                  {hasValue ? (
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500 ease-out',
                        TONE_BAR[tone],
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  ) : null}
                </div>
                <span className="flex items-center justify-end gap-1 text-right">
                  {hasValue ? (
                    <span
                      className={cn(
                        'font-mono tabular-nums leading-none',
                        TONE_TEXT[tone],
                      )}
                    >
                      {formatNumber(point.value as number)}
                      {unit ? (
                        <span className="ml-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                          {unit}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="rounded-sm bg-slate-100 dark:bg-white/10 px-1 py-px text-[9.5px] text-slate-400 dark:text-slate-500">
                      {t('chat.chart.scheduled', 'Scheduled')}
                    </span>
                  )}
                  {point.tag ? (
                    <span
                      className={cn(
                        'rounded-sm px-1 py-px text-[9px] font-semibold',
                        tone === 'danger'
                          ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                          : tone === 'warn'
                            ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500',
                      )}
                    >
                      {point.tag}
                    </span>
                  ) : null}
                </span>
              </div>
              {next ? (
                <div className="flex items-center gap-2 py-0.5 pl-4">
                  <span
                    aria-hidden
                    className="h-3 w-px bg-slate-200 dark:bg-slate-700"
                  />
                  {gap !== null ? (
                    <span className="text-[9.5px] text-slate-400 dark:text-slate-500">
                      {t('chat.chart.dayGap', '{{count}}d gap', { count: gap })}
                    </span>
                  ) : null}
                </div>
              ) : null}
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

/** Whole-day gap between two ISO "YYYY-MM-DD" dates, or null if either fails
 *  to parse. Parsed as UTC midnight so DST shifts can't round the difference. */
function dayGap(a: string, b: string): number | null {
  const da = parseIsoDay(a);
  const db = parseIsoDay(b);
  if (da === null || db === null) return null;
  return Math.round((db - da) / 86_400_000);
}

function parseIsoDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Normalize an ISO date to "YYYY-MM-DD" (dropping any time suffix); non-ISO
 *  strings pass through unchanged. */
function formatDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
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
