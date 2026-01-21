from functools import lru_cache
from urllib.parse import urlparse

import boto3


def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


@lru_cache
def get_s3_client():
    """Get cached S3 client singleton."""
    return boto3.client("s3")


def _get_content_type(key: str) -> str | None:
    """Get content type based on file extension."""
    ext = key.lower().split(".")[-1] if "." in key else ""
    content_types = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "pdf": "application/pdf",
        "mp4": "video/mp4",
        "mov": "video/quicktime",
        "avi": "video/x-msvideo",
        "mkv": "video/x-matroska",
        "webm": "video/webm",
    }
    return content_types.get(ext)


def generate_presigned_url(s3_uri: str, expires_in: int = 3600) -> str | None:
    """Generate a presigned URL for an S3 URI."""
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None

    bucket, key = parse_s3_uri(s3_uri)

    s3 = get_s3_client()
    params = {"Bucket": bucket, "Key": key}

    # Add ResponseContentType for images to fix ORB blocking
    content_type = _get_content_type(key)
    if content_type:
        params["ResponseContentType"] = content_type

    return s3.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def delete_s3_prefix(bucket: str, prefix: str) -> int:
    """Delete all objects under a prefix."""
    s3 = get_s3_client()
    deleted_count = 0
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue

        delete_keys = [{"Key": obj["Key"]} for obj in objects]
        s3.delete_objects(Bucket=bucket, Delete={"Objects": delete_keys})
        deleted_count += len(delete_keys)

    return deleted_count


def get_analysis_prefix_from_file_uri(file_uri: str) -> tuple[str, str]:
    """Get S3 bucket and analysis prefix from file URI.

    Args:
        file_uri: S3 URI like s3://bucket/projects/{project_id}/documents/{document_id}/{file}

    Returns:
        Tuple of (bucket, analysis_prefix)
    """
    bucket, key = parse_s3_uri(file_uri)
    # Remove the filename to get the document folder
    doc_folder = key.rsplit("/", 1)[0]
    analysis_prefix = f"{doc_folder}/analysis/segment_"
    return bucket, analysis_prefix


def list_segment_keys(file_uri: str) -> list[str]:
    """List all segment JSON file keys from S3.

    Args:
        file_uri: S3 URI of the original document

    Returns:
        List of S3 keys for segment files, sorted by segment index
    """
    bucket, prefix = get_analysis_prefix_from_file_uri(file_uri)
    s3 = get_s3_client()
    paginator = s3.get_paginator("list_objects_v2")

    segment_keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith(".json"):
                segment_keys.append(key)

    # Sort by segment index (segment_0000.json, segment_0001.json, ...)
    segment_keys.sort()
    return segment_keys
