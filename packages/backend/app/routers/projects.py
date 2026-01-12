import contextlib
from datetime import UTC, datetime

import boto3
from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config

router = APIRouter(prefix="/projects", tags=["projects"])

_ddb_resource = None


def get_ddb_resource():
    global _ddb_resource
    if _ddb_resource is None:
        _ddb_resource = boto3.resource("dynamodb")
    return _ddb_resource


def get_table():
    config = get_config()
    return get_ddb_resource().Table(config.backend_table_name)


class ProjectCreate(BaseModel):
    project_id: str
    name: str
    description: str | None = ""


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    description: str
    status: str
    started_at: str
    ended_at: str | None = None


@router.get("")
def list_projects() -> list[ProjectResponse]:
    table = get_table()
    response = table.scan(
        FilterExpression="begins_with(PK, :pk) AND begins_with(SK, :sk)",
        ExpressionAttributeValues={":pk": "PROJ#", ":sk": "PROJ#"},
    )

    projects = []
    for item in response.get("Items", []):
        data = item.get("data", {})
        projects.append(
            ProjectResponse(
                project_id=data.get("project_id", ""),
                name=data.get("name", ""),
                description=data.get("description", ""),
                status=data.get("status", "active"),
                started_at=item.get("started_at", ""),
                ended_at=item.get("ended_at"),
            )
        )

    return projects


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectResponse:
    table = get_table()
    response = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"PROJ#{project_id}"})

    item = response.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Project not found")

    data = item.get("data", {})
    return ProjectResponse(
        project_id=data.get("project_id", ""),
        name=data.get("name", ""),
        description=data.get("description", ""),
        status=data.get("status", "active"),
        started_at=item.get("started_at", ""),
        ended_at=item.get("ended_at"),
    )


@router.post("")
def create_project(request: ProjectCreate) -> ProjectResponse:
    table = get_table()
    now = datetime.now(UTC).isoformat()

    existing = table.get_item(Key={"PK": f"PROJ#{request.project_id}", "SK": f"PROJ#{request.project_id}"})
    if existing.get("Item"):
        raise HTTPException(status_code=409, detail="Project already exists")

    item = {
        "PK": f"PROJ#{request.project_id}",
        "SK": f"PROJ#{request.project_id}",
        "data": {
            "project_id": request.project_id,
            "name": request.name,
            "description": request.description or "",
            "status": "active",
        },
        "started_at": now,
        "ended_at": now,
    }

    table.put_item(Item=item)

    return ProjectResponse(
        project_id=request.project_id,
        name=request.name,
        description=request.description or "",
        status="active",
        started_at=now,
        ended_at=now,
    )


@router.put("/{project_id}")
def update_project(project_id: str, request: ProjectUpdate) -> ProjectResponse:
    table = get_table()

    existing = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"PROJ#{project_id}"})
    if not existing.get("Item"):
        raise HTTPException(status_code=404, detail="Project not found")

    now = datetime.now(UTC).isoformat()
    item = existing.get("Item")
    data = item.get("data", {})

    if request.name is not None:
        data["name"] = request.name

    if request.description is not None:
        data["description"] = request.description

    table.update_item(
        Key={"PK": f"PROJ#{project_id}", "SK": f"PROJ#{project_id}"},
        UpdateExpression="SET #data = :data, ended_at = :ended_at",
        ExpressionAttributeNames={"#data": "data"},
        ExpressionAttributeValues={":data": data, ":ended_at": now},
    )

    return get_project(project_id)


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    """Delete a project and all related data (documents, workflows, S3, LanceDB)."""
    config = get_config()
    table = get_table()
    s3 = _get_s3_client()

    existing = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": f"PROJ#{project_id}"})
    if not existing.get("Item"):
        raise HTTPException(status_code=404, detail="Project not found")

    deleted_info = {"project_id": project_id}

    # 1. Get all items under this project
    project_items_response = table.query(KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}"))
    project_items = project_items_response.get("Items", [])

    # Handle pagination
    while project_items_response.get("LastEvaluatedKey"):
        project_items_response = table.query(
            KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}"),
            ExclusiveStartKey=project_items_response["LastEvaluatedKey"],
        )
        project_items.extend(project_items_response.get("Items", []))

    # Extract workflow IDs
    workflow_ids = [item["SK"].replace("WF#", "") for item in project_items if item["SK"].startswith("WF#")]
    deleted_info["workflow_count"] = len(workflow_ids)

    # 2. Delete from LanceDB (all workflows)
    if workflow_ids:
        try:
            import lancedb

            bucket_name = _get_ssm_parameter("/idp-v2/lancedb/storage/bucket-name")
            lock_table_name = _get_ssm_parameter("/idp-v2/lancedb/lock/table-name")
            db = lancedb.connect(f"s3+ddb://{bucket_name}/idp-v2?ddbTableName={lock_table_name}")
            if "documents" in db.table_names():
                lance_table = db.open_table("documents")
                for workflow_id in workflow_ids:
                    with contextlib.suppress(Exception):
                        lance_table.delete(f"workflow_id = '{workflow_id}'")
                deleted_info["lancedb_deleted"] = True
        except Exception as e:
            deleted_info["lancedb_error"] = str(e)

    # 3. Delete workflow data from DynamoDB (all WF#{id} items)
    total_wf_items_deleted = 0
    for workflow_id in workflow_ids:
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
                total_wf_items_deleted += 1

    deleted_info["workflow_items_deleted"] = total_wf_items_deleted

    # 4. Delete from S3 - entire project folder
    project_prefix = f"projects/{project_id}/"
    with contextlib.suppress(Exception):
        s3_deleted = _delete_s3_prefix(s3, config.document_storage_bucket_name, project_prefix)
        deleted_info["s3_objects_deleted"] = s3_deleted

    # 5. Delete all project items from DynamoDB (PROJ#, DOC#*, WF#* links)
    with table.batch_writer() as batch:
        for item in project_items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})

    deleted_info["project_items_deleted"] = len(project_items)

    return {"message": f"Project {project_id} deleted", "details": deleted_info}


_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


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
