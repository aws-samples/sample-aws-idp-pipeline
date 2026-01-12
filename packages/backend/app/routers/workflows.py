import re
from urllib.parse import urlparse

import boto3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ddb.workflows import get_workflow_item, query_workflow_segments, query_workflows

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _generate_presigned_url(s3_uri: str, expires_in: int = 3600) -> str | None:
    """Generate a presigned URL for an S3 URI."""
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None

    try:
        parsed = urlparse(s3_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")

        s3 = _get_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )
    except Exception:
        return None


def _transform_markdown_images(markdown: str, image_uri: str = "") -> str:
    """Transform markdown images to presigned URLs.

    Handles both:
    1. Relative paths like ./uuid.png (using image_uri to derive base path)
    2. Full S3 URIs like s3://bucket/key
    """
    if not markdown:
        return markdown

    # Extract assets base path from image_uri
    # e.g., s3://bucket/bda-output/.../assets/rectified_image_0.png
    # -> s3://bucket/bda-output/.../assets/
    assets_base = ""
    if image_uri:
        assets_match = re.search(r"(s3://[^/]+/.+/assets/)", image_uri)
        if assets_match:
            assets_base = assets_match.group(1)

    def transform_image(match):
        alt_text = match.group(1)
        img_url = match.group(2)

        # Remove newlines and extra whitespace from alt text
        alt_text = " ".join(alt_text.split())
        # Truncate long alt text
        if len(alt_text) > 100:
            alt_text = alt_text[:100] + "..."

        # Handle relative paths like ./filename.png
        if img_url.startswith("./") and assets_base:
            filename = img_url[2:]  # Remove "./"
            s3_uri = f"{assets_base}{filename}"
            presigned_url = _generate_presigned_url(s3_uri)
            if presigned_url:
                img_url = presigned_url
        # Handle full S3 URIs
        elif img_url.startswith("s3://"):
            presigned_url = _generate_presigned_url(img_url)
            if presigned_url:
                img_url = presigned_url

        return f"![{alt_text}]({img_url})"

    # Match markdown image syntax: ![alt](url)
    pattern = r"!\[([^\]]*)\]\(([^)]+)\)"
    return re.sub(pattern, transform_image, markdown)


router = APIRouter(prefix="/documents/{document_id}/workflows", tags=["workflows"])


class WorkflowListResponse(BaseModel):
    workflow_id: str
    status: str
    file_name: str
    file_uri: str
    created_at: str
    updated_at: str


class SegmentData(BaseModel):
    segment_index: int
    image_uri: str
    image_url: str | None = None
    bda_indexer: str
    format_parser: str
    image_analysis: list[dict]


class WorkflowDetailResponse(BaseModel):
    workflow_id: str
    document_id: str
    status: str
    file_name: str
    file_uri: str
    file_type: str
    total_segments: int
    created_at: str
    updated_at: str
    segments: list[SegmentData]


@router.get("")
def list_workflows(document_id: str) -> list[WorkflowListResponse]:
    """List all workflows for a document."""
    workflows = query_workflows(document_id)

    return [
        WorkflowListResponse(
            workflow_id=wf.SK.replace("WF#", "") if wf.SK.startswith("WF#") else wf.SK,
            status=wf.data.status,
            file_name=wf.data.file_name,
            file_uri=wf.data.file_uri,
            created_at=wf.created_at,
            updated_at=wf.updated_at,
        )
        for wf in workflows
    ]


@router.get("/{workflow_id}")
def get_workflow(document_id: str, workflow_id: str) -> WorkflowDetailResponse:
    """Get a single workflow with segments."""
    wf = get_workflow_item(document_id, workflow_id)

    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Get segments
    segment_items = query_workflow_segments(workflow_id)
    segments = []
    for seg in segment_items:
        image_uri = seg.data.image_uri
        bda_indexer = _transform_markdown_images(seg.data.bda_indexer, image_uri)
        format_parser = _transform_markdown_images(seg.data.format_parser, image_uri)

        # Transform image_analysis content as well
        image_analysis = [
            {
                **ia.model_dump(),
                "content": _transform_markdown_images(ia.content, image_uri)
                if hasattr(ia, "content")
                else ia.model_dump().get("content", ""),
            }
            for ia in seg.data.image_analysis
        ]

        segments.append(
            SegmentData(
                segment_index=seg.data.segment_index,
                image_uri=image_uri,
                image_url=_generate_presigned_url(image_uri),
                bda_indexer=bda_indexer,
                format_parser=format_parser,
                image_analysis=image_analysis,
            )
        )

    # Sort segments by index
    segments.sort(key=lambda s: s.segment_index)

    return WorkflowDetailResponse(
        workflow_id=workflow_id,
        document_id=document_id,
        status=wf.data.status,
        file_name=wf.data.file_name,
        file_uri=wf.data.file_uri,
        file_type=wf.data.file_type,
        total_segments=wf.data.total_segments or len(segments),
        created_at=wf.created_at,
        updated_at=wf.updated_at,
        segments=segments,
    )
