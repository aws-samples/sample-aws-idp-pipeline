"""Extract text from DOCX using python-docx."""

import io

from docx import Document

from .artifact import get_artifact_content


def extract_text(event: dict) -> dict:
    """Extract text from DOCX.

    Args:
        event: {
            "artifact_id": str
        }

    Returns:
        {
            "text": str,
            "paragraphs": list[{"index": int, "text": str, "style": str}]
        }
    """
    artifact_id = event["artifact_id"]

    content, metadata = get_artifact_content(artifact_id)

    if not metadata.content_type.endswith(("wordprocessingml.document", "/docx")):
        raise ValueError(f"Artifact is not a DOCX: {metadata.content_type}")

    docx_file = io.BytesIO(content)
    doc = Document(docx_file)

    paragraphs_result = []
    all_text_parts = []

    for i, para in enumerate(doc.paragraphs):
        text = para.text
        style_name = para.style.name if para.style else "Normal"

        paragraphs_result.append({
            "index": i,
            "text": text,
            "style": style_name,
        })
        if text.strip():
            all_text_parts.append(text)

    return {
        "text": "\n\n".join(all_text_parts),
        "paragraphs": paragraphs_result,
    }
