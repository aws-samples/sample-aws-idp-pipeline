import { HBarChart } from './HBarChart';
import { CompareBars } from './CompareBars';
import { TimelineChart } from './TimelineChart';
import { DonutChart } from './DonutChart';
import { StackedBars } from './StackedBars';
import { ScatterChart } from './ScatterChart';
import type {
  ChartBarRow,
  ChartCompareRow,
  ChartDonutSlice,
  ChartScatterPoint,
  ChartSpec,
  ChartStackedRow,
  ChartTimelinePoint,
} from './types';

/**
 * Chart card dispatcher - picks the renderer for a `render_chart` tool result.
 * Exposed as a single component so the chat panel only has to know about
 * `<ChatChartCard spec={…} />`; new chart types plug in here.
 *
 * Spec validation is deliberately permissive - the LLM occasionally emits a
 * malformed payload. We coerce what we can and bail out silently if there's
 * nothing to draw, so a bad spec degrades to "the prose summary is enough"
 * instead of crashing the message.
 */
export function ChatChartCard({ spec }: { spec: ChartSpec | null }) {
  if (!spec) return null;
  if (spec.type === 'hbar') {
    return (
      <HBarChart
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        series={spec.series}
      />
    );
  }
  if (spec.type === 'compare') {
    return (
      <CompareBars
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        series={spec.series}
      />
    );
  }
  if (spec.type === 'timeline') {
    return (
      <TimelineChart
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        unit={spec.unit}
        series={spec.series}
      />
    );
  }
  if (spec.type === 'donut') {
    return (
      <DonutChart
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        unit={spec.unit}
        series={spec.series}
      />
    );
  }
  if (spec.type === 'stacked') {
    return (
      <StackedBars
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        series={spec.series}
      />
    );
  }
  if (spec.type === 'scatter') {
    return (
      <ScatterChart
        title={spec.title}
        subtitle={spec.subtitle}
        note={spec.note}
        xLabel={spec.xLabel}
        yLabel={spec.yLabel}
        series={spec.series}
      />
    );
  }
  return null;
}

/** Parse a tool-result JSON string into a ChartSpec, or null if the payload
 *  isn't a `render_chart` action or the shape doesn't validate. */
export function parseChartSpec(
  resultText: string | undefined,
): ChartSpec | null {
  if (!resultText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._ui_action !== 'render_chart') return null;
  const chart = obj.chart;
  if (!chart || typeof chart !== 'object') return null;
  const c = chart as Record<string, unknown>;
  const title = typeof c.title === 'string' ? c.title : '';
  const subtitle = typeof c.subtitle === 'string' ? c.subtitle : undefined;
  const note = typeof c.note === 'string' ? c.note : undefined;
  const series = Array.isArray(c.series) ? c.series : [];
  if (!title || series.length === 0) return null;

  // Coerce per-type, then bail out (null) if EVERY row was rejected - a chart
  // with no valid rows would render empty axes / NaN scales, so degrade to the
  // prose summary instead.
  if (c.type === 'hbar') {
    const rows = series
      .map(coerceBarRow)
      .filter((r): r is ChartBarRow => r !== null);
    if (rows.length === 0) return null;
    return { type: 'hbar', title, subtitle, note, series: rows };
  }
  if (c.type === 'compare') {
    const rows = series
      .map(coerceCompareRow)
      .filter((r): r is ChartCompareRow => r !== null);
    if (rows.length === 0) return null;
    return { type: 'compare', title, subtitle, note, series: rows };
  }
  if (c.type === 'timeline') {
    const rows = series
      .map(coerceTimelinePoint)
      .filter((r): r is ChartTimelinePoint => r !== null);
    if (rows.length === 0) return null;
    return {
      type: 'timeline',
      title,
      subtitle,
      note,
      unit: typeof c.unit === 'string' ? c.unit : undefined,
      series: rows,
    };
  }
  if (c.type === 'donut') {
    const rows = series
      .map(coerceDonutSlice)
      .filter((r): r is ChartDonutSlice => r !== null);
    if (rows.length === 0) return null;
    return {
      type: 'donut',
      title,
      subtitle,
      note,
      unit: typeof c.unit === 'string' ? c.unit : undefined,
      series: rows,
    };
  }
  if (c.type === 'stacked') {
    const rows = series
      .map(coerceStackedRow)
      .filter((r): r is ChartStackedRow => r !== null);
    if (rows.length === 0) return null;
    return { type: 'stacked', title, subtitle, note, series: rows };
  }
  if (c.type === 'scatter') {
    const rows = series
      .map(coerceScatterPoint)
      .filter((r): r is ChartScatterPoint => r !== null);
    if (rows.length === 0) return null;
    return {
      type: 'scatter',
      title,
      subtitle,
      note,
      xLabel: typeof c.xLabel === 'string' ? c.xLabel : undefined,
      yLabel: typeof c.yLabel === 'string' ? c.yLabel : undefined,
      series: rows,
    };
  }
  return null;
}

function coerceTone(t: unknown): 'ok' | 'warn' | 'danger' | undefined {
  return t === 'ok' || t === 'warn' || t === 'danger' ? t : undefined;
}

function coerceBarRow(row: unknown): ChartBarRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label : '';
  const value = typeof r.value === 'number' ? r.value : Number(r.value);
  if (!label || !Number.isFinite(value)) return null;
  return {
    label,
    value,
    max: typeof r.max === 'number' ? r.max : undefined,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
    tone: coerceTone(r.tone),
  };
}

function coerceCompareRow(row: unknown): ChartCompareRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label : '';
  const valuesRaw = Array.isArray(r.values) ? r.values : [];
  const values: ChartCompareRow['values'] = valuesRaw
    .map((v): ChartCompareRow['values'][number] | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      const value = typeof o.value === 'number' ? o.value : Number(o.value);
      if (!name || !Number.isFinite(value)) return null;
      return { name, value, tone: coerceTone(o.tone) };
    })
    .filter((x): x is ChartCompareRow['values'][number] => x !== null);
  if (!label || values.length === 0) return null;
  return {
    label,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
    values,
  };
}

function coerceTimelinePoint(row: unknown): ChartTimelinePoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date : '';
  if (!date) return null;
  // A null/missing value is intentional - it marks an upcoming (not-yet-
  // realized) point, so coerce only when a real number is present.
  let value: number | null = null;
  if (typeof r.value === 'number' && Number.isFinite(r.value)) {
    value = r.value;
  } else if (typeof r.value === 'string' && r.value.trim() !== '') {
    const n = Number(r.value);
    value = Number.isFinite(n) ? n : null;
  }
  return {
    date,
    value,
    tag: typeof r.tag === 'string' ? r.tag : undefined,
    tone: coerceTone(r.tone),
  };
}

function coerceDonutSlice(row: unknown): ChartDonutSlice | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label : '';
  const value = typeof r.value === 'number' ? r.value : Number(r.value);
  if (!label || !Number.isFinite(value)) return null;
  return { label, value, tone: coerceTone(r.tone) };
}

function coerceStackedRow(row: unknown): ChartStackedRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label : '';
  const segsRaw = Array.isArray(r.segments) ? r.segments : [];
  const segments: ChartStackedRow['segments'] = segsRaw
    .map((v): ChartStackedRow['segments'][number] | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      const value = typeof o.value === 'number' ? o.value : Number(o.value);
      if (!name || !Number.isFinite(value)) return null;
      return { name, value, tone: coerceTone(o.tone) };
    })
    .filter((x): x is ChartStackedRow['segments'][number] => x !== null);
  if (!label || segments.length === 0) return null;
  return {
    label,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
    segments,
  };
}

function coerceScatterPoint(row: unknown): ChartScatterPoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const x = typeof r.x === 'number' ? r.x : Number(r.x);
  const y = typeof r.y === 'number' ? r.y : Number(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    label: typeof r.label === 'string' ? r.label : undefined,
    tone: coerceTone(r.tone),
  };
}

export type { ChartSpec } from './types';
