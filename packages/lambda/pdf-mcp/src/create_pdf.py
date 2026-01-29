"""Create PDF from text content using reportlab."""

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from .artifact import save_artifact

# Register CJK font for Korean support
pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
CJK_FONT = "HYGothic-Medium"


def text_to_pdf(content: str) -> bytes:
    """Convert plain text to PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    normal_style = ParagraphStyle(
        "NormalCJK",
        parent=styles["Normal"],
        fontName=CJK_FONT,
    )

    story = []
    paragraphs = content.split("\n\n")

    for para in paragraphs:
        if para.strip():
            # Replace single newlines with <br/>
            para_text = para.replace("\n", "<br/>")
            story.append(Paragraph(para_text, normal_style))
            story.append(Spacer(1, 0.5 * cm))

    doc.build(story)
    return buffer.getvalue()


def markdown_to_pdf(content: str) -> bytes:
    """Convert markdown to PDF with basic formatting."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()

    # Custom styles for markdown elements with CJK font
    h1_style = ParagraphStyle(
        "Heading1CJK",
        parent=styles["Heading1"],
        fontName=CJK_FONT,
        fontSize=18,
        spaceAfter=12,
    )
    h2_style = ParagraphStyle(
        "Heading2CJK",
        parent=styles["Heading2"],
        fontName=CJK_FONT,
        fontSize=14,
        spaceAfter=10,
    )
    h3_style = ParagraphStyle(
        "Heading3CJK",
        parent=styles["Heading3"],
        fontName=CJK_FONT,
        fontSize=12,
        spaceAfter=8,
    )
    normal_style = ParagraphStyle(
        "NormalCJK",
        parent=styles["Normal"],
        fontName=CJK_FONT,
    )

    story = []
    lines = content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].rstrip()

        if not line:
            story.append(Spacer(1, 0.3 * cm))
            i += 1
            continue

        # Headings
        if line.startswith("### "):
            story.append(Paragraph(line[4:], h3_style))
        elif line.startswith("## "):
            story.append(Paragraph(line[3:], h2_style))
        elif line.startswith("# "):
            story.append(Paragraph(line[2:], h1_style))
        else:
            # Handle bold and italic
            text = line
            text = text.replace("**", "<b>", 1)
            while "**" in text:
                text = text.replace("**", "</b>", 1)
                if "**" in text:
                    text = text.replace("**", "<b>", 1)

            text = text.replace("*", "<i>", 1)
            while "*" in text:
                text = text.replace("*", "</i>", 1)
                if "*" in text:
                    text = text.replace("*", "<i>", 1)

            story.append(Paragraph(text, normal_style))

        i += 1

    doc.build(story)
    return buffer.getvalue()


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
    pdf_bytes = markdown_to_pdf(content) if input_format == "markdown" else text_to_pdf(content)

    # Save as artifact
    result = save_artifact(
        user_id=user_id,
        project_id=project_id,
        filename=filename,
        content=pdf_bytes,
        content_type="application/pdf",
    )

    return result
