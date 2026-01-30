"""Edit existing PDF artifact."""

from .artifact import update_artifact
from .pdf_renderer import render_pdf


def edit_pdf(event: dict) -> dict:
    """Edit existing PDF artifact.

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

    # Convert content to PDF
    pdf_bytes = render_pdf(content, input_format)

    # Update artifact
    result = update_artifact(artifact_id, pdf_bytes)

    return result
