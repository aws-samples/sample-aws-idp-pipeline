import contextlib

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.ddb import (
    Project,
    ProjectData,
    batch_delete_items,
    generate_project_id,
    get_project_item,
    now_iso,
    put_project_item,
    query_all_project_items,
    query_projects,
    update_project_data,
)
from app.ddb.workflows import delete_workflow_item, query_workflows
from app.s3 import delete_s3_prefix

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    description: str | None = ""
    created_by: str | None = None
    language: str | None = None
    color: int | None = None
    ocr_model: str | None = None
    ocr_options: dict | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    language: str | None = None
    color: int | None = None
    document_prompt: str | None = None
    ocr_model: str | None = None
    ocr_options: dict | None = None


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    description: str
    status: str
    created_by: str | None = None
    language: str | None = None
    color: int | None = None
    document_prompt: str | None = None
    ocr_model: str | None = None
    ocr_options: dict | None = None
    created_at: str
    updated_at: str | None = None

    @staticmethod
    def from_project(project: Project) -> "ProjectResponse":
        return ProjectResponse(
            project_id=project.data.project_id,
            name=project.data.name,
            description=project.data.description,
            status=project.data.status,
            created_by=project.data.created_by,
            language=project.data.language,
            color=project.data.color,
            document_prompt=project.data.document_prompt,
            ocr_model=project.data.ocr_model,
            ocr_options=project.data.ocr_options,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )


@router.get("")
def list_projects() -> list[ProjectResponse]:
    projects = query_projects()
    return [ProjectResponse.from_project(p) for p in projects]


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectResponse:
    project = get_project_item(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return ProjectResponse.from_project(project)


@router.post("")
def create_project(request: ProjectCreate) -> ProjectResponse:
    project_id = generate_project_id()

    now = now_iso()
    data = ProjectData(
        project_id=project_id,
        name=request.name,
        description=request.description or "",
        status="active",
        created_by=request.created_by,
        language=request.language,
        color=request.color,
        ocr_model=request.ocr_model,
        ocr_options=request.ocr_options,
    )

    put_project_item(project_id, data)

    return ProjectResponse(
        project_id=project_id,
        name=request.name,
        description=request.description or "",
        status="active",
        created_by=request.created_by,
        language=request.language,
        color=request.color,
        ocr_model=request.ocr_model,
        ocr_options=request.ocr_options,
        created_at=now,
        updated_at=now,
    )


@router.put("/{project_id}")
def update_project(project_id: str, request: ProjectUpdate) -> ProjectResponse:
    existing = get_project_item(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")

    data = existing.data.model_copy(update={k: v for k, v in request.model_dump().items() if v is not None})

    update_project_data(project_id, data)

    return get_project(project_id)


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    """Delete a project and all related data (documents, workflows, S3, LanceDB)."""
    config = get_config()

    existing = get_project_item(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")

    deleted_info = {"project_id": project_id}

    # 1. Get all items under this project
    project_items = query_all_project_items(project_id)

    # Extract document IDs and collect workflow IDs
    document_ids = [item["SK"].replace("DOC#", "") for item in project_items if item["SK"].startswith("DOC#")]
    workflow_ids = []
    workflow_items = []
    for doc_id in document_ids:
        wf_items = query_workflows(doc_id)
        for wf in wf_items:
            workflow_ids.append(wf.SK.replace("WF#", ""))
            workflow_items.append({"PK": wf.PK, "SK": wf.SK, "document_id": doc_id})

    deleted_info["workflow_count"] = len(workflow_ids)

    # 2. Delete from LanceDB (per-project S3 Express bucket)
    if config.lancedb_express_bucket_name:
        try:
            lancedb_prefix = f"{project_id}.lance/"
            lancedb_deleted = delete_s3_prefix(config.lancedb_express_bucket_name, lancedb_prefix)
            deleted_info["lancedb_objects_deleted"] = lancedb_deleted
        except Exception as e:
            deleted_info["lancedb_error"] = str(e)

    # 3. Delete workflow items from DynamoDB (including STEP, SEG#*, etc.)
    total_wf_deleted = 0
    for wf_info in workflow_items:
        doc_id = wf_info["document_id"]
        wf_id = wf_info["SK"].replace("WF#", "")
        with contextlib.suppress(Exception):
            total_wf_deleted += delete_workflow_item(doc_id, wf_id)
    deleted_info["workflow_items_deleted"] = total_wf_deleted

    # 4. Delete from S3 - entire project folder
    project_prefix = f"projects/{project_id}/"
    with contextlib.suppress(Exception):
        s3_deleted = delete_s3_prefix(config.document_storage_bucket_name, project_prefix)
        deleted_info["s3_objects_deleted"] = s3_deleted

    # 5. Delete all project items from DynamoDB (PROJ#, DOC#*, WF#* links)
    batch_delete_items(project_items)

    deleted_info["project_items_deleted"] = len(project_items)

    return {"message": f"Project {project_id} deleted", "details": deleted_info}
