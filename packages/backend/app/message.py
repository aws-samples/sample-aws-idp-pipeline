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


ToolResultContentItem = TextContent | ImageContent | DocumentContent


class ToolUseContent(BaseModel):
    type: str = "tool_use"
    tool_use_id: str
    name: str


class ToolResultContent(BaseModel):
    type: str = "tool_result"
    tool_use_id: str | None = None
    content: list[ToolResultContentItem]


ContentItem = TextContent | ImageContent | DocumentContent | ToolUseContent | ToolResultContent


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


class ToolResultSubItemDict(TypedDict, total=False):
    text: str
    image: ImageDict
    document: DocumentDict


class ToolUseDict(TypedDict, total=False):
    toolUseId: str
    name: str
    input: dict


class ToolResultDict(TypedDict, total=False):
    toolUseId: str
    content: list[ToolResultSubItemDict]


class ContentItemDict(TypedDict, total=False):
    text: str
    image: ImageDict
    document: DocumentDict
    toolUse: ToolUseDict
    toolResult: ToolResultDict


def parse_content_items(content_items: list[ContentItemDict]) -> list[ContentItem]:
    parsed: list[ContentItem] = []
    for item in content_items:
        if "text" in item and item["text"]:
            parsed.append(TextContent(text=item["text"]))
        elif "image" in item and item["image"]:
            parsed.append(parse_image(item["image"]))
        elif "document" in item and item["document"]:
            parsed.append(parse_document(item["document"]))
        elif "toolUse" in item and item["toolUse"]:
            tool_use = item["toolUse"]
            parsed.append(
                ToolUseContent(
                    tool_use_id=tool_use.get("toolUseId", ""),
                    name=tool_use.get("name", ""),
                )
            )
        elif "toolResult" in item and item["toolResult"]:
            tool_result = item["toolResult"]
            sub_contents: list[ToolResultContentItem] = []
            for sub_item in tool_result.get("content", []):
                if "text" in sub_item and sub_item["text"]:
                    sub_contents.append(TextContent(text=sub_item["text"]))
                elif "image" in sub_item and sub_item["image"]:
                    sub_contents.append(parse_image(sub_item["image"]))
                elif "document" in sub_item and sub_item["document"]:
                    sub_contents.append(parse_document(sub_item["document"]))
            if sub_contents:
                parsed.append(
                    ToolResultContent(
                        tool_use_id=tool_result.get("toolUseId"),
                        content=sub_contents,
                    )
                )
    return parsed
