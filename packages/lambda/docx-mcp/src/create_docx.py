"""Create DOCX from text content."""

from .artifact import save_artifact
from .docx_renderer import render_docx


def create_docx(event: dict) -> dict:
    """Create DOCX from text content.

    Args:
        event: {
            "user_id": str,
            "project_id": str,
            "filename": str,
            "content": str,
            "format": "text" | "markdown"  # default: text
        }

    Returns:
        {
            "artifact_id": str,
            "filename": str,
            "s3_bucket": str,
            "s3_key": str,
            "created_at": str
        }
    """
    user_id = event["user_id"]
    project_id = event["project_id"]
    filename = event["filename"]
    content = event["content"]
    input_format = event.get("format", "text")

    # Ensure filename ends with .docx
    if not filename.lower().endswith(".docx"):
        filename = f"{filename}.docx"

    # Convert content to DOCX
    docx_bytes = render_docx(content, input_format)

    # Save as artifact
    result = save_artifact(
        user_id=user_id,
        project_id=project_id,
        filename=filename,
        content=docx_bytes,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    return result
