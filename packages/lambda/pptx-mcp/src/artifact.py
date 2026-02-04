"""Artifact system integration for PPTX MCP tools."""

import os
from dataclasses import dataclass

import boto3

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")


@dataclass
class ArtifactMetadata:
    artifact_id: str
    created_at: str
    user_id: str
    project_id: str
    filename: str
    content_type: str
    s3_key: str
    s3_bucket: str
    file_size: int


def get_artifact_metadata(artifact_id: str) -> ArtifactMetadata | None:
    """Get artifact metadata from DynamoDB."""
    table_name = os.environ["BACKEND_TABLE_NAME"]
    table = dynamodb.Table(table_name)

    response = table.get_item(Key={"PK": f"ART#{artifact_id}", "SK": "META"})

    item = response.get("Item")
    if not item:
        return None

    data = item.get("data", {})
    return ArtifactMetadata(
        artifact_id=item["artifact_id"],
        created_at=item["created_at"],
        user_id=data["user_id"],
        project_id=data["project_id"],
        filename=data["filename"],
        content_type=data["content_type"],
        s3_key=data["s3_key"],
        s3_bucket=data["s3_bucket"],
        file_size=data["file_size"],
    )


def get_artifact_content(artifact_id: str) -> tuple[bytes, ArtifactMetadata]:
    """Get artifact content from S3."""
    metadata = get_artifact_metadata(artifact_id)
    if not metadata:
        raise ValueError(f"Artifact not found: {artifact_id}")

    response = s3.get_object(Bucket=metadata.s3_bucket, Key=metadata.s3_key)
    content = response["Body"].read()

    return content, metadata
