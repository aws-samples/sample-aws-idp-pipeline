import json
import os
import subprocess

import boto3
from nanoid import generate as nanoid_generate
from strands import tool

from config import get_config

NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"

# officecli operates on local files only, so documents must be staged on the
# runtime container's local filesystem before/after editing. This local storage
# is ephemeral scratch space (AgentCore /tmp is volatile and reused across
# sessions) — S3 is the source of truth. Every document task gets its own
# unique workspace under this root to avoid path collisions between concurrent
# requests sharing a microVM.
LOCAL_WORK_ROOT = "/tmp/officecli"


def create_artifact_path_tool(
    user_id: str | None = None,
    project_id: str | None = None,
):
    """Create an artifact_path tool bound to user/project context."""

    @tool
    def artifact_path(filename: str) -> dict:
        """Generate S3 artifact path for uploading files created in code_interpreter.

        Call this tool BEFORE uploading a file from code_interpreter to get the
        correct S3 bucket and key.

        Args:
            filename: The filename to upload (e.g., "report.docx")

        Returns:
            Dictionary with s3_uri, bucket, key, and artifact markdown reference.
        """
        config = get_config()
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        bucket = config.agent_storage_bucket_name
        key = f"{user_id}/{project_id}/artifacts/{artifact_id}/{filename}"

        return {
            "s3_uri": f"s3://{bucket}/{key}",
            "bucket": bucket,
            "key": key,
            "artifact_ref": f"[artifact:{artifact_id}]({filename})",
        }

    return artifact_path


def create_artifact_workspace_tool(session_id: str):
    """Create an artifact_workspace tool bound to the session."""

    @tool
    def artifact_workspace() -> dict:
        """Create a fresh local workspace directory for an officecli document task.

        Call this FIRST for any officecli document task (creating a new document
        or editing an existing one). It returns a unique, isolated directory to
        use as the working directory — create/download files there and let
        officecli read/write them there. This avoids path collisions between
        concurrent requests.

        Local files are ephemeral scratch space: complete the
        workspace -> edit -> artifact_upload flow within a single turn. Do not
        rely on files persisting across turns — S3 is the source of truth.

        Returns:
            Dictionary with workspace_dir to place and edit files in.
        """
        workspace_id = nanoid_generate(NANOID_ALPHABET, 12)
        workspace_dir = os.path.join(LOCAL_WORK_ROOT, session_id, workspace_id)
        os.makedirs(workspace_dir, exist_ok=True)

        return {"workspace_dir": workspace_dir}

    return artifact_workspace


def create_artifact_download_tool(
    user_id: str | None = None,
    project_id: str | None = None,
):
    """Create an artifact_download tool bound to user/project context."""

    @tool
    def artifact_download(artifact_id: str, workspace_dir: str, filename: str | None = None) -> dict:
        """Download an artifact from S3 into a workspace directory for editing.

        officecli operates on local files only. Call this to stage an existing
        artifact locally before editing it with officecli, then upload the
        result with artifact_upload. Get workspace_dir from artifact_workspace.

        The artifact_id and filename come from the artifact reference
        `[artifact:art_xxx](filename)` — the artifact path is derived from them,
        so you only need the id (and optionally the filename). If filename is
        omitted, the single file under the artifact is resolved automatically.

        Args:
            artifact_id: The artifact id (e.g., "art_xxxxx") from the artifact reference.
            workspace_dir: The workspace directory from artifact_workspace.
            filename: The artifact filename, if known (e.g., "report.docx").

        Returns:
            Dictionary with local_path pointing to the downloaded file.
        """
        config = get_config()
        bucket = config.agent_storage_bucket_name
        prefix = f"{user_id}/{project_id}/artifacts/{artifact_id}/"

        s3 = boto3.client("s3")
        if not filename:
            listing = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
            contents = listing.get("Contents", [])
            if not contents:
                raise FileNotFoundError(f"No artifact found under {prefix}")
            key = contents[0]["Key"]
            filename = os.path.basename(key)
        else:
            key = f"{prefix}{filename}"

        local_path = os.path.join(workspace_dir, filename)
        s3.download_file(bucket, key, local_path)

        return {"local_path": local_path, "s3_uri": f"s3://{bucket}/{key}"}

    return artifact_download


def create_artifact_upload_tool(
    user_id: str | None = None,
    project_id: str | None = None,
):
    """Create an artifact_upload tool bound to user/project context."""

    @tool
    def artifact_upload(local_path: str) -> dict:
        """Upload a locally created/edited file to S3 as a project artifact.

        Call this after creating or editing a document with officecli to publish
        it. Returns the artifact_ref to report back to the user.

        Args:
            local_path: Path to the local file to upload (e.g., "/tmp/officecli/deck.pptx").

        Returns:
            Dictionary with s3_uri, bucket, key, and artifact markdown reference.
        """
        config = get_config()
        filename = os.path.basename(local_path)
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        bucket = config.agent_storage_bucket_name
        key = f"{user_id}/{project_id}/artifacts/{artifact_id}/{filename}"

        s3 = boto3.client("s3")
        s3.upload_file(local_path, bucket, key)

        return {
            "s3_uri": f"s3://{bucket}/{key}",
            "bucket": bucket,
            "key": key,
            "artifact_ref": f"[artifact:{artifact_id}]({filename})",
        }

    return artifact_upload


# Presigned URLs for rendered page previews. One hour is enough for the chat
# turn; the permanent reference is the artifact_ref returned alongside.
PRESIGN_EXPIRY_SECONDS = 3600


def _count_pages(officecli_path: str, local_path: str) -> int:
    """Return the page/slide count of an Office document via officecli stats."""
    result = subprocess.run(
        [officecli_path, "view", local_path, "stats", "--json"],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout).get("data", {})
    # pptx -> slides, docx -> pages, xlsx -> sheets
    return data.get("slides") or data.get("pages") or data.get("sheets") or 1


def create_artifact_render_pages_tool(
    user_id: str | None = None,
    project_id: str | None = None,
    officecli_path: str = "officecli",
):
    """Create an artifact_render_pages tool bound to user/project context."""

    @tool
    def artifact_render_pages(local_path: str) -> dict:
        """Render each page of a local Office document to an image and publish them.

        Renders one image per page/slide with officecli, uploads each to a single
        artifact folder in S3, and returns a presigned URL per page plus one
        artifact_ref for the whole set. Present the pages to the user as inline
        images using the presigned URLs: `![page N](presigned_url)`.

        Use this after creating or editing a document so the user can preview the
        result page by page. Presigned URLs expire in one hour; the artifact_ref
        is the permanent reference.

        Args:
            local_path: Path to the local document (e.g., "/tmp/officecli/deck.pptx").

        Returns:
            Dictionary with `pages` (list of {page, presigned_url}) and `artifact_ref`.
        """
        config = get_config()
        bucket = config.agent_storage_bucket_name
        base_name = os.path.splitext(os.path.basename(local_path))[0]
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        prefix = f"{user_id}/{project_id}/artifacts/{artifact_id}"

        page_count = _count_pages(officecli_path, local_path)
        s3 = boto3.client("s3")
        pages = []

        for page in range(1, page_count + 1):
            image_name = f"{base_name}_page{page}.png"
            image_path = os.path.join(os.path.dirname(local_path), image_name)
            subprocess.run(
                [officecli_path, "view", local_path, "screenshot", "--page", str(page), "-o", image_path],
                capture_output=True,
                text=True,
                check=True,
            )

            # officecli exits 0 even when no headless renderer is available, so
            # verify the image was actually produced before uploading.
            if not os.path.exists(image_path):
                raise RuntimeError(f"officecli did not render page {page} of {local_path}")

            key = f"{prefix}/{image_name}"
            s3.upload_file(image_path, bucket, key, ExtraArgs={"ContentType": "image/png"})
            presigned_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=PRESIGN_EXPIRY_SECONDS,
            )
            pages.append({"page": page, "presigned_url": presigned_url})

        return {
            "pages": pages,
            "artifact_ref": f"[artifact:{artifact_id}]({base_name})",
        }

    return artifact_render_pages
