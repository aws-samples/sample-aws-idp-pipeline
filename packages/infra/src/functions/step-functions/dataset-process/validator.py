"""Structured-dataset validation.

The quality gate is the INPUT data, not an LLM-generated document: a spreadsheet
must be a clean tabular table to become a queryable dataset. Non-tabular content
(merged cells, images/charts, multi-row headers, duplicate/empty columns) is
rejected so the user cleans and re-uploads.

Each sheet is validated independently. A sheet that passes is converted to its own
dataset; sheets that fail are reported. If NO sheet passes, the whole step is
NEEDS_USER_FIX.
"""

from dataclasses import dataclass, field


@dataclass
class SheetValidation:
    sheet_name: str
    sheet_index: int
    ok: bool
    reasons: list[str] = field(default_factory=list)


def validate_workbook(wb) -> list[SheetValidation]:
    """Validate every sheet in an openpyxl workbook. Returns per-sheet results."""
    results: list[SheetValidation] = []
    for idx, ws in enumerate(wb.worksheets):
        reasons: list[str] = []

        # Images / charts / drawings: reject (not tabular data).
        if getattr(ws, "_images", None):
            reasons.append("시트에 이미지가 포함되어 있습니다.")
        if getattr(ws, "_charts", None):
            reasons.append("시트에 차트가 포함되어 있습니다.")

        # Merged cells break the row/column grid.
        merged = getattr(ws, "merged_cells", None)
        if merged is not None and getattr(merged, "ranges", None):
            reasons.append("병합된 셀이 있어 표 구조가 깨집니다.")

        # Header (first row) checks: needs a non-empty header row. Duplicate
        # column names are NOT rejected: the parquet step normalizes columns to
        # unique snake_case (e.g. material, material_1), so duplicates are handled
        # automatically rather than being a user-fix case.
        header = _first_row_values(ws)
        if not header:
            reasons.append("헤더(첫 행)가 비어 있습니다.")
        else:
            empty = [i for i, v in enumerate(header) if v is None or str(v).strip() == ""]
            if empty:
                reasons.append("빈 헤더 열이 있습니다.")

        # Needs at least one data row beyond the header.
        if ws.max_row is not None and ws.max_row < 2:
            reasons.append("데이터 행이 없습니다(헤더만 존재).")

        results.append(
            SheetValidation(
                sheet_name=ws.title,
                sheet_index=idx,
                ok=len(reasons) == 0,
                reasons=reasons,
            )
        )
    return results


def _first_row_values(ws) -> list:
    for row in ws.iter_rows(min_row=1, max_row=1, values_only=True):
        return list(row)
    return []
