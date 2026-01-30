"""Extract tables from DOCX using python-docx."""

import io

from docx import Document

from .artifact import get_artifact_content


def table_to_markdown(table) -> str:
    """Convert a DOCX table to markdown format."""
    rows = []
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
        rows.append(cells)

    if not rows:
        return ""

    lines = []

    # Header row
    header = rows[0]
    lines.append("| " + " | ".join(header) + " |")

    # Separator
    lines.append("| " + " | ".join("---" for _ in header) + " |")

    # Data rows
    for row in rows[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def extract_tables(event: dict) -> dict:
    """Extract tables from DOCX.

    Args:
        event: {
            "artifact_id": str,
            "format": "json" | "markdown"  # default: json
        }

    Returns:
        {
            "tables": list[{
                "table_index": int,
                "data": list[list[str]] | str  # depends on format
            }]
        }
    """
    artifact_id = event["artifact_id"]
    output_format = event.get("format", "json")

    content, metadata = get_artifact_content(artifact_id)

    if not metadata.content_type.endswith(("wordprocessingml.document", "/docx")):
        raise ValueError(f"Artifact is not a DOCX: {metadata.content_type}")

    docx_file = io.BytesIO(content)
    doc = Document(docx_file)

    tables_result = []

    for table_index, table in enumerate(doc.tables):
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            rows.append(cells)

        if not rows:
            continue

        data = table_to_markdown(table) if output_format == "markdown" else rows

        tables_result.append({
            "table_index": table_index,
            "data": data,
        })

    return {"tables": tables_result}
