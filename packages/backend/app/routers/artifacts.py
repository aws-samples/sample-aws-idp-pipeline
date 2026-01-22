from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.ddb.artifacts import (
    delete_artifact_item,
    get_artifact_item,
    query_user_artifacts,
    query_user_project_artifacts,
)
from app.s3 import get_s3_client

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactResponse(BaseModel):
    artifact_id: str
    user_id: str
    project_id: str
    filename: str
    content_type: str
    s3_key: str
    s3_bucket: str
    file_size: int
    created_at: str


class ListArtifactsResponse(BaseModel):
    items: list[ArtifactResponse]
    next_cursor: str | None


class DeletedArtifactInfo(BaseModel):
    artifact_id: str


class DeleteArtifactResponse(BaseModel):
    message: str
    details: DeletedArtifactInfo


@router.get("", response_model=ListArtifactsResponse)
def list_artifacts(
    user_id: str = Header(alias="x-user-id"),
    project_id: str | None = Query(None, description="Filter by project ID"),
    limit: int = Query(20, description="Number of items to return"),
    next_cursor: str | None = Query(None, description="Pagination cursor"),
) -> ListArtifactsResponse:
    """List artifacts for a user, optionally filtered by project."""
    if project_id:
        result = query_user_project_artifacts(user_id, project_id, limit, next_cursor)
    else:
        result = query_user_artifacts(user_id, limit, next_cursor)

    items = [
        ArtifactResponse(
            artifact_id=artifact.artifact_id,
            user_id=artifact.data.user_id,
            project_id=artifact.data.project_id,
            filename=artifact.data.filename,
            content_type=artifact.data.content_type,
            s3_key=artifact.data.s3_key,
            s3_bucket=artifact.data.s3_bucket,
            file_size=artifact.data.file_size,
            created_at=artifact.created_at,
        )
        for artifact in result.items
    ]

    return ListArtifactsResponse(items=items, next_cursor=result.next_cursor)


@router.delete("/{artifact_id}")
def delete_artifact(
    artifact_id: str,
    user_id: str = Header(alias="x-user-id"),
) -> DeleteArtifactResponse:
    """Delete an artifact and its S3 object."""
    s3 = get_s3_client()

    artifact = get_artifact_item(artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    if artifact.data.user_id != user_id:
        raise HTTPException(
            status_code=403, detail="Not authorized to delete this artifact"
        )

    # Delete from S3
    s3.delete_object(Bucket=artifact.data.s3_bucket, Key=artifact.data.s3_key)

    # Delete from DynamoDB
    delete_artifact_item(artifact_id)

    return DeleteArtifactResponse(
        message=f"Artifact {artifact_id} deleted",
        details=DeletedArtifactInfo(artifact_id=artifact_id),
    )
