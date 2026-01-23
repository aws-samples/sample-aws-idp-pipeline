import base64
import re

from nanoid import generate
from pydantic import BaseModel
from strands.types.content import ContentBlock as StrandsContentBlock
from strands.types.media import DocumentContent as StrandsDocumentContent
from strands.types.media import ImageContent as StrandsImageContent

# Alphanumeric characters only for Bedrock compatibility
NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def sanitize_document_name(name: str) -> str:
    """Sanitize document name for Bedrock API compatibility.

    Bedrock DocumentBlock name only allows: alphanumeric, spaces, hyphens, parentheses, brackets.
    Pattern: ^[a-zA-Z0-9\\s\\-\\(\\)\\[\\]]+$

    A unique nanoid suffix is appended to ensure uniqueness across session history.
    """
    stem = name.rsplit(".", 1)[0] if "." in name else name
    sanitized = re.sub(r"[^a-zA-Z0-9\s\-\(\)\[\]]", "-", stem)[:180]
    sanitized = re.sub(r"-+", "-", sanitized).strip("-") or "doc"
    unique_id = generate(NANOID_ALPHABET, 8)
    return f"{sanitized}-{unique_id}"


class ContentSource(BaseModel):
    base64: str


class ImageContent(BaseModel):
    format: str  # "png", "jpg", "gif", "webp"
    source: ContentSource


class DocumentContent(BaseModel):
    format: str  # "pdf", "txt", "csv", "doc", "docx", "html", "md"
    name: str
    source: ContentSource


class ContentBlock(BaseModel):
    image: ImageContent | None = None
    document: DocumentContent | None = None
    text: str | None = None

    def to_strands(self) -> StrandsContentBlock:
        """Convert to Strands Agent ContentBlock format."""
        if self.text:
            return StrandsContentBlock(text=self.text)
        if self.image:
            return StrandsContentBlock(
                image=StrandsImageContent(
                    format=self.image.format,  # type: ignore[typeddict-item]
                    source={"bytes": base64.b64decode(self.image.source.base64)},
                )
            )
        if self.document:
            return StrandsContentBlock(
                document=StrandsDocumentContent(
                    format=self.document.format,  # type: ignore[typeddict-item]
                    name=sanitize_document_name(self.document.name),
                    source={"bytes": base64.b64decode(self.document.source.base64)},
                )
            )
        return StrandsContentBlock(text="")


class InvokeRequest(BaseModel):
    prompt: list[ContentBlock]
    session_id: str
    project_id: str
    user_id: str | None = None
    agent_id: str | None = None
