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
