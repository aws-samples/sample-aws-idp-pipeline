"""Artifact system integration for PDF MCP tools."""

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime

import boto3
from nanoid import generate

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
sqs = boto3.client("sqs")


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


def save_artifact(
    user_id: str,
    project_id: str,
    filename: str,
    content: bytes,
    content_type: str,
) -> dict:
    """Save a new artifact to S3 and DynamoDB."""
    table_name = os.environ["BACKEND_TABLE_NAME"]
    bucket_name = os.environ["AGENT_STORAGE_BUCKET"]

    table = dynamodb.Table(table_name)

    artifact_id = f"art_{generate(size=21)}"
    ext = filename.split(".")[-1] if "." in filename else ""
    s3_key = (
        f"{user_id}/{project_id}/artifacts/{artifact_id}.{ext}"
        if ext
        else f"{user_id}/{project_id}/artifacts/{artifact_id}"
    )
    created_at = datetime.now(UTC).isoformat()

    # Upload to S3
    s3.put_object(
        Bucket=bucket_name,
        Key=s3_key,
        Body=content,
        ContentType=content_type,
    )

    # Save metadata to DynamoDB
    table.put_item(
        Item={
            "PK": f"ART#{artifact_id}",
            "SK": "META",
            "GSI1PK": f"USR#{user_id}#ART",
            "GSI1SK": created_at,
            "GSI2PK": f"USR#{user_id}#PROJ#{project_id}#ART",
            "GSI2SK": created_at,
            "artifact_id": artifact_id,
            "created_at": created_at,
            "data": {
                "user_id": user_id,
                "project_id": project_id,
                "filename": filename,
                "content_type": content_type,
                "s3_key": s3_key,
                "s3_bucket": bucket_name,
                "file_size": len(content),
            },
        }
    )

    # Send notification to websocket broker
    queue_url = os.environ.get("WEBSOCKET_MESSAGE_QUEUE_URL")
    if queue_url:
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                "username": user_id,
                "message": {
                    "action": "artifacts",
                    "data": {
                        "event": "created",
                        "artifact_id": artifact_id,
                        "filename": filename,
                        "created_at": created_at,
                    },
                },
            }),
        )

    return {
        "artifact_id": artifact_id,
        "filename": filename,
        "s3_bucket": bucket_name,
        "s3_key": s3_key,
        "created_at": created_at,
    }


def update_artifact(artifact_id: str, content: bytes) -> dict:
    """Update existing artifact content in S3.

    Args:
        artifact_id: The artifact ID to update
        content: New content bytes

    Returns:
        Updated artifact metadata
    """
    metadata = get_artifact_metadata(artifact_id)
    if not metadata:
        raise ValueError(f"Artifact not found: {artifact_id}")

    # Upload new content to S3
    s3.put_object(
        Bucket=metadata.s3_bucket,
        Key=metadata.s3_key,
        Body=content,
        ContentType=metadata.content_type,
    )

    # Update file_size in DynamoDB
    table_name = os.environ["BACKEND_TABLE_NAME"]
    table = dynamodb.Table(table_name)
    updated_at = datetime.now(UTC).isoformat()

    table.update_item(
        Key={"PK": f"ART#{artifact_id}", "SK": "META"},
        UpdateExpression="SET #data.file_size = :size, updated_at = :updated_at",
        ExpressionAttributeNames={"#data": "data"},
        ExpressionAttributeValues={
            ":size": len(content),
            ":updated_at": updated_at,
        },
    )

    # Send notification to websocket broker
    queue_url = os.environ.get("WEBSOCKET_MESSAGE_QUEUE_URL")
    if queue_url:
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                "username": metadata.user_id,
                "message": {
                    "action": "artifacts",
                    "data": {
                        "event": "updated",
                        "artifact_id": artifact_id,
                        "filename": metadata.filename,
                        "updated_at": updated_at,
                    },
                },
            }),
        )

    return {
        "artifact_id": artifact_id,
        "filename": metadata.filename,
        "s3_bucket": metadata.s3_bucket,
        "s3_key": metadata.s3_key,
        "updated_at": updated_at,
    }
