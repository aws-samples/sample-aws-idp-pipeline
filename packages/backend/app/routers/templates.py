from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import get_config
from app.ddb import (
    Template,
    TemplateData,
    delete_template_item,
    generate_template_id,
    get_template_item,
    put_template_item,
    query_templates,
)
from app.s3 import delete_s3_prefix, get_s3_client

router = APIRouter(prefix="/templates", tags=["templates"])

ALLOWED_EXTENSIONS = {"pptx", "ppt", "docx", "doc", "pdf"}

# Extensions whose template type is self-evident from the file itself.
# PDF is excluded: its template type is determined later by AI analysis.
TYPED_EXTENSIONS = ALLOWED_EXTENSIONS - {"pdf"}


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


class TemplateDownloadResponse(BaseModel):
    download_url: str
    file_name: str


class TemplateResponse(BaseModel):
    template_id: str
    name: str
    description: str
    template_type: str | None = None
    thumbnail_url: str | None = None
    status: str
    generated_prompt: str | None = None
    created_at: str

    @staticmethod
    def from_template(template: Template) -> "TemplateResponse":
        # Expose the cacheable proxy route (not the raw S3 path) to clients, and
        # only when a thumbnail has actually been generated.
        thumbnail_url = f"templates/{template.data.template_id}/thumbnail" if template.data.thumbnail_s3_key else None
        return TemplateResponse(
            template_id=template.data.template_id,
            name=template.data.name,
            description=template.data.description,
            template_type=template.data.template_type,
            thumbnail_url=thumbnail_url,
            status=template.data.status,
            generated_prompt=template.data.generated_prompt,
            created_at=template.created_at,
        )


@router.get("")
def list_templates() -> list[TemplateResponse]:
    """List all templates (global, newest first)."""
    templates = query_templates()
    return [TemplateResponse.from_template(template) for template in templates]


@router.get("/{template_id}")
def get_template(template_id: str) -> TemplateResponse:
    """Get a single template by id."""
    template = get_template_item(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return TemplateResponse.from_template(template)


@router.get("/{template_id}/thumbnail")
def get_template_thumbnail(template_id: str) -> StreamingResponse:
    """Proxy the template thumbnail from S3.

    Thumbnails are loaded repeatedly in the list/detail views, so this returns a
    stable, cacheable URL instead of a per-request presigned URL. The response
    is streamed straight from S3 with a long Cache-Control so the browser/CDN
    can serve it without hitting the backend again.
    """
    config = get_config()
    s3 = get_s3_client()

    template = get_template_item(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    thumbnail_s3_key = template.data.thumbnail_s3_key
    if not thumbnail_s3_key:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    obj = s3.get_object(
        Bucket=config.document_storage_bucket_name,
        Key=thumbnail_s3_key,
    )

    return StreamingResponse(
        obj["Body"].iter_chunks(),
        media_type=obj.get("ContentType", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{template_id}/download")
def download_template(template_id: str) -> TemplateDownloadResponse:
    """Return a presigned URL to download the original template file."""
    config = get_config()
    s3 = get_s3_client()

    template = get_template_item(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    s3_key = template.data.s3_key

    # Download filename: the template name with the stored file's extension.
    ext = s3_key.rsplit(".", 1)[-1] if "." in s3_key else ""
    file_name = f"{template.data.name}.{ext}" if ext else template.data.name

    download_url = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": config.document_storage_bucket_name,
            "Key": s3_key,
            "ResponseContentDisposition": f'attachment; filename="{file_name}"',
        },
        ExpiresIn=3600,
    )

    return TemplateDownloadResponse(download_url=download_url, file_name=file_name)


@router.post("")
def create_template_upload(request: TemplateUploadRequest) -> TemplateUploadResponse:
    """Create a template record and return a presigned URL for upload."""
    config = get_config()
    s3 = get_s3_client()

    ext = request.file_name.rsplit(".", 1)[-1].lower() if "." in request.file_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only PPT/PPTX, DOC/DOCX, PDF files are allowed",
        )

    template_id = generate_template_id()
    s3_key = f"templates/{template_id}/{template_id}.{ext}"

    # PDF template type is resolved later by AI analysis; leave it unset for now.
    template_type = ext if ext in TYPED_EXTENSIONS else None

    data = TemplateData(
        template_id=template_id,
        name=request.name,
        description=request.description,
        template_type=template_type,
        s3_key=s3_key,
        status="uploaded",
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


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: str) -> None:
    """Delete a template: its S3 objects and DynamoDB record."""
    config = get_config()

    template = get_template_item(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # TODO: If the template is still being analyzed ("analyzing"), stop the
    # in-flight analysis before deleting its data (e.g. abort the Step Functions
    # execution / cancel the analysis job) so it does not keep running and
    # re-write the record we are about to remove.
    if template.data.status == "analyzing":
        pass

    # Delete every object under templates/{template_id}/ (original file,
    # thumbnails, analysis artifacts) in one prefix sweep.
    prefix = f"templates/{template_id}/"
    delete_s3_prefix(config.document_storage_bucket_name, prefix)

    delete_template_item(template_id)


@router.post("/{template_id}/reanalyze", status_code=202)
def reanalyze_template(template_id: str) -> None:
    """Trigger re-analysis of a template."""
    template = get_template_item(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # TODO: Set the template status back to "analyzing" and kick off the
    # analysis pipeline (done as part of the analysis pipeline work).
