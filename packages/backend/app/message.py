from typing import TypedDict

from pydantic import BaseModel

from app.s3 import generate_presigned_url


class TextContent(BaseModel):
    type: str = "text"
    text: str


class ImageContent(BaseModel):
    type: str = "image"
    format: str
    source: str | None = None
    s3_url: str | None = None


class DocumentContent(BaseModel):
    type: str = "document"
    format: str
    name: str
    source: str | None = None
    s3_url: str | None = None


ContentItem = TextContent | ImageContent | DocumentContent


BytesEncoded = TypedDict("BytesEncoded", {"__bytes_encoded__": bool, "data": str}, total=False)


class SourceBytes(TypedDict, total=False):
    bytes: BytesEncoded | str


class ImageDict(TypedDict, total=False):
    format: str
    source: SourceBytes
    s3_url: str


class DocumentDict(TypedDict, total=False):
    format: str
    name: str
    source: SourceBytes
    s3_url: str


def parse_source_bytes(source: SourceBytes) -> str:
    bytes_data = source.get("bytes")
    if isinstance(bytes_data, dict) and bytes_data.get("__bytes_encoded__"):
        return bytes_data.get("data", "")
    if isinstance(bytes_data, str):
        return bytes_data
    return ""


def parse_document(doc: DocumentDict) -> DocumentContent:
    s3_url = doc.get("s3_url")
    if s3_url:
        return DocumentContent(
            format=doc.get("format", ""),
            name=doc.get("name", ""),
            s3_url=generate_presigned_url(s3_url),
        )
    return DocumentContent(
        format=doc.get("format", ""),
        name=doc.get("name", ""),
        source=parse_source_bytes(doc.get("source", {})),
    )


def parse_image(img: ImageDict) -> ImageContent:
    s3_url = img.get("s3_url")
    if s3_url:
        return ImageContent(
            format=img.get("format", "png"),
            s3_url=generate_presigned_url(s3_url),
        )
    return ImageContent(
        format=img.get("format", "png"),
        source=parse_source_bytes(img.get("source", {})),
    )


def parse_content_items(content_items: list[dict]) -> list[ContentItem]:
    parsed: list[ContentItem] = []
    for item in content_items:
        if "text" in item and item["text"]:
            parsed.append(TextContent(text=item["text"]))
        elif "image" in item and item["image"]:
            parsed.append(parse_image(item["image"]))
        elif "document" in item and item["document"]:
            parsed.append(parse_document(item["document"]))
        elif "toolResult" in item and item["toolResult"]:
            tool_result = item["toolResult"]
            for sub_item in tool_result.get("content", []):
                if "text" in sub_item and sub_item["text"]:
                    parsed.append(TextContent(text=sub_item["text"]))
                elif "image" in sub_item and sub_item["image"]:
                    parsed.append(parse_image(sub_item["image"]))
    return parsed
