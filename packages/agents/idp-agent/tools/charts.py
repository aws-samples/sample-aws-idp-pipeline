"""render_chart tool - emits a `_ui_action=render_chart` payload the frontend
draws inline as a small SVG chart card (no charting library)."""

import json
from typing import Any

from strands import tool


@tool
def render_chart(
    chart_type: str,
    title: str,
    series: list[dict[str, Any]],
    subtitle: str | None = None,
    note: str | None = None,
    unit: str | None = None,
    x_label: str | None = None,
    y_label: str | None = None,
) -> str:
    """Render an inline chart card inside the chat reply.

    Use this to visualise numeric data the user asks about - a comparison of
    metrics, a composition/share, item-vs-item values, a value over time, or a
    correlation between two variables. The chat panel renders the spec as a
    small SVG card next to the assistant message, so the user sees the answer
    AND the chart at a glance instead of a wall of numbers.

    Always pair this with the data-fetching tool that produced the numbers.
    Do NOT hallucinate values into the series - every `value` must come from a
    previous tool result (search, SQL, etc.) in the same turn. Also keep the
    prose summary: the returned JSON contains the numbers so the answer still
    reads if the chart can't render.

    Args:
      chart_type: pick the shape that fits the question:
        - "hbar": horizontal bars, a quantity per label (optionally vs a
          max/target). Ranking or per-item magnitude.
        - "compare": side-by-side bars across N named items per label (A vs B
          per category).
        - "timeline": a value over dated points (recurrence/trend with day-gap
          connectors).
        - "donut": composition / share of a whole. Best for "what fraction is
          each category" (e.g. class distribution, gender split). Shows total
          in the center and percentages per slice.
        - "stacked": vertical stacked bars - each label's bar is split into
          named segments. Best for part-to-whole comparison across categories
          (e.g. survived vs died stacked per class).
        - "scatter": points on an X/Y plane. Best for the correlation between
          two numeric variables (e.g. fare vs age).
      title: Headline shown in the chart card (natural language).
      series: Rows to plot. Schema depends on chart_type:
        hbar: {"label": str, "value": number, "max": number?, "unit": str?,
               "tone": "ok"|"warn"|"danger"?}
        compare: {"label": str, "unit": str?,
                  "values": [{"name": str, "value": number, "tone": ...?}]}
        timeline: {"date": "YYYY-MM-DD", "value": number|null, "tag": str?,
                   "tone": ...?}  (date MUST be ISO; null value = upcoming)
        donut: {"label": str, "value": number, "tone": ...?}  (one slice each)
        stacked: {"label": str, "unit": str?,
                  "segments": [{"name": str, "value": number, "tone": ...?}]}
        scatter: {"x": number, "y": number, "label": str?, "tone": ...?}
      unit: value-column unit for "timeline"/"donut" (e.g. persons); ignored by
        the others (their units are per-row).
      x_label: axis label for "scatter" X (the horizontal variable).
      y_label: axis label for "scatter" Y (the vertical variable).
      subtitle: Optional smaller text under the title.
      note: Optional footer caption (e.g. the basis/assumption of the numbers).

    Returns: a JSON envelope the frontend turns into a chat-side chart card.
    """
    valid_types = {"hbar", "compare", "timeline", "donut", "stacked", "scatter"}
    if chart_type not in valid_types:
        return json.dumps(
            {
                "_ui_action": "error",
                "error": f"unknown chart_type: {chart_type!r}. valid: {sorted(valid_types)}",
            },
            ensure_ascii=False,
        )
    if not isinstance(series, list) or not series:
        return json.dumps(
            {"_ui_action": "error", "error": "series must be a non-empty list"},
            ensure_ascii=False,
        )
    chart: dict[str, Any] = {
        "type": chart_type,
        "title": title,
        "series": series,
    }
    if subtitle:
        chart["subtitle"] = subtitle
    if note:
        chart["note"] = note
    if unit and chart_type in ("timeline", "donut"):
        chart["unit"] = unit
    if chart_type == "scatter":
        if x_label:
            chart["xLabel"] = x_label
        if y_label:
            chart["yLabel"] = y_label
    return json.dumps({"_ui_action": "render_chart", "chart": chart}, ensure_ascii=False)
