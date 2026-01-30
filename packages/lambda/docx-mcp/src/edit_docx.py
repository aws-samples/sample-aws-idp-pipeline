"""Edit existing DOCX artifact."""

from .artifact import update_artifact
from .docx_renderer import render_docx


def edit_docx(event: dict) -> dict:
    """Edit existing DOCX artifact.

    Args:
        event: {
            "artifact_id": str,
            "content": str,
            "format": "text" | "markdown"  # default: text
        }

    Returns:
        {
            "artifact_id": str,
            "filename": str,
            "s3_bucket": str,
            "s3_key": str,
            "updated_at": str
        }
    """
    artifact_id = event["artifact_id"]
    content = event["content"]
    input_format = event.get("format", "text")

    # Convert content to DOCX
    docx_bytes = render_docx(content, input_format)

    # Update artifact
    result = update_artifact(artifact_id, docx_bytes)

    return result
