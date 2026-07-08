from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.ddb import (
    Template,
    TemplateData,
    generate_template_id,
    put_template_item,
    query_templates,
)
from app.s3 import get_s3_client

router = APIRouter(prefix="/templates", tags=["templates"])

ALLOWED_EXTENSIONS = {"pptx", "ppt"}


class TemplateUploadRequest(BaseModel):
    name: str
    description: str = ""
    file_name: str
    content_type: str
    file_size: int


class TemplateUploadResponse(BaseModel):
    template_id: str
    upload_url: str
    file_name: str


class TemplateResponse(BaseModel):
    template_id: str
    name: str
    description: str
    file_type: str
    thumbnail_url: str | None = None
    status: str
    created_at: str

    @staticmethod
    def from_template(template: Template) -> "TemplateResponse":
        return TemplateResponse(
            template_id=template.data.template_id,
            name=template.data.name,
            description=template.data.description,
            file_type=template.data.file_type,
            thumbnail_url=template.data.thumbnail_url,
            status=template.data.status,
            created_at=template.created_at,
        )


@router.get("")
def list_templates() -> list[TemplateResponse]:
    """List all templates (global, newest first)."""
    templates = query_templates()
    return [TemplateResponse.from_template(template) for template in templates]


@router.post("")
def create_template_upload(request: TemplateUploadRequest) -> TemplateUploadResponse:
    """Create a template record and return a presigned URL for upload."""
    config = get_config()
    s3 = get_s3_client()

    ext = request.file_name.rsplit(".", 1)[-1].lower() if "." in request.file_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PPTX/PPT files are allowed")

    template_id = generate_template_id()
    s3_key = f"templates/{template_id}/{template_id}.{ext}"

    data = TemplateData(
        template_id=template_id,
        name=request.name,
        description=request.description,
        file_type=ext,
        s3_key=s3_key,
        status="uploading",
    )
    put_template_item(template_id, data)

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

    return TemplateUploadResponse(
        template_id=template_id,
        upload_url=upload_url,
        file_name=request.file_name,
    )
