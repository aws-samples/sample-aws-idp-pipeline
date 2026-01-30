"""Create PDF from text content."""

from .artifact import save_artifact
from .pdf_renderer import render_pdf


def create_pdf(event: dict) -> dict:
    """Create PDF from text content.

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

    # Ensure filename ends with .pdf
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"

    # Convert content to PDF
    pdf_bytes = render_pdf(content, input_format)

    # Save as artifact
    result = save_artifact(
        user_id=user_id,
        project_id=project_id,
        filename=filename,
        content=pdf_bytes,
        content_type="application/pdf",
    )

    return result
