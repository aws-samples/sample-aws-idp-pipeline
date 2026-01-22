import contextlib
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.ddb import (
    Document,
    DocumentData,
    delete_document_item,
    get_document_item,
    get_project_item,
    put_document_item,
    query_documents,
    update_document_data,
)
from app.ddb.workflows import delete_workflow_item, query_workflows
from app.s3 import delete_s3_prefix, get_s3_client

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


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
    created_at: str
    updated_at: str

    @staticmethod
    def from_document(doc: Document) -> "DocumentResponse":
        return DocumentResponse(
            document_id=doc.data.document_id,
            project_id=doc.data.project_id,
            name=doc.data.name,
            file_type=doc.data.file_type,
            file_size=doc.data.file_size,
            status=doc.data.status,
            s3_key=doc.data.s3_key,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )


class DocumentStatusUpdate(BaseModel):
    status: str


class DeletedDocumentInfo(BaseModel):
    document_id: str
    workflow_id: str | None = None
    lancedb_deleted: bool = False
    lancedb_error: str | None = None
    workflow_deleted: bool = False


class DeleteDocumentResponse(BaseModel):
    message: str
    details: DeletedDocumentInfo


@router.get("")
def list_documents(project_id: str) -> list[DocumentResponse]:
    """List all documents for a project."""
    documents = query_documents(project_id)
    return [DocumentResponse.from_document(doc) for doc in documents]


@router.post("")
def create_document_upload(
    project_id: str, request: DocumentUploadRequest
) -> DocumentUploadResponse:
    """Create a document record and return a presigned URL for upload."""
    config = get_config()
    s3 = get_s3_client()

    # Validate file size (500MB max)
    max_size = 500 * 1024 * 1024  # 500MB
    if request.file_size > max_size:
        raise HTTPException(status_code=400, detail="File size exceeds 500MB limit")

    # Check project exists
    if not get_project_item(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    # Generate document ID and S3 key
    document_id = str(uuid.uuid4())
    # Use document_id as filename for S3 (original name stored in DynamoDB)
    ext = request.file_name.rsplit(".", 1)[-1] if "." in request.file_name else ""
    s3_key = f"projects/{project_id}/documents/{document_id}/{document_id}.{ext}"

    # Create document record in DynamoDB
    data = DocumentData(
        document_id=document_id,
        project_id=project_id,
        name=request.file_name,
        file_type=request.content_type,
        file_size=request.file_size,
        status="uploading",
        s3_key=s3_key,
    )
    put_document_item(project_id, document_id, data)

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
def update_document_status(
    project_id: str, document_id: str, request: DocumentStatusUpdate
) -> DocumentResponse:
    """Update document status after upload completion."""
    existing = get_document_item(project_id, document_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")

    data = existing.data.model_copy()
    data.status = request.status

    update_document_data(project_id, document_id, data)

    # Get updated document
    doc = get_document_item(project_id, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse.from_document(doc)


@router.get("/{document_id}")
def get_document(project_id: str, document_id: str) -> DocumentResponse:
    """Get a single document."""
    doc = get_document_item(project_id, document_id)

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return DocumentResponse.from_document(doc)


@router.delete("/{document_id}")
def delete_document(project_id: str, document_id: str) -> DeleteDocumentResponse:
    """Delete a document and all related data (DynamoDB, S3, LanceDB)."""
    config = get_config()
    s3 = get_s3_client()

    # Check document exists and get info
    doc = get_document_item(project_id, document_id)

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    s3_key = doc.data.s3_key

    # Find related workflow for this document
    workflow_id = None
    workflows = query_workflows(document_id)
    if workflows:
        wf = workflows[0]
        workflow_id = wf.SK.replace("WF#", "")

    deleted_info = DeletedDocumentInfo(document_id=document_id, workflow_id=workflow_id)

    # 1. Delete from LanceDB (per-project, if workflow exists)
    if workflow_id and config.lancedb_express_bucket_name:
        try:
            import lancedb

            db = lancedb.connect(
                f"s3://{config.lancedb_express_bucket_name}/{project_id}.lance"
            )
            if "documents" in db.table_names():
                lance_table = db.open_table("documents")
                lance_table.delete(f"workflow_id = '{workflow_id}'")
                deleted_info.lancedb_deleted = True
        except Exception as e:
            deleted_info.lancedb_error = str(e)

    # 2. Delete from S3 - document file
    if s3_key:
        with contextlib.suppress(Exception):
            s3.delete_object(Bucket=config.document_storage_bucket_name, Key=s3_key)

    # 3. Delete from S3 - entire document folder
    doc_prefix = f"projects/{project_id}/documents/{document_id}/"
    with contextlib.suppress(Exception):
        delete_s3_prefix(config.document_storage_bucket_name, doc_prefix)

    # 4. Delete workflow data from DynamoDB
    if workflow_id:
        with contextlib.suppress(Exception):
            delete_workflow_item(document_id, workflow_id)
            deleted_info.workflow_deleted = True

    # 5. Delete document item from DynamoDB
    delete_document_item(project_id, document_id)

    return DeleteDocumentResponse(
        message=f"Document {document_id} deleted", details=deleted_info
    )
