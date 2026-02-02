"""Custom tools for the report agent."""

import boto3
from nanoid import generate
from strands import tool

from config import get_config

# Alphanumeric characters for nanoid
NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"


@tool
def create_s3_upload_url(
    user_id: str,
    project_id: str,
    existing_key: str | None = None,
) -> dict:
    """Create presigned URLs for uploading a PPTX file to S3.

    Args:
        user_id: User ID for the file path
        project_id: Project ID for the file path
        existing_key: Existing S3 key to update (optional). If not provided, creates new artifact.

    Returns:
        Dictionary with 'upload_url' (PUT), 'download_url' (GET), and 'key'
    """
    config = get_config()

    # Use existing key or generate new one
    if existing_key:
        key = existing_key
    else:
        artifact_id = generate(NANOID_ALPHABET, 21)
        key = f"{user_id}/{project_id}/artifacts/art_{artifact_id}.pptx"

    # Create S3 client
    s3 = boto3.client("s3", region_name=config.aws_region)
    bucket = config.agent_storage_bucket_name

    # Generate presigned PUT URL for upload
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
        ExpiresIn=3600,
    )

    # Generate presigned GET URL for download
    download_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,
    )

    return {
        "upload_url": upload_url,
        "download_url": download_url,
        "key": key,
    }


@tool
def create_s3_download_url(s3_key: str) -> dict:
    """Create a presigned URL for downloading an existing file from S3.

    Args:
        s3_key: S3 object key (e.g., '{user_id}/{project_id}/artifacts/art_xxxx.pptx')

    Returns:
        Dictionary with 'download_url' (GET) and 'key'
    """
    config = get_config()

    s3 = boto3.client("s3", region_name=config.aws_region)
    bucket = config.agent_storage_bucket_name

    download_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": s3_key},
        ExpiresIn=3600,
    )

    return {
        "download_url": download_url,
        "key": s3_key,
    }
