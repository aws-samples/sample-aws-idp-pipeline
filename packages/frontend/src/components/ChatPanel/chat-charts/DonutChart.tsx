import type { ChartDonutSlice } from './types';

/**
 * Donut chart card - composition / share of a whole. Pure SVG: each slice is
 * an arc drawn with stroke-dasharray on a circle, the total sits in the center,
 * and a legend lists each category with its percentage. No charting deps.
 */

// Hex values (not Tailwind classes) because SVG stroke needs a concrete color.
const TONE_HEX: Record<NonNullable<ChartDonutSlice['tone']>, string> = {
  ok: '#3b82f6', // blue-500
  warn: '#f59e0b', // amber-500
  danger: '#ef4444', // rose-500
};

const PALETTE = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // rose-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
];

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({
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
  series: ChartDonutSlice[];
}) {
  const total = series.reduce((sum, s) => sum + (s.value || 0), 0) || 1;

  // Precompute each slice's color, fraction, and dash offset so the arcs sit
  // end-to-end around the ring.
  let acc = 0;
  const slices = series.map((s, i) => {
    const frac = (s.value || 0) / total;
    const color = s.tone ? TONE_HEX[s.tone] : PALETTE[i % PALETTE.length];
    const dash = frac * CIRCUMFERENCE;
    const offset = acc * CIRCUMFERENCE;
    acc += frac;
    return { ...s, frac, color, dash, offset };
  });

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
      <div className="flex items-center gap-4 px-3 py-3">
        <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              className="stroke-slate-100 dark:stroke-white/10"
              strokeWidth="12"
            />
            {slices.map((s, i) => (
              <circle
                key={`${s.label}-${i}`}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth="12"
                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                strokeDashoffset={-s.offset}
                className="transition-[stroke-dasharray] duration-500 ease-out"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-[13px] font-bold tabular-nums leading-none text-slate-800 dark:text-slate-100">
              {formatNumber(total)}
            </span>
            {unit ? (
              <span className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">
                {unit}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {slices.map((s, i) => (
            <div
              key={`${s.label}-legend-${i}`}
              className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span
                className="truncate text-slate-600 dark:text-slate-300"
                title={s.label}
              >
                {s.label}
              </span>
              <span className="text-right font-mono tabular-nums leading-none text-slate-800 dark:text-slate-100">
                {formatNumber(s.value)}
                <span className="ml-1 text-[9px] text-slate-400 dark:text-slate-500">
                  {(s.frac * 100).toFixed(1)}%
                </span>
              </span>
            </div>
          ))}
        </div>
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
