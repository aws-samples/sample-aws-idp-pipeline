import json
from datetime import datetime

import boto3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.ddb import get_document_item
from app.ddb.workflows import get_workflow_item, query_workflows, update_workflow_status
from app.markdown import transform_markdown_images
from app.s3 import generate_presigned_url, get_s3_client, get_segment_key_by_index, list_segment_keys, parse_s3_uri


def _get_display_file_name(project_id: str, document_id: str, fallback_name: str) -> str:
    """Get original file name from document record for display."""
    doc = get_document_item(project_id, document_id)
    if doc and doc.data.name:
        return doc.data.name
    return fallback_name


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


class TranscribeSegment(BaseModel):
    start_time: float
    end_time: float
    transcript: str


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
    paddleocr_blocks: dict | None = None
    format_parser: str
    ai_analysis: list[dict]
    transcribe_segments: list[TranscribeSegment] | None = None


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
            file_name=_get_display_file_name(wf.data.project_id, document_id, wf.data.file_name),
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

    # Count segments from S3 if total_segments not in metadata
    total_segments = wf.data.total_segments
    if not total_segments:
        segment_keys = list_segment_keys(wf.data.file_uri)
        total_segments = len(segment_keys)

    return WorkflowDetailResponse(
        workflow_id=workflow_id,
        document_id=document_id,
        status=wf.data.status,
        file_name=_get_display_file_name(wf.data.project_id, document_id, wf.data.file_name),
        file_uri=wf.data.file_uri,
        file_type=wf.data.file_type,
        language=wf.data.language,
        total_segments=total_segments,
        created_at=wf.created_at,
        updated_at=wf.updated_at,
        segments=[],
    )


def _build_segment_data(file_uri: str, s3_key: str) -> SegmentData | None:
    """Load a single segment from S3 and transform it into SegmentData."""
    s3_data = _get_segment_from_s3(file_uri, s3_key)
    if not s3_data:
        return None

    image_uri = s3_data.get("image_uri", "")
    bda_indexer = transform_markdown_images(s3_data.get("bda_indexer", ""), image_uri)
    paddleocr_blocks = s3_data.get("paddleocr_blocks")
    format_parser = transform_markdown_images(s3_data.get("format_parser", ""), image_uri)

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

    video_url = None
    if segment_type in ("VIDEO", "CHAPTER") and segment_file_uri:
        video_url = generate_presigned_url(segment_file_uri)

    raw_transcribe = s3_data.get("transcribe_segments", [])
    transcribe_segments = (
        [
            TranscribeSegment(
                start_time=ts.get("start_time", 0),
                end_time=ts.get("end_time", 0),
                transcript=ts.get("transcript", ""),
            )
            for ts in raw_transcribe
        ]
        if raw_transcribe
        else None
    )

    return SegmentData(
        segment_index=s3_data.get("segment_index", 0),
        segment_type=segment_type,
        image_uri=image_uri,
        image_url=generate_presigned_url(image_uri),
        file_uri=segment_file_uri,
        video_url=video_url,
        start_timecode_smpte=s3_data.get("start_timecode_smpte"),
        end_timecode_smpte=s3_data.get("end_timecode_smpte"),
        bda_indexer=bda_indexer,
        paddleocr_blocks=paddleocr_blocks,
        format_parser=format_parser,
        ai_analysis=ai_analysis,
        transcribe_segments=transcribe_segments,
    )


@router.get("/{workflow_id}/segments/{segment_index}")
def get_segment(document_id: str, workflow_id: str, segment_index: int) -> SegmentData:
    """Get a single segment by index."""
    wf = get_workflow_item(document_id, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    bucket, s3_key = get_segment_key_by_index(wf.data.file_uri, segment_index)
    segment = _build_segment_data(wf.data.file_uri, s3_key)

    if not segment:
        raise HTTPException(status_code=404, detail=f"Segment {segment_index} not found")

    return segment


class ReanalysisRequest(BaseModel):
    user_instructions: str = ""


class ReanalysisResponse(BaseModel):
    workflow_id: str
    execution_arn: str
    status: str


@router.post("/{workflow_id}/reanalyze")
def reanalyze_workflow(document_id: str, workflow_id: str, request: ReanalysisRequest) -> ReanalysisResponse:
    """Trigger re-analysis for a workflow with optional user instructions."""
    config = get_config()

    # Get existing workflow
    wf = get_workflow_item(document_id, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Verify workflow is completed
    if wf.data.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Workflow must be completed or failed to reanalyze. Current status: {wf.data.status}",
        )

    # Get Step Function ARN
    step_function_arn = config.step_function_arn
    if not step_function_arn:
        raise HTTPException(status_code=500, detail="Step Function ARN not configured")

    # Prepare Step Functions input for re-analysis
    sfn_input = {
        "workflow_id": workflow_id,
        "document_id": document_id,
        "project_id": wf.data.project_id,
        "file_uri": wf.data.file_uri,
        "file_name": wf.data.file_name,
        "file_type": wf.data.file_type,
        "is_reanalysis": True,
        "user_instructions": request.user_instructions,
        "triggered_at": datetime.utcnow().isoformat(),
    }

    # Start Step Functions execution
    try:
        sfn_client = boto3.client("stepfunctions", region_name=config.aws_region)
        execution_name = f"reanalyze-{workflow_id[:16]}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        response = sfn_client.start_execution(
            stateMachineArn=step_function_arn,
            name=execution_name,
            input=json.dumps(sfn_input),
        )

        execution_arn = response["executionArn"]

        # Update workflow status
        update_workflow_status(document_id, workflow_id, "reanalyzing", execution_arn)

        return ReanalysisResponse(
            workflow_id=workflow_id,
            execution_arn=execution_arn,
            status="reanalyzing",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start re-analysis: {e}") from e


class RegenerateQaRequest(BaseModel):
    qa_index: int
    question: str
    user_instructions: str = ""


class RegenerateQaResponse(BaseModel):
    analysis_query: str
    content: str


@router.post("/{workflow_id}/segments/{segment_index}/regenerate-qa")
def regenerate_qa(
    document_id: str,
    workflow_id: str,
    segment_index: int,
    request: RegenerateQaRequest,
) -> RegenerateQaResponse:
    """Regenerate a single Q&A item for a segment."""
    config = get_config()

    wf = get_workflow_item(document_id, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if wf.data.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Workflow must be completed or failed. Current status: {wf.data.status}",
        )

    function_arn = config.qa_regenerator_function_arn
    if not function_arn:
        raise HTTPException(status_code=500, detail="QA regenerator function not configured")

    # Determine language
    language_map = {"ko": "Korean", "en": "English", "ja": "Japanese"}
    language = language_map.get(wf.data.language or "en", "English")

    payload = {
        "file_uri": wf.data.file_uri,
        "segment_index": segment_index,
        "qa_index": request.qa_index,
        "question": request.question,
        "user_instructions": request.user_instructions,
        "language": language,
        "workflow_id": workflow_id,
        "document_id": document_id,
        "project_id": wf.data.project_id,
        "file_type": wf.data.file_type,
    }

    try:
        lambda_client = boto3.client("lambda", region_name=config.aws_region)
        response = lambda_client.invoke(
            FunctionName=function_arn,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        result_payload = json.loads(response["Payload"].read().decode("utf-8"))

        if "FunctionError" in response:
            raise HTTPException(
                status_code=500,
                detail=f"Lambda error: {result_payload}",
            )

        if result_payload.get("statusCode", 200) != 200:
            raise HTTPException(
                status_code=result_payload.get("statusCode", 500),
                detail=result_payload.get("error", "Unknown error"),
            )

        return RegenerateQaResponse(
            analysis_query=result_payload.get("analysis_query", request.question),
            content=result_payload.get("content", ""),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to regenerate Q&A: {e}") from e


class AddQaRequest(BaseModel):
    question: str
    user_instructions: str = ""


class AddQaResponse(BaseModel):
    analysis_query: str
    content: str
    qa_index: int


@router.post("/{workflow_id}/segments/{segment_index}/add-qa")
def add_qa(
    document_id: str,
    workflow_id: str,
    segment_index: int,
    request: AddQaRequest,
) -> AddQaResponse:
    """Add a new Q&A item to a segment."""
    config = get_config()

    wf = get_workflow_item(document_id, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if wf.data.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Workflow must be completed or failed. Current status: {wf.data.status}",
        )

    function_arn = config.qa_regenerator_function_arn
    if not function_arn:
        raise HTTPException(status_code=500, detail="QA regenerator function not configured")

    language_map = {"ko": "Korean", "en": "English", "ja": "Japanese"}
    language = language_map.get(wf.data.language or "en", "English")

    payload = {
        "mode": "add",
        "file_uri": wf.data.file_uri,
        "segment_index": segment_index,
        "question": request.question,
        "user_instructions": request.user_instructions,
        "language": language,
        "workflow_id": workflow_id,
        "document_id": document_id,
        "project_id": wf.data.project_id,
        "file_type": wf.data.file_type,
    }

    try:
        lambda_client = boto3.client("lambda", region_name=config.aws_region)
        response = lambda_client.invoke(
            FunctionName=function_arn,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        result_payload = json.loads(response["Payload"].read().decode("utf-8"))

        if "FunctionError" in response:
            raise HTTPException(
                status_code=500,
                detail=f"Lambda error: {result_payload}",
            )

        if result_payload.get("statusCode", 200) != 200:
            raise HTTPException(
                status_code=result_payload.get("statusCode", 500),
                detail=result_payload.get("error", "Unknown error"),
            )

        return AddQaResponse(
            analysis_query=result_payload.get("analysis_query", request.question),
            content=result_payload.get("content", ""),
            qa_index=result_payload.get("qa_index", 0),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add Q&A: {e}") from e


class DeleteQaResponse(BaseModel):
    deleted: bool
    deleted_query: str
    qa_index: int


@router.delete("/{workflow_id}/segments/{segment_index}/qa/{qa_index}")
def delete_qa(
    document_id: str,
    workflow_id: str,
    segment_index: int,
    qa_index: int,
) -> DeleteQaResponse:
    """Delete a Q&A item from a segment."""
    config = get_config()

    wf = get_workflow_item(document_id, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if wf.data.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Workflow must be completed or failed. Current status: {wf.data.status}",
        )

    function_arn = config.qa_regenerator_function_arn
    if not function_arn:
        raise HTTPException(status_code=500, detail="QA regenerator function not configured")

    payload = {
        "mode": "delete",
        "file_uri": wf.data.file_uri,
        "segment_index": segment_index,
        "qa_index": qa_index,
        "workflow_id": workflow_id,
        "document_id": document_id,
        "project_id": wf.data.project_id,
        "file_type": wf.data.file_type,
    }

    try:
        lambda_client = boto3.client("lambda", region_name=config.aws_region)
        response = lambda_client.invoke(
            FunctionName=function_arn,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        result_payload = json.loads(response["Payload"].read().decode("utf-8"))

        if "FunctionError" in response:
            raise HTTPException(
                status_code=500,
                detail=f"Lambda error: {result_payload}",
            )

        if result_payload.get("statusCode", 200) != 200:
            raise HTTPException(
                status_code=result_payload.get("statusCode", 500),
                detail=result_payload.get("error", "Unknown error"),
            )

        return DeleteQaResponse(
            deleted=result_payload.get("deleted", True),
            deleted_query=result_payload.get("deleted_query", ""),
            qa_index=result_payload.get("qa_index", qa_index),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete Q&A: {e}") from e
