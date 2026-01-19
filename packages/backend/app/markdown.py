import re

from app.s3 import generate_presigned_url


def fix_image_uri(image_uri: str) -> str:
    """Fix image_uri by adding /assets/ if missing.

    BDA stores images in /assets/ subdirectory but some stored URIs
    may be missing this path component.
    """
    if not image_uri or not image_uri.startswith("s3://"):
        return image_uri

    # Already has /assets/, return as-is
    if "/assets/" in image_uri:
        return image_uri

    # Add /assets/ before the filename
    parts = image_uri.rsplit("/", 1)
    if len(parts) == 2:
        return f"{parts[0]}/assets/{parts[1]}"

    return image_uri


def transform_markdown_images(markdown: str, image_uri: str = "") -> str:
    """Transform markdown images to presigned URLs.

    Handles both:
    1. Relative paths like ./uuid.png (using image_uri to derive base path)
    2. Full S3 URIs like s3://bucket/key
    3. Plain filenames like uuid.png
    """
    if not markdown:
        return markdown

    # Extract assets base path from image_uri
    # BDA stores images in /assets/ subdirectory
    # e.g., s3://bucket/bda-output/.../standard_output/0/assets/rectified_image.png
    # -> s3://bucket/bda-output/.../standard_output/0/assets/
    assets_base = ""
    if image_uri:
        # Case 1: image_uri already contains /assets/
        assets_match = re.search(r"(s3://[^/]+/.+/assets/)", image_uri)
        if assets_match:
            assets_base = assets_match.group(1)
        else:
            # Case 2: image_uri doesn't have /assets/, construct it from parent dir
            # e.g., s3://bucket/.../standard_output/0/rectified_image.png
            # -> s3://bucket/.../standard_output/0/assets/
            parent_dir = image_uri.rsplit("/", 1)[0]
            if parent_dir:
                assets_base = f"{parent_dir}/assets/"

    # Fallback: try to extract assets_base from S3 URIs in the markdown itself
    if not assets_base:
        s3_uri_match = re.search(r"(s3://[^/]+/.+/assets/)", markdown)
        if s3_uri_match:
            assets_base = s3_uri_match.group(1)

    def transform_image(match):
        alt_text = match.group(1)
        img_url = match.group(2)

        # Remove newlines and extra whitespace from alt text
        alt_text = " ".join(alt_text.split())
        # Escape brackets in alt text to prevent markdown parsing issues
        alt_text = alt_text.replace("[", "\\[").replace("]", "\\]")
        # Truncate long alt text
        if len(alt_text) > 100:
            alt_text = alt_text[:100] + "..."

        # Handle relative paths like ./filename.png
        if img_url.startswith("./") and assets_base:
            filename = img_url[2:]  # Remove "./"
            s3_uri = f"{assets_base}{filename}"
            presigned_url = generate_presigned_url(s3_uri)
            if presigned_url:
                img_url = presigned_url
        # Handle full S3 URIs
        elif img_url.startswith("s3://"):
            pass  # Will be handled below
        # Handle plain filenames (no ./ prefix, not s3://, not http)
        elif assets_base and not img_url.startswith(("http://", "https://")):
            s3_uri = f"{assets_base}{img_url}"
            presigned_url = generate_presigned_url(s3_uri)
            if presigned_url:
                img_url = presigned_url

        # Handle full S3 URIs
        if img_url.startswith("s3://"):
            # Check if the URI is missing /assets/ and add it
            if "/assets/" not in img_url:
                parts = img_url.rsplit("/", 1)
                if len(parts) == 2:
                    img_url_with_assets = f"{parts[0]}/assets/{parts[1]}"
                    presigned_url = generate_presigned_url(img_url_with_assets)
                    if presigned_url:
                        img_url = presigned_url
                    else:
                        # Fallback to original URL if assets path doesn't work
                        presigned_url = generate_presigned_url(img_url)
                        if presigned_url:
                            img_url = presigned_url
            else:
                presigned_url = generate_presigned_url(img_url)
                if presigned_url:
                    img_url = presigned_url

        return f"![{alt_text}]({img_url})"

    # Match markdown image syntax: ![alt](url)
    # Use non-greedy match with DOTALL to handle multi-line alt text and nested brackets
    pattern = r"!\[(.*?)\]\(([^)]+)\)"
    return re.sub(pattern, transform_image, markdown, flags=re.DOTALL)
