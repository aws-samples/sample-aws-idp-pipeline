"""Custom tools for the report agent."""

import boto3
import requests
from nanoid import generate
from strands import tool

from config import get_config


UNSPLASH_API_URL = "https://api.unsplash.com"

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


@tool
def search_unsplash_images(
    query: str,
    per_page: int = 5,
    orientation: str | None = None,
) -> dict:
    """Search for images on Unsplash.

    Args:
        query: Search query for images (e.g., "cloud computing", "business meeting")
        per_page: Number of results to return (1-30, default: 5)
        orientation: Filter by orientation - "landscape", "portrait", or "squarish" (optional)

    Returns:
        Dictionary with 'images' list containing image info:
        - url: Direct image URL (regular size, ~1080px)
        - thumb_url: Thumbnail URL (~200px)
        - download_url: Full resolution download URL
        - photographer: Photographer name
        - photographer_url: Photographer's Unsplash profile
        - description: Image description (if available)
        - attribution: Ready-to-use attribution text
    """
    config = get_config()

    if not config.unsplash_access_key:
        return {"error": "Unsplash API key not configured"}

    headers = {
        "Authorization": f"Client-ID {config.unsplash_access_key}",
        "Accept-Version": "v1",
    }

    params = {
        "query": query,
        "per_page": min(max(per_page, 1), 30),
    }

    if orientation in ("landscape", "portrait", "squarish"):
        params["orientation"] = orientation

    response = requests.get(
        f"{UNSPLASH_API_URL}/search/photos",
        headers=headers,
        params=params,
        timeout=10,
    )

    if response.status_code != 200:
        return {"error": f"Unsplash API error: {response.status_code}"}

    data = response.json()
    images = []

    for photo in data.get("results", []):
        user = photo.get("user", {})
        photographer = user.get("name", "Unknown")
        photographer_url = user.get("links", {}).get("html", "")

        images.append({
            "url": photo.get("urls", {}).get("regular", ""),
            "thumb_url": photo.get("urls", {}).get("thumb", ""),
            "download_url": photo.get("urls", {}).get("full", ""),
            "photographer": photographer,
            "photographer_url": photographer_url,
            "description": photo.get("description") or photo.get("alt_description") or "",
            "attribution": f"Photo by {photographer} on Unsplash ({photographer_url})",
        })

    return {
        "images": images,
        "total": data.get("total", 0),
        "query": query,
    }
