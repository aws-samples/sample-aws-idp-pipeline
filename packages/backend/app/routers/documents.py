import contextlib
import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])
workflows_router = APIRouter(prefix="/projects/{project_id}/workflows", tags=["workflows"])

_ddb_resource = None
_s3_client = None


def get_ddb_resource():
    global _ddb_resource
    if _ddb_resource is None:
        _ddb_resource = boto3.resource("dynamodb")
    return _ddb_resource


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def get_table():
    config = get_config()
    return get_ddb_resource().Table(config.backend_table_name)


def decimal_to_python(obj: Any) -> Any:
    """Convert DynamoDB Decimal types to Python native types."""
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_python(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_python(i) for i in obj]
    return obj


def generate_presigned_url_from_s3_uri(s3_uri: str, expires_in: int = 3600) -> str | None:
    """Generate presigned URL from S3 URI (s3://bucket/key)."""
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None

    s3 = get_s3_client()
    # Parse s3://bucket/key format
    uri_parts = s3_uri[5:].split("/", 1)
    if len(uri_parts) != 2:
        return None

    bucket = uri_parts[0]
    key = uri_parts[1]

    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def transform_markdown_images(content: str, image_uri: str) -> str:
    """Transform relative image paths in markdown to presigned URLs.

    Converts ![alt](./uuid.png) to ![alt](presigned_url)
    based on the assets folder path from image_uri.
    """
    if not content or not image_uri:
        return content

    # Extract base path up to 'assets/' from image_uri
    # e.g., s3://bucket/bda-output/.../assets/rectified_image_0.png
    # -> s3://bucket/bda-output/.../assets/
    assets_match = re.search(r"(s3://[^/]+/.+/assets/)", image_uri)
    if not assets_match:
        return content

    assets_base = assets_match.group(1)

    # Find all relative image paths: ](./filename.ext)
    # This handles cases where alt text contains special characters like [ or ]
    def replace_image_path(match: re.Match) -> str:
        filename = match.group(1)
        # Build full S3 URI
        s3_uri = f"{assets_base}{filename}"
        presigned_url = generate_presigned_url_from_s3_uri(s3_uri)
        if presigned_url:
            return f"]({presigned_url})"
        return match.group(0)  # Return original if failed

    # Match ](./filename.ext) - just the path part, not the alt text
    pattern = r"\]\(\./([^)]+)\)"
    return re.sub(pattern, replace_image_path, content)


class DocumentUploadRequest(BaseModel):
    file_name: str
    content_type: str
    file_size: int


class DocumentUploadResponse(BaseModel):
    document_id: str
    upload_url: str
    file_name: str


class DocumentResponse(BaseModel):
    document_id: str
    project_id: str
    name: str
    file_type: str
    file_size: int
    status: str
    s3_key: str
    started_at: str
    ended_at: str | None = None


class DocumentStatusUpdate(BaseModel):
    status: str


@router.get("")
def list_documents(project_id: str) -> list[DocumentResponse]:
    """List all documents for a project."""
    table = get_table()

    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}") & Key("SK").begins_with("DOC#"),
    )

    documents = []
    for item in response.get("Items", []):
        data = item.get("data", {})
        documents.append(
            DocumentResponse(
                document_id=data.get("document_id", ""),
                project_id=data.get("project_id", ""),
                name=data.get("name", ""),
                file_type=data.get("file_type", ""),
                file_size=data.get("file_size", 0),
                status=data.get("status", "pending"),
                s3_key=data.get("s3_key", ""),
                started_at=item.get("started_at", ""),
                ended_at=item.get("ended_at"),
            )
        )

    return documents


@router.post("")
def create_document_upload(project_id: str, request: DocumentUploadRequest) -> DocumentUploadResponse:
    """Create a document record and return a presigned URL for upload."""
    config = get_config()
    table = get_table()
    s3 = get_s3_client()

    # Validate file size (500MB max)
    max_size = 500 * 1024 * 1024  # 500MB
    if request.file_size > max_size:
        raise HTTPException(status_code=400, detail="File size exceeds 500MB limit")

    # Check project exists
    project_response = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"PROJ#{project_id}"})
    if not project_response.get("Item"):
        raise HTTPException(status_code=404, detail="Project not found")

    # Generate document ID and S3 key
    document_id = str(uuid.uuid4())
    s3_key = f"projects/{project_id}/documents/{document_id}/{request.file_name}"
    now = datetime.now(UTC).isoformat()

    # Create document record in DynamoDB
    item = {
        "PK": f"PROJ#{project_id}",
        "SK": f"DOC#{document_id}",
        "data": {
            "document_id": document_id,
            "project_id": project_id,
            "name": request.file_name,
            "file_type": request.content_type,
            "file_size": request.file_size,
            "status": "uploading",
            "s3_key": s3_key,
        },
        "started_at": now,
        "ended_at": now,
    }
    table.put_item(Item=item)

    # Generate presigned URL for upload (valid for 1 hour)
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": config.document_storage_bucket_name,
            "Key": s3_key,
            "ContentType": request.content_type,
        },
        ExpiresIn=3600,
    )

    return DocumentUploadResponse(
        document_id=document_id,
        upload_url=upload_url,
        file_name=request.file_name,
    )


@router.put("/{document_id}/status")
def update_document_status(project_id: str, document_id: str, request: DocumentStatusUpdate) -> DocumentResponse:
    """Update document status after upload completion."""
    table = get_table()

    # Check document exists
    existing = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"})
    if not existing.get("Item"):
        raise HTTPException(status_code=404, detail="Document not found")

    now = datetime.now(UTC).isoformat()
    item = existing.get("Item")
    data = item.get("data", {})
    data["status"] = request.status

    table.update_item(
        Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"},
        UpdateExpression="SET #data = :data, ended_at = :ended_at",
        ExpressionAttributeNames={"#data": "data"},
        ExpressionAttributeValues={
            ":data": data,
            ":ended_at": now,
        },
    )

    # Get updated document
    response = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"})
    item = response.get("Item", {})
    data = item.get("data", {})

    return DocumentResponse(
        document_id=data.get("document_id", ""),
        project_id=data.get("project_id", ""),
        name=data.get("name", ""),
        file_type=data.get("file_type", ""),
        file_size=data.get("file_size", 0),
        status=data.get("status", ""),
        s3_key=data.get("s3_key", ""),
        started_at=item.get("started_at", ""),
        ended_at=item.get("ended_at"),
    )


@router.get("/{document_id}")
def get_document(project_id: str, document_id: str) -> DocumentResponse:
    """Get a single document."""
    table = get_table()

    response = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"})
    item = response.get("Item")

    if not item:
        raise HTTPException(status_code=404, detail="Document not found")

    data = item.get("data", {})
    return DocumentResponse(
        document_id=data.get("document_id", ""),
        project_id=data.get("project_id", ""),
        name=data.get("name", ""),
        file_type=data.get("file_type", ""),
        file_size=data.get("file_size", 0),
        status=data.get("status", ""),
        s3_key=data.get("s3_key", ""),
        started_at=item.get("started_at", ""),
        ended_at=item.get("ended_at"),
    )


@router.delete("/{document_id}")
def delete_document(project_id: str, document_id: str) -> dict:
    """Delete a document and all related data (DynamoDB, S3, LanceDB)."""
    config = get_config()
    table = get_table()
    s3 = get_s3_client()

    # Check document exists and get info
    existing = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"})
    item = existing.get("Item")

    if not item:
        raise HTTPException(status_code=404, detail="Document not found")

    data = item.get("data", {})
    document_name = data.get("name", "")
    s3_key = data.get("s3_key", "")

    # Find related workflow by document name
    workflow_id = None
    workflow_response = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}") & Key("SK").begins_with("WF#"),
    )
    for wf_item in workflow_response.get("Items", []):
        wf_data = wf_item.get("data", {})
        if wf_data.get("file_name") == document_name:
            workflow_id = wf_item["SK"].replace("WF#", "")
            break

    deleted_info = {"document_id": document_id, "workflow_id": workflow_id}

    # 1. Delete from LanceDB (if workflow exists)
    if workflow_id:
        try:
            import lancedb

            bucket_name = _get_ssm_parameter("/idp-v2/lancedb/storage/bucket-name")
            lock_table_name = _get_ssm_parameter("/idp-v2/lancedb/lock/table-name")
            db = lancedb.connect(f"s3+ddb://{bucket_name}/idp-v2?ddbTableName={lock_table_name}")
            if "documents" in db.table_names():
                lance_table = db.open_table("documents")
                lance_table.delete(f"workflow_id = '{workflow_id}'")
                deleted_info["lancedb_deleted"] = True
        except Exception as e:
            deleted_info["lancedb_error"] = str(e)

    # 2. Delete from S3 - document file
    if s3_key:
        with contextlib.suppress(Exception):
            s3.delete_object(Bucket=config.document_storage_bucket_name, Key=s3_key)

    # 3. Delete from S3 - entire document folder
    doc_prefix = f"projects/{project_id}/documents/{document_id}/"
    with contextlib.suppress(Exception):
        _delete_s3_prefix(s3, config.document_storage_bucket_name, doc_prefix)

    # 4. Delete workflow data from DynamoDB
    if workflow_id:
        # Delete all WF#{workflow_id} items (META, STEP, SEG#*, ANALYSIS#*, CONN#*)
        wf_items_response = table.query(KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}"))
        wf_items = wf_items_response.get("Items", [])

        # Handle pagination
        while wf_items_response.get("LastEvaluatedKey"):
            wf_items_response = table.query(
                KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}"),
                ExclusiveStartKey=wf_items_response["LastEvaluatedKey"],
            )
            wf_items.extend(wf_items_response.get("Items", []))

        # Batch delete
        with table.batch_writer() as batch:
            for wf_item in wf_items:
                batch.delete_item(Key={"PK": wf_item["PK"], "SK": wf_item["SK"]})

        deleted_info["workflow_items_deleted"] = len(wf_items)

        # Delete project-workflow link
        with contextlib.suppress(Exception):
            table.delete_item(Key={"PK": f"PROJ#{project_id}", "SK": f"WF#{workflow_id}"})

    # 5. Delete document item from DynamoDB
    table.delete_item(Key={"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"})

    return {"message": f"Document {document_id} deleted", "details": deleted_info}


def _get_ssm_parameter(key: str) -> str:
    """Get SSM parameter value."""
    ssm = boto3.client("ssm")
    response = ssm.get_parameter(Name=key)
    return response["Parameter"]["Value"]


def _delete_s3_prefix(s3_client, bucket: str, prefix: str) -> int:
    """Delete all objects under a prefix."""
    deleted_count = 0
    paginator = s3_client.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue

        delete_keys = [{"Key": obj["Key"]} for obj in objects]
        s3_client.delete_objects(Bucket=bucket, Delete={"Objects": delete_keys})
        deleted_count += len(delete_keys)

    return deleted_count


# ============================================
# Workflow endpoints
# ============================================


class WorkflowSummary(BaseModel):
    workflow_id: str
    status: str
    file_name: str
    file_uri: str
    started_at: str
    ended_at: str | None = None


class SegmentData(BaseModel):
    segment_index: int
    image_uri: str
    image_url: str | None = None
    bda_indexer: str
    format_parser: str
    image_analysis: list[dict]


class PresignedUrlResponse(BaseModel):
    url: str


class WorkflowDetail(BaseModel):
    workflow_id: str
    project_id: str
    status: str
    file_name: str
    file_uri: str
    file_type: str
    total_segments: int
    started_at: str
    ended_at: str | None = None
    segments: list[SegmentData]


@workflows_router.get("")
def list_workflows(project_id: str) -> list[WorkflowSummary]:
    """List all workflows for a project."""
    table = get_table()

    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}") & Key("SK").begins_with("WF#"),
    )

    workflows = []
    for item in response.get("Items", []):
        item = decimal_to_python(item)
        data = item.get("data", {})
        sk = item.get("SK", "")
        workflow_id = sk.replace("WF#", "") if sk.startswith("WF#") else ""

        workflows.append(
            WorkflowSummary(
                workflow_id=workflow_id,
                status=data.get("status", ""),
                file_name=data.get("file_name", ""),
                file_uri=data.get("file_uri", ""),
                started_at=item.get("started_at", ""),
                ended_at=item.get("ended_at"),
            )
        )

    return workflows


@workflows_router.get("/{workflow_id}")
def get_workflow(project_id: str, workflow_id: str) -> WorkflowDetail:
    """Get workflow details including all segments."""
    table = get_table()

    # Get workflow metadata
    meta_response = table.get_item(Key={"PK": f"WF#{workflow_id}", "SK": "META"})
    meta_item = meta_response.get("Item")

    if not meta_item:
        raise HTTPException(status_code=404, detail="Workflow not found")

    meta_item = decimal_to_python(meta_item)
    meta_data = meta_item.get("data", {})

    # Verify workflow belongs to project
    if meta_data.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Workflow not found in this project")

    # Get all segments
    segments_response = table.query(
        KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}") & Key("SK").begins_with("SEG#"),
    )

    segments = []
    for seg_item in segments_response.get("Items", []):
        seg_item = decimal_to_python(seg_item)
        seg_data = seg_item.get("data", {})
        image_uri = seg_data.get("image_uri", "")
        bda_indexer = seg_data.get("bda_indexer", "")
        format_parser = seg_data.get("format_parser", "")
        image_analysis = seg_data.get("image_analysis", [])

        # Transform markdown images to presigned URLs
        if image_uri:
            bda_indexer = transform_markdown_images(bda_indexer, image_uri)
            format_parser = transform_markdown_images(format_parser, image_uri)
            # Transform image_analysis content as well
            image_analysis = [
                {
                    **item,
                    "content": transform_markdown_images(item.get("content", ""), image_uri),
                }
                for item in image_analysis
            ]

        segments.append(
            SegmentData(
                segment_index=seg_data.get("segment_index", 0),
                image_uri=image_uri,
                image_url=generate_presigned_url_from_s3_uri(image_uri),
                bda_indexer=bda_indexer,
                format_parser=format_parser,
                image_analysis=image_analysis,
            )
        )

    # Sort segments by index
    segments.sort(key=lambda s: s.segment_index)

    return WorkflowDetail(
        workflow_id=workflow_id,
        project_id=project_id,
        status=meta_data.get("status", ""),
        file_name=meta_data.get("file_name", ""),
        file_uri=meta_data.get("file_uri", ""),
        file_type=meta_data.get("file_type", ""),
        total_segments=meta_data.get("total_segments", len(segments)),
        started_at=meta_item.get("started_at", ""),
        ended_at=meta_item.get("ended_at"),
        segments=segments,
    )
