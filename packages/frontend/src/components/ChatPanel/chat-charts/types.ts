/**
 * Chart spec - what the agent's `render_chart` tool emits and the chat panel
 * renders as an inline SVG card. Kept narrow so a single LLM payload covers
 * every chart type without dragging in a full charting library.
 */

/** Single bar in an "hbar" chart - value compared against an optional cap.
 *  `unit` is rendered next to the value so 1800 reads "mg" and 320 reads
 *  "kcal" without forcing the LLM to bake units into labels. */
export interface ChartBarRow {
  label: string;
  value: number;
  /** Cap for "value / max" gauges. Omit for raw bars; bar widths then
   *  normalize against the row with the largest value. */
  max?: number;
  unit?: string;
  /** Visual emphasis. `ok` = neutral, `warn` = amber, `danger` = rose.
   *  Defaults to `ok` when omitted. */
  tone?: 'ok' | 'warn' | 'danger';
}

/** Single row in a "compare" chart - N items lined up side by side for the
 *  same metric. */
export interface ChartCompareRow {
  label: string;
  unit?: string;
  values: { name: string; value: number; tone?: 'ok' | 'warn' | 'danger' }[];
}

/** One point in a "timeline" chart - a value over time. Rows render
 *  top-to-bottom in the order given; the renderer computes the day gap to the
 *  next row from the two ISO dates and draws it as a connector. */
export interface ChartTimelinePoint {
  /** ISO "YYYY-MM-DD" is required for the renderer to compute the gap;
   *  non-ISO strings still render but drop the gap connector. */
  date: string;
  /** Realized value. null/omitted = an upcoming point not yet realized ->
   *  rendered as a muted "scheduled" pill with no bar. */
  value?: number | null;
  /** Optional short tag rendered next to the value, e.g. "outlier". */
  tag?: string;
  tone?: 'ok' | 'warn' | 'danger';
}

/** One slice of a "donut" chart - a category's share of the whole. */
export interface ChartDonutSlice {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'danger';
}

/** One bar of a "stacked" chart - a label whose bar is split into named
 *  segments stacked on top of each other. */
export interface ChartStackedRow {
  label: string;
  unit?: string;
  segments: { name: string; value: number; tone?: 'ok' | 'warn' | 'danger' }[];
}

/** One point of a "scatter" chart - an (x, y) coordinate. */
export interface ChartScatterPoint {
  x: number;
  y: number;
  label?: string;
  tone?: 'ok' | 'warn' | 'danger';
}

export type ChartSpec =
  | {
      type: 'hbar';
      title: string;
      subtitle?: string;
      note?: string;
      series: ChartBarRow[];
    }
  | {
      type: 'compare';
      title: string;
      subtitle?: string;
      note?: string;
      series: ChartCompareRow[];
    }
  | {
      type: 'timeline';
      title: string;
      subtitle?: string;
      note?: string;
      /** Unit for the value column. Defaults to blank. */
      unit?: string;
      series: ChartTimelinePoint[];
    }
  | {
      type: 'donut';
      title: string;
      subtitle?: string;
      note?: string;
      /** Unit shown with the center total. */
      unit?: string;
      series: ChartDonutSlice[];
    }
  | {
      type: 'stacked';
      title: string;
      subtitle?: string;
      note?: string;
      series: ChartStackedRow[];
    }
  | {
      type: 'scatter';
      title: string;
      subtitle?: string;
      note?: string;
      xLabel?: string;
      yLabel?: string;
      series: ChartScatterPoint[];
    };
