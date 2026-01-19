import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ddb.workflows import get_workflow_item, query_workflow_segments, query_workflows
from app.markdown import fix_image_uri, transform_markdown_images
from app.s3 import generate_presigned_url, get_s3_client, parse_s3_uri


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
        bucket, _ = parse_s3_uri(file_uri)

        response = s3.get_object(Bucket=bucket, Key=s3_key)
        return json.loads(response["Body"].read().decode("utf-8"))
    except Exception as e:
        print(f"Error getting segment from S3 {s3_key}: {e}")
        return None


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
    segment_type: str | None = "PAGE"
    image_uri: str
    image_url: str | None = None
    file_uri: str | None = None
    video_url: str | None = None
    start_timecode_smpte: str | None = None
    end_timecode_smpte: str | None = None
    bda_indexer: str
    paddleocr: str
    format_parser: str
    ai_analysis: list[dict]


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
            image_uri = fix_image_uri(s3_data.get("image_uri", ""))
            bda_indexer = transform_markdown_images(s3_data.get("bda_indexer", ""), image_uri)
            paddleocr = s3_data.get("paddleocr", "")
            format_parser = transform_markdown_images(s3_data.get("format_parser", ""), image_uri)

            # Transform ai_analysis content
            raw_ai_analysis = s3_data.get("ai_analysis", [])
            ai_analysis = [
                {
                    "analysis_query": ia.get("analysis_query", ""),
                    "content": transform_markdown_images(ia.get("content", ""), image_uri),
                }
                for ia in raw_ai_analysis
            ]

            segment_type = s3_data.get("segment_type", "PAGE")
            segment_file_uri = s3_data.get("file_uri")

            # Generate video_url for VIDEO/CHAPTER segments
            video_url = None
            if segment_type in ("VIDEO", "CHAPTER") and segment_file_uri:
                video_url = generate_presigned_url(segment_file_uri)

            segments.append(
                SegmentData(
                    segment_index=s3_data.get("segment_index", seg.data.segment_index),
                    segment_type=segment_type,
                    image_uri=image_uri,
                    image_url=generate_presigned_url(image_uri),
                    file_uri=segment_file_uri,
                    video_url=video_url,
                    start_timecode_smpte=s3_data.get("start_timecode_smpte"),
                    end_timecode_smpte=s3_data.get("end_timecode_smpte"),
                    bda_indexer=bda_indexer,
                    paddleocr=paddleocr,
                    format_parser=format_parser,
                    ai_analysis=ai_analysis,
                )
            )
        else:
            # Fallback: use DDB data (for backward compatibility)
            image_uri = fix_image_uri(seg.data.image_uri)
            segments.append(
                SegmentData(
                    segment_index=seg.data.segment_index,
                    image_uri=image_uri,
                    image_url=generate_presigned_url(image_uri),
                    bda_indexer="",
                    paddleocr="",
                    format_parser="",
                    ai_analysis=[],
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
