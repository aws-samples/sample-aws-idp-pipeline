import type { ChartScatterPoint } from './types';

/**
 * Scatter chart card - points on an X/Y plane to show the correlation between
 * two numeric variables. Pure SVG: points are normalized against the data's
 * min/max on each axis, with light gridlines and axis labels. No charting deps.
 */

const TONE_HEX: Record<NonNullable<ChartScatterPoint['tone']>, string> = {
  ok: '#3b82f6', // blue-500
  warn: '#f59e0b', // amber-500
  danger: '#ef4444', // rose-500
};

// Viewbox geometry: leave margins for axis labels.
const W = 260;
const H = 160;
const PAD_L = 28;
const PAD_B = 22;
const PAD_T = 8;
const PAD_R = 8;

export function ScatterChart({
  title,
  subtitle,
  note,
  xLabel,
  yLabel,
  series,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  xLabel?: string;
  yLabel?: string;
  series: ChartScatterPoint[];
}) {
  const xs = series.map((p) => p.x).filter(Number.isFinite);
  const ys = series.map((p) => p.y).filter(Number.isFinite);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const px = (x: number) => PAD_L + ((x - xMin) / xSpan) * plotW;
  const py = (y: number) => PAD_T + (1 - (y - yMin) / ySpan) * plotH;

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
      <div className="px-2 py-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* Axes */}
          <line
            x1={PAD_L}
            y1={PAD_T}
            x2={PAD_L}
            y2={H - PAD_B}
            className="stroke-slate-200 dark:stroke-slate-600"
            strokeWidth="1"
          />
          <line
            x1={PAD_L}
            y1={H - PAD_B}
            x2={W - PAD_R}
            y2={H - PAD_B}
            className="stroke-slate-200 dark:stroke-slate-600"
            strokeWidth="1"
          />
          {/* Axis min/max ticks */}
          <text
            x={PAD_L}
            y={H - PAD_B + 12}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize="7"
            textAnchor="start"
          >
            {formatNumber(xMin)}
          </text>
          <text
            x={W - PAD_R}
            y={H - PAD_B + 12}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize="7"
            textAnchor="end"
          >
            {formatNumber(xMax)}
          </text>
          <text
            x={PAD_L - 3}
            y={H - PAD_B}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize="7"
            textAnchor="end"
          >
            {formatNumber(yMin)}
          </text>
          <text
            x={PAD_L - 3}
            y={PAD_T + 6}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize="7"
            textAnchor="end"
          >
            {formatNumber(yMax)}
          </text>
          {/* Points */}
          {series.map((p, i) =>
            Number.isFinite(p.x) && Number.isFinite(p.y) ? (
              <circle
                key={i}
                cx={px(p.x)}
                cy={py(p.y)}
                r="2.8"
                fill={p.tone ? TONE_HEX[p.tone] : '#3b82f6'}
                fillOpacity="0.7"
              >
                <title>
                  {p.label ? `${p.label}: ` : ''}
                  {`(${formatNumber(p.x)}, ${formatNumber(p.y)})`}
                </title>
              </circle>
            ) : null,
          )}
        </svg>
        {(xLabel || yLabel) && (
          <div className="mt-1 flex items-center justify-between px-1 text-[9px] text-slate-400 dark:text-slate-500">
            <span>{yLabel ? `↑ ${yLabel}` : ''}</span>
            <span>{xLabel ? `${xLabel} →` : ''}</span>
          </div>
        )}
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
