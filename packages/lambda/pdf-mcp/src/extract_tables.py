"""Extract tables from PDF using pdfplumber."""

import io

import pdfplumber

from .artifact import get_artifact_content


def table_to_markdown(table: list[list[str | None]]) -> str:
    """Convert a table to markdown format."""
    if not table:
        return ""

    # Replace None with empty string
    table = [[cell or "" for cell in row] for row in table]

    lines = []

    # Header row
    header = table[0]
    lines.append("| " + " | ".join(str(cell) for cell in header) + " |")

    # Separator
    lines.append("| " + " | ".join("---" for _ in header) + " |")

    # Data rows
    for row in table[1:]:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")

    return "\n".join(lines)


def extract_tables(event: dict) -> dict:
    """Extract tables from PDF.

    Args:
        event: {
            "artifact_id": str,
            "pages": list[int] | None,  # 1-indexed page numbers
            "format": "json" | "markdown"  # default: json
        }

    Returns:
        {
            "tables": list[{
                "page_number": int,
                "table_index": int,
                "data": list[list[str]] | str  # depends on format
            }]
        }
    """
    artifact_id = event["artifact_id"]
    pages_filter = event.get("pages")
    output_format = event.get("format", "json")

    content, metadata = get_artifact_content(artifact_id)

    if not metadata.content_type.endswith("/pdf"):
        raise ValueError(f"Artifact is not a PDF: {metadata.content_type}")

    pdf_file = io.BytesIO(content)
    tables_result = []

    with pdfplumber.open(pdf_file) as pdf:
        for i, page in enumerate(pdf.pages):
            page_number = i + 1  # 1-indexed

            if pages_filter and page_number not in pages_filter:
                continue

            tables = page.extract_tables()

            for table_index, table in enumerate(tables):
                if not table:
                    continue

                # Clean up table data
                cleaned_table = [[(cell or "").strip() for cell in row] for row in table]

                data = table_to_markdown(cleaned_table) if output_format == "markdown" else cleaned_table

                tables_result.append(
                    {
                        "page_number": page_number,
                        "table_index": table_index,
                        "data": data,
                    }
                )

    return {"tables": tables_result}
