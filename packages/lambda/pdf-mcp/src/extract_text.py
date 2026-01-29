"""Extract text from PDF using pdfplumber."""

import io

import pdfplumber

from .artifact import get_artifact_content


def extract_text(event: dict) -> dict:
    """Extract text from PDF.

    Args:
        event: {
            "artifact_id": str,
            "pages": list[int] | None  # 1-indexed page numbers
        }

    Returns:
        {
            "text": str,
            "pages": list[{"page_number": int, "text": str}]
        }
    """
    artifact_id = event["artifact_id"]
    pages_filter = event.get("pages")

    content, metadata = get_artifact_content(artifact_id)

    if not metadata.content_type.endswith("/pdf"):
        raise ValueError(f"Artifact is not a PDF: {metadata.content_type}")

    pdf_file = io.BytesIO(content)
    pages_result = []
    all_text_parts = []

    with pdfplumber.open(pdf_file) as pdf:
        for i, page in enumerate(pdf.pages):
            page_number = i + 1  # 1-indexed

            if pages_filter and page_number not in pages_filter:
                continue

            text = page.extract_text() or ""
            pages_result.append({"page_number": page_number, "text": text})
            all_text_parts.append(text)

    return {
        "text": "\n\n".join(all_text_parts),
        "pages": pages_result,
    }
