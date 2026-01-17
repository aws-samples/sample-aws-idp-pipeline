import json
import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ddb.workflows import get_workflow_item, query_workflow_segments, query_workflows
from app.s3 import get_s3_client


def _parse_s3_uri(uri: str) -> tuple:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def _get_segment_from_s3(file_uri: str, s3_key: str) -> dict | None:
    """Get segment analysis data from S3.

    Args:
        file_uri: Original file URI to get bucket
        s3_key: S3 key where segment data is stored

    Returns:
        Segment data dict or None if not found
    """
    if not s3_key:
        return None

    try:
        s3 = get_s3_client()
        bucket, _ = _parse_s3_uri(file_uri)

        response = s3.get_object(Bucket=bucket, Key=s3_key)
        return json.loads(response["Body"].read().decode("utf-8"))
    except Exception as e:
        print(f"Error getting segment from S3 {s3_key}: {e}")
        return None


def _get_content_type(key: str) -> str | None:
    """Get content type based on file extension."""
    ext = key.lower().split(".")[-1] if "." in key else ""
    content_types = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "pdf": "application/pdf",
    }
    return content_types.get(ext)


def _generate_presigned_url(s3_uri: str, expires_in: int = 3600) -> str | None:
    """Generate a presigned URL for an S3 URI."""
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None

    try:
        parsed = urlparse(s3_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")

        s3 = get_s3_client()
        params = {"Bucket": bucket, "Key": key}

        # Add ResponseContentType for images to fix ORB blocking
        content_type = _get_content_type(key)
        if content_type:
            params["ResponseContentType"] = content_type

        return s3.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
    except Exception:
        return None


def _fix_image_uri(image_uri: str) -> str:
    """Fix image_uri by adding /assets/ if missing.

    BDA stores images in /assets/ subdirectory but some stored URIs
    may be missing this path component.
    """
    if not image_uri or not image_uri.startswith("s3://"):
        return image_uri

    # Already has /assets/, return as-is
    if "/assets/" in image_uri:
        return image_uri

    # Add /assets/ before the filename
    parts = image_uri.rsplit("/", 1)
    if len(parts) == 2:
        return f"{parts[0]}/assets/{parts[1]}"

    return image_uri


def _transform_markdown_images(markdown: str, image_uri: str = "") -> str:
    """Transform markdown images to presigned URLs.

    Handles both:
    1. Relative paths like ./uuid.png (using image_uri to derive base path)
    2. Full S3 URIs like s3://bucket/key
    3. Plain filenames like uuid.png
    """
    if not markdown:
        return markdown

    # Extract assets base path from image_uri
    # BDA stores images in /assets/ subdirectory
    # e.g., s3://bucket/bda-output/.../standard_output/0/assets/rectified_image.png
    # -> s3://bucket/bda-output/.../standard_output/0/assets/
    assets_base = ""
    if image_uri:
        # Case 1: image_uri already contains /assets/
        assets_match = re.search(r"(s3://[^/]+/.+/assets/)", image_uri)
        if assets_match:
            assets_base = assets_match.group(1)
        else:
            # Case 2: image_uri doesn't have /assets/, construct it from parent dir
            # e.g., s3://bucket/.../standard_output/0/rectified_image.png
            # -> s3://bucket/.../standard_output/0/assets/
            parent_dir = image_uri.rsplit("/", 1)[0]
            if parent_dir:
                assets_base = f"{parent_dir}/assets/"

    # Fallback: try to extract assets_base from S3 URIs in the markdown itself
    if not assets_base:
        s3_uri_match = re.search(r"(s3://[^/]+/.+/assets/)", markdown)
        if s3_uri_match:
            assets_base = s3_uri_match.group(1)

    def transform_image(match):
        alt_text = match.group(1)
        img_url = match.group(2)

        # Remove newlines and extra whitespace from alt text
        alt_text = " ".join(alt_text.split())
        # Escape brackets in alt text to prevent markdown parsing issues
        alt_text = alt_text.replace("[", "\\[").replace("]", "\\]")
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
            pass  # Will be handled below
        # Handle plain filenames (no ./ prefix, not s3://, not http)
        elif assets_base and not img_url.startswith(("http://", "https://")):
            s3_uri = f"{assets_base}{img_url}"
            presigned_url = _generate_presigned_url(s3_uri)
            if presigned_url:
                img_url = presigned_url

        # Handle full S3 URIs
        if img_url.startswith("s3://"):
            # Check if the URI is missing /assets/ and add it
            if "/assets/" not in img_url:
                parts = img_url.rsplit("/", 1)
                if len(parts) == 2:
                    img_url_with_assets = f"{parts[0]}/assets/{parts[1]}"
                    presigned_url = _generate_presigned_url(img_url_with_assets)
                    if presigned_url:
                        img_url = presigned_url
                    else:
                        # Fallback to original URL if assets path doesn't work
                        presigned_url = _generate_presigned_url(img_url)
                        if presigned_url:
                            img_url = presigned_url
            else:
                presigned_url = _generate_presigned_url(img_url)
                if presigned_url:
                    img_url = presigned_url

        return f"![{alt_text}]({img_url})"

    # Match markdown image syntax: ![alt](url)
    # Use non-greedy match with DOTALL to handle multi-line alt text and nested brackets
    pattern = r"!\[(.*?)\]\(([^)]+)\)"
    return re.sub(pattern, transform_image, markdown, flags=re.DOTALL)


router = APIRouter(prefix="/documents/{document_id}/workflows", tags=["workflows"])


class WorkflowListResponse(BaseModel):
    workflow_id: str
    status: str
    file_name: str
    file_uri: str
    language: str | None = None
    created_at: str
    updated_at: str


class SegmentData(BaseModel):
    segment_index: int
    image_uri: str
    image_url: str | None = None
    bda_indexer: str
    paddleocr: str
    format_parser: str
    image_analysis: list[dict]


class WorkflowDetailResponse(BaseModel):
    workflow_id: str
    document_id: str
    status: str
    file_name: str
    file_uri: str
    file_type: str
    language: str | None = None
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
            language=wf.data.language,
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

    file_uri = wf.data.file_uri

    # Get segment references from DynamoDB
    segment_items = query_workflow_segments(workflow_id)
    segments = []

    for seg in segment_items:
        # Get actual segment data from S3
        print(f"[DEBUG] segment {seg.data.segment_index}: s3_key={seg.data.s3_key}")
        s3_data = _get_segment_from_s3(file_uri, seg.data.s3_key)
        print(f"[DEBUG] s3_data loaded: {s3_data is not None}")

        if s3_data:
            print(f"[DEBUG] image_uri from S3: {s3_data.get('image_uri', '')[:100]}")
            print(f"[DEBUG] bda_indexer preview: {s3_data.get('bda_indexer', '')[:200]}")
            # Data from S3
            image_uri = _fix_image_uri(s3_data.get("image_uri", ""))
            bda_indexer = _transform_markdown_images(s3_data.get("bda_indexer", ""), image_uri)
            paddleocr = s3_data.get("paddleocr", "")
            format_parser = _transform_markdown_images(s3_data.get("format_parser", ""), image_uri)

            # Transform image_analysis content
            raw_image_analysis = s3_data.get("image_analysis", [])
            image_analysis = [
                {
                    "analysis_query": ia.get("analysis_query", ""),
                    "content": _transform_markdown_images(ia.get("content", ""), image_uri),
                }
                for ia in raw_image_analysis
            ]

            segments.append(
                SegmentData(
                    segment_index=s3_data.get("segment_index", seg.data.segment_index),
                    image_uri=image_uri,
                    image_url=_generate_presigned_url(image_uri),
                    bda_indexer=bda_indexer,
                    paddleocr=paddleocr,
                    format_parser=format_parser,
                    image_analysis=image_analysis,
                )
            )
        else:
            # Fallback: use DDB data (for backward compatibility)
            image_uri = _fix_image_uri(seg.data.image_uri)
            segments.append(
                SegmentData(
                    segment_index=seg.data.segment_index,
                    image_uri=image_uri,
                    image_url=_generate_presigned_url(image_uri),
                    bda_indexer="",
                    paddleocr="",
                    format_parser="",
                    image_analysis=[],
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
        language=wf.data.language,
        total_segments=wf.data.total_segments or len(segments),
        created_at=wf.created_at,
        updated_at=wf.updated_at,
        segments=segments,
    )
