"""PDF rendering utilities using reportlab."""

import io
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer

# Register Noto Sans KR fonts for Korean support
FONTS_DIR = Path(__file__).parent.parent / "fonts"
pdfmetrics.registerFont(TTFont("NotoSansKR", str(FONTS_DIR / "NotoSansKR-Regular.ttf")))
pdfmetrics.registerFont(TTFont("NotoSansKR-Bold", str(FONTS_DIR / "NotoSansKR-Bold.ttf")))
pdfmetrics.registerFontFamily("NotoSansKR", normal="NotoSansKR", bold="NotoSansKR-Bold")
FONT_NAME = "NotoSansKR"

# GitHub Markdown style colors
COLORS = {
    "text": HexColor("#24292f"),
    "heading": HexColor("#1f2328"),
    "border": HexColor("#d0d7de"),
    "code_bg": HexColor("#f6f8fa"),
    "quote": HexColor("#656d76"),
}


class HorizontalRule(Flowable):
    """A horizontal rule flowable for heading underlines."""

    def __init__(self, width, color=None, thickness=1):
        super().__init__()
        self.width = width
        self.color = color if color is not None else COLORS["border"]
        self.thickness = thickness

    def wrap(self, availWidth, availHeight):
        return (self.width, self.thickness)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)


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

    normal_style = ParagraphStyle(
        "Normal",
        fontName=FONT_NAME,
        fontSize=14,
        leading=18,  # 14 * 1.3
        textColor=COLORS["text"],
        spaceAfter=10,
    )

    story = []
    paragraphs = content.split("\n\n")

    for para in paragraphs:
        if para.strip():
            # Replace single newlines with <br/>
            para_text = para.replace("\n", "<br/>")
            story.append(Paragraph(para_text, normal_style))

    doc.build(story)
    return buffer.getvalue()


def markdown_to_pdf(content: str) -> bytes:
    """Convert markdown to PDF with GitHub-style formatting."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    # Calculate content width for horizontal rules
    content_width = A4[0] - 4 * cm

    # GitHub Markdown styles
    h1_style = ParagraphStyle(
        "H1",
        fontName=FONT_NAME,
        fontSize=32,
        leading=40,
        textColor=COLORS["heading"],
        spaceBefore=24,
        spaceAfter=8,
    )
    h2_style = ParagraphStyle(
        "H2",
        fontName=FONT_NAME,
        fontSize=24,
        leading=30,
        textColor=COLORS["heading"],
        spaceBefore=24,
        spaceAfter=8,
    )
    h3_style = ParagraphStyle(
        "H3",
        fontName=FONT_NAME,
        fontSize=20,
        leading=25,
        textColor=COLORS["heading"],
        spaceBefore=24,
        spaceAfter=16,
    )
    h4_style = ParagraphStyle(
        "H4",
        fontName=FONT_NAME,
        fontSize=16,
        leading=20,
        textColor=COLORS["heading"],
        spaceBefore=24,
        spaceAfter=16,
    )
    normal_style = ParagraphStyle(
        "Normal",
        fontName=FONT_NAME,
        fontSize=14,
        leading=18,  # 14 * 1.3
        textColor=COLORS["text"],
        spaceAfter=10,
    )

    story = []
    lines = content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].rstrip()

        if not line:
            i += 1
            continue

        # Headings
        if line.startswith("#### "):
            story.append(Paragraph(line[5:], h4_style))
        elif line.startswith("### "):
            story.append(Paragraph(line[4:], h3_style))
        elif line.startswith("## "):
            story.append(Paragraph(line[3:], h2_style))
            story.append(Spacer(1, 8))
            story.append(HorizontalRule(content_width))
            story.append(Spacer(1, 8))
        elif line.startswith("# "):
            story.append(Paragraph(line[2:], h1_style))
            story.append(Spacer(1, 8))
            story.append(HorizontalRule(content_width))
            story.append(Spacer(1, 8))
        # Horizontal rule (---, ***, ___)
        elif line.strip() in ("---", "***", "___"):
            story.append(Spacer(1, 8))
            story.append(HorizontalRule(content_width))
            story.append(Spacer(1, 8))
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


def render_pdf(content: str, format: str) -> bytes:
    """Render content to PDF bytes.

    Args:
        content: The text or markdown content
        format: "text" or "markdown"

    Returns:
        PDF bytes
    """
    if format == "markdown":
        return markdown_to_pdf(content)
    return text_to_pdf(content)
